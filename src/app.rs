// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Die laufende App: Notizbuch plus Hintergrundaufgaben (Speichern,
//! Versionen, Synchronisation, Beobachtung der Dateien, Erinnerungen) und
//! Ereignisse für die Oberfläche.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use chrono::{Local, NaiveDateTime};
use parking_lot::Mutex;
use serde::Serialize;
use tokio::sync::{Notify, broadcast};

use crate::capture::{self, Captured};
use crate::git;
use crate::settings::Settings;
use crate::vault::{NodeDto, NodeId, Op, Patch, Vault};

pub type Callback = Arc<dyn Fn() + Send + Sync>;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    /// Geänderte Knoten (`origin`: Oberfläche, die die Änderung ausgelöst hat).
    Patch { origin: Option<String>, nodes: Vec<NodeDto>, removed: Vec<NodeId> },
    /// Notizbuch von der Platte neu gelesen: alles neu laden.
    Reload,
    Types,
    Sync { status: SyncStatus },
    Navigate { id: String },
    Settings,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub remote: Option<String>,
    pub enabled: bool,
    pub running: bool,
    pub git_cli: bool,
    /// Letzte erfolgreiche Synchronisation (Unix-Sekunden).
    pub last_sync: Option<i64>,
    pub last_error: Option<String>,
    /// Letzte lokale Version (Unix-Sekunden).
    pub last_commit: Option<i64>,
    /// Änderungen, die noch nicht als Version festgehalten sind.
    pub pending: usize,
    pub resolved: Vec<String>,
}

/// Rückrufe in die Desktop-Hülle (Fenster, Erfassung, Hotkey).
#[derive(Default, Clone)]
pub struct Shell {
    pub focus: Option<Callback>,
    pub capture: Option<Callback>,
    pub hide_capture: Option<Callback>,
    pub quit: Option<Callback>,
    pub set_hotkey: Option<Arc<dyn Fn(String) -> Result<()> + Send + Sync>>,
    /// Zoom der Fenster (Schriftgröße) ändern.
    pub set_zoom: Option<Arc<dyn Fn(f64) + Send + Sync>>,
}

#[derive(Default)]
struct Activity {
    last_change: Option<Instant>,
    first_pending: Option<Instant>,
}

pub struct App {
    pub vault: Mutex<Vault>,
    pub config_dir: PathBuf,
    pub settings: Mutex<Settings>,
    pub events: broadcast::Sender<Event>,
    pub shell: Mutex<Shell>,
    sync: Mutex<SyncStatus>,
    sync_wake: Notify,
    sync_running: tokio::sync::Mutex<()>,
    activity: Mutex<Activity>,
    /// Schon ausgelöste Erinnerungen (Schlüssel → Zeitpunkt).
    fired: Mutex<HashMap<String, i64>>,
}

fn now() -> NaiveDateTime {
    Local::now().naive_local()
}

fn unix_now() -> i64 {
    Local::now().timestamp()
}

/// Commit-Nachricht aus den geänderten Seiten.
fn commit_message(paths: &BTreeSet<String>) -> String {
    let names: Vec<&str> = paths.iter().map(|p| p.as_str()).collect();
    let list = match names.len() {
        0 => "Notizen".to_string(),
        1..=3 => names.join(", "),
        n => format!("{}, {} und {} weitere", names[0], names[1], n - 2),
    };
    format!("Bearbeitet: {list}\n\nGerät: {}", git::hostname())
}

impl App {
    pub fn open(vault_dir: &Path, config_dir: PathBuf, settings: Settings) -> Result<Arc<App>> {
        // Ein Notizbuch aus der Zeit, als Hakobo noch Sqizzo hieß: Vault::open benennt `.sqizzo/` um.
        let from_sqizzo = vault_dir.join(".sqizzo").is_dir() && !vault_dir.join(".hakobo").exists();
        let vault = Vault::open(vault_dir)?;
        if let Err(e) = git::ensure_repo(&vault.dir) {
            tracing::warn!("Versionierung nicht verfügbar: {e:#}");
        } else if from_sqizzo && let Err(e) = git::commit_all(&vault.dir, "Sqizzo heißt jetzt Hakobo") {
            tracing::warn!("{e:#}");
        }
        let (events, _) = broadcast::channel(512);
        let remote = git::remote_url(&vault.dir);
        let last_commit = git::head_time(&vault.dir);
        let fired = std::fs::read_to_string(config_dir.join("reminders.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let app = Arc::new(App {
            sync: Mutex::new(SyncStatus { remote, enabled: settings.sync_enabled, git_cli: git::cli_available(), last_commit, ..Default::default() }),
            vault: Mutex::new(vault),
            config_dir,
            settings: Mutex::new(settings),
            events,
            shell: Mutex::new(Shell::default()),
            sync_wake: Notify::new(),
            sync_running: tokio::sync::Mutex::new(()),
            activity: Mutex::new(Activity::default()),
            fired: Mutex::new(fired),
        });
        Ok(app)
    }

    pub fn vault_dir(&self) -> PathBuf {
        self.vault.lock().dir.clone()
    }

    pub fn emit(&self, e: Event) {
        let _ = self.events.send(e);
    }

    fn touch(&self) {
        let mut a = self.activity.lock();
        let now = Instant::now();
        a.last_change = Some(now);
        a.first_pending.get_or_insert(now);
    }

    /// Wendet Operationen an und verteilt die Änderungen.
    pub fn apply(&self, origin: Option<String>, ops: Vec<Op>) -> Result<Patch> {
        let patch = {
            let mut v = self.vault.lock();
            let ch = v.apply(ops)?;
            v.patch(&ch)
        };
        self.touch();
        self.emit(Event::Patch { origin, nodes: patch.nodes.clone(), removed: patch.removed.clone() });
        Ok(patch)
    }

    /// Schnellerfassung in die Inbox (oder unter `parent`).
    pub fn capture(&self, text: &str, parent: Option<&str>) -> Result<(NodeId, Captured)> {
        let mut c = capture::parse(text, now());
        if c.text.is_empty() && c.body.is_empty() {
            return Err(anyhow!("Nichts zu erfassen."));
        }
        let patch = {
            let mut v = self.vault.lock();
            c.text = resolve_mentions(&mut v, &c.text);
            let parent = match parent.filter(|p| !p.is_empty()) {
                Some(p) => p.to_string(),
                None => v.inbox.clone(),
            };
            let mut ch = crate::vault::Changes::default();
            let id = v.create_item(None, &parent, None, c.text.clone(), c.body.clone(), c.fields.clone(), c.task, &mut ch)?;
            v.version += 1;
            (id, v.patch(&ch))
        };
        self.touch();
        self.emit(Event::Patch { origin: None, nodes: patch.1.nodes, removed: patch.1.removed });
        Ok((patch.0, c))
    }

    /// Schreibt ausstehende Änderungen (ohne Version).
    pub fn flush(&self) {
        let mut v = self.vault.lock();
        if v.has_dirty()
            && let Err(e) = v.flush()
        {
            tracing::error!("Speichern fehlgeschlagen: {e:#}");
        }
    }

    /// Hält alle Änderungen als Version fest.
    pub fn commit_now(&self) -> Result<Option<String>> {
        let id = {
            let mut v = self.vault.lock();
            v.flush()?;
            let msg = commit_message(&v.pending_commit);
            let id = git::commit_all(&v.dir, &msg)?;
            v.pending_commit.clear();
            id
        };
        *self.activity.lock() = Activity::default();
        if id.is_some() {
            let status = {
                let mut s = self.sync.lock();
                s.last_commit = Some(unix_now());
                s.pending = 0;
                s.clone()
            };
            self.emit(Event::Sync { status });
            // Bald synchronisieren, damit andere Geräte die Änderung sehen.
            self.sync_wake.notify_one();
        }
        Ok(id)
    }

    pub fn sync_status(&self) -> SyncStatus {
        let mut s = self.sync.lock().clone();
        s.pending = self.vault.lock().pending_commit.len();
        s
    }

    fn set_sync(&self, f: impl FnOnce(&mut SyncStatus)) {
        let status = {
            let mut s = self.sync.lock();
            f(&mut s);
            s.clone()
        };
        self.emit(Event::Sync { status });
    }

    /// Synchronisiert mit dem Remote: holen, einspielen, hochladen.
    pub async fn sync_now(self: &Arc<Self>) -> Result<SyncStatus> {
        let _running = self.sync_running.lock().await;
        let dir = self.vault_dir();
        if git::remote_url(&dir).is_none() {
            self.set_sync(|s| s.remote = None);
            return Ok(self.sync_status());
        }
        self.set_sync(|s| {
            s.running = true;
            s.last_error = None;
        });
        let app = self.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<git::Integrated> {
            git::fetch(&dir)?;
            let integrated = {
                let mut v = app.vault.lock();
                v.flush()?;
                let msg = commit_message(&v.pending_commit);
                git::commit_all(&v.dir, &msg)?;
                v.pending_commit.clear();
                let r = git::integrate(&v.dir)?;
                if !r.changed.is_empty() {
                    v.reload_types();
                    if v.reload_from_disk()? {
                        app.emit(Event::Reload);
                    }
                    app.emit(Event::Types);
                }
                r
            };
            *app.activity.lock() = Activity::default();
            if integrated.ahead > 0 {
                git::push(&dir)?;
            }
            Ok(integrated)
        })
        .await
        .map_err(|e| anyhow!("Synchronisation abgebrochen: {e}"))?;
        match result {
            Ok(r) => self.set_sync(|s| {
                s.running = false;
                s.last_sync = Some(unix_now());
                s.last_commit = Some(unix_now());
                s.resolved = r.resolved;
                s.remote = git::remote_url(&self.vault_dir());
            }),
            Err(e) => {
                tracing::warn!("Synchronisation fehlgeschlagen: {e:#}");
                self.set_sync(|s| {
                    s.running = false;
                    s.last_error = Some(format!("{e:#}"));
                });
            }
        }
        Ok(self.sync_status())
    }

    /// Remote setzen (oder entfernen) und gleich synchronisieren.
    pub async fn set_remote(self: &Arc<Self>, url: Option<String>) -> Result<SyncStatus> {
        let dir = self.vault_dir();
        git::set_remote(&dir, url.as_deref())?;
        self.set_sync(|s| {
            s.remote = git::remote_url(&dir);
            s.last_error = None;
        });
        if url.is_some() {
            return self.sync_now().await;
        }
        Ok(self.sync_status())
    }

    pub fn trigger_sync(&self) {
        self.sync_wake.notify_one();
    }

    /// Änderungen auf der Platte (Pfade relativ zum Notizbuch).
    pub fn on_disk_change(&self, paths: &[String]) {
        let mut v = self.vault.lock();
        if paths.iter().any(|p| p.replace('\\', "/") == crate::vault::types::FILE) {
            v.reload_types();
            v.version += 1;
            self.emit(Event::Types);
        }
        if paths.iter().any(|p| v.is_foreign_change(p)) {
            match v.reload_from_disk() {
                Ok(true) => {
                    v.pending_commit.insert("(extern geändert)".into());
                    drop(v);
                    self.touch();
                    self.emit(Event::Reload);
                }
                Ok(false) => {}
                Err(e) => tracing::warn!("Neu laden fehlgeschlagen: {e:#}"),
            }
        }
    }

    /// Startet die Hintergrundaufgaben.
    pub fn spawn_background(self: &Arc<Self>, rt: &tokio::runtime::Handle) {
        // Speichern: kurz nach jeder Änderung.
        let app = self.clone();
        rt.spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(400)).await;
                let app2 = app.clone();
                let _ = tokio::task::spawn_blocking(move || app2.flush()).await;
            }
        });
        // Versionen: nach einer Ruhepause, spätestens nach 5 Minuten.
        let app = self.clone();
        rt.spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let delay = Duration::from_secs(app.settings.lock().commit_delay_secs.max(2));
                let due = {
                    let a = app.activity.lock();
                    let pending = !app.vault.lock().pending_commit.is_empty();
                    pending
                        && (a.last_change.is_none_or(|t| t.elapsed() >= delay) || a.first_pending.is_some_and(|t| t.elapsed() >= Duration::from_secs(300)))
                };
                if due {
                    let app2 = app.clone();
                    let r = tokio::task::spawn_blocking(move || app2.commit_now()).await;
                    if let Ok(Err(e)) = r {
                        tracing::warn!("Version konnte nicht angelegt werden: {e:#}");
                    }
                }
            }
        });
        // Synchronisation: regelmäßig und kurz nach neuen Versionen.
        let app = self.clone();
        rt.spawn(async move {
            // Beim Start gleich einmal holen.
            tokio::time::sleep(Duration::from_secs(3)).await;
            loop {
                let (enabled, interval) = {
                    let s = app.settings.lock();
                    (s.sync_enabled, Duration::from_secs(s.sync_interval_minutes.max(1) * 60))
                };
                if enabled && git::remote_url(&app.vault_dir()).is_some() {
                    let _ = app.sync_now().await;
                }
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    _ = app.sync_wake.notified() => {
                        // Weitere Änderungen abwarten.
                        tokio::time::sleep(Duration::from_secs(10)).await;
                    }
                }
            }
        });
        // Erinnerungen
        let app = self.clone();
        rt.spawn(async move {
            let mut last = now() - chrono::Duration::minutes(2);
            loop {
                let until = now();
                let due = {
                    let v = app.vault.lock();
                    let s = app.settings.lock();
                    crate::agenda::reminders(&v, &s, last, until)
                };
                last = until;
                for r in due {
                    let fresh = {
                        let mut f = app.fired.lock();
                        f.insert(r.key.clone(), unix_now()).is_none()
                    };
                    if fresh {
                        let app2 = app.clone();
                        let id = r.id.clone();
                        let title = if r.todo { format!("Fällig: {}", r.text) } else { r.text.clone() };
                        crate::notify::show(&title, &r.human, Some(Box::new(move || app2.navigate(&id))));
                    }
                }
                app.save_fired();
                tokio::time::sleep(Duration::from_secs(20)).await;
            }
        });
        self.spawn_watcher();
    }

    fn save_fired(&self) {
        let mut f = self.fired.lock();
        let cutoff = unix_now() - 3 * 86400;
        f.retain(|_, t| *t > cutoff);
        if let Ok(json) = serde_json::to_string(&*f) {
            let _ = std::fs::write(self.config_dir.join("reminders.json"), json);
        }
    }

    /// Holt das Fenster nach vorne und zeigt einen Knoten.
    pub fn navigate(&self, id: &str) {
        if let Some(f) = self.shell.lock().focus.clone() {
            f();
        }
        self.emit(Event::Navigate { id: id.to_string() });
    }

    fn spawn_watcher(self: &Arc<Self>) {
        use notify::{RecursiveMode, Watcher};
        let dir = self.vault_dir();
        let app = self.clone();
        std::thread::spawn(move || {
            let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
            let Ok(mut watcher) = notify::recommended_watcher(tx) else { return };
            if let Err(e) = watcher.watch(&dir, RecursiveMode::Recursive) {
                tracing::warn!("Ordner kann nicht beobachtet werden: {e}");
                return;
            }
            let mut pending: BTreeSet<String> = BTreeSet::new();
            loop {
                let timeout = if pending.is_empty() { Duration::from_secs(3600) } else { Duration::from_millis(400) };
                match rx.recv_timeout(timeout) {
                    Ok(Ok(ev)) => {
                        if matches!(ev.kind, notify::EventKind::Access(_)) {
                            continue;
                        }
                        for p in ev.paths {
                            let Ok(rel) = p.strip_prefix(&dir) else { continue };
                            let rel = rel.to_string_lossy().replace('\\', "/");
                            if rel.is_empty() || rel.starts_with(".git/") || rel == ".git" || rel.ends_with(".hakobo-tmp") {
                                continue;
                            }
                            pending.insert(rel);
                        }
                    }
                    Ok(Err(_)) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if !pending.is_empty() {
                            let paths: Vec<String> = std::mem::take(&mut pending).into_iter().collect();
                            app.on_disk_change(&paths);
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            drop(watcher);
        });
    }

    /// Beim Beenden: speichern und Version festhalten.
    pub fn shutdown(&self) {
        if let Err(e) = self.commit_now() {
            tracing::warn!("Letzte Version konnte nicht angelegt werden: {e:#}");
        }
        self.save_fired();
    }
}

/// `@Name` → Link auf eine Person oder Seite (längster passender Titel aus bis zu drei Wörtern).
pub fn resolve_mentions(v: &mut Vault, text: &str) -> String {
    if !text.contains('@') {
        return text.to_string();
    }
    // Kandidaten: Personen zuerst, dann alle Seiten und Knoten mit Titel.
    let mut titles: Vec<(String, NodeId, bool)> = v
        .nodes()
        .filter(|n| n.kind != crate::vault::Kind::Root)
        .map(|n| (crate::vault::display_title(&n.text).to_lowercase(), n.id.clone(), v.has_tag(n, "person")))
        .filter(|(t, _, _)| !t.is_empty())
        .collect();
    titles.sort_by_key(|t| std::cmp::Reverse(t.2));
    let words: Vec<&str> = text.split(' ').collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let w = words[i];
        let at_word = w.starts_with('@') && w.len() > 1 && !w[1..].contains('@');
        if at_word {
            let mut found = None;
            for len in (1..=3).rev() {
                if i + len > words.len() {
                    continue;
                }
                let cand = words[i..i + len].join(" ");
                let name = cand[1..].trim_end_matches([',', '.', ';', ':', '!', '?']).to_lowercase();
                let hit = titles.iter().find(|(t, _, _)| *t == name).or_else(|| (len == 1).then(|| titles.iter().find(|(t, _, p)| *p && t.starts_with(&name))).flatten());
                if let Some((_, id, _)) = hit {
                    let tail: String = cand[1..].chars().rev().take_while(|c| matches!(c, ',' | '.' | ';' | ':' | '!' | '?')).collect();
                    found = Some((id.clone(), len, tail.chars().rev().collect::<String>()));
                    break;
                }
            }
            if let Some((id, len, tail)) = found
                && let Ok(link) = v.link_to(&id)
            {
                out.push(format!("{link}{tail}"));
                i += len;
                continue;
            }
        }
        out.push(w.to_string());
        i += 1;
    }
    out.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions_resolve_to_people() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("Personen")).unwrap();
        std::fs::write(tmp.path().join("Personen/Anna Schmidt.md"), "---\ntags: [person]\n---\n").unwrap();
        std::fs::write(tmp.path().join("Team.md"), "- Ben Meier #person\n").unwrap();
        let mut v = Vault::open(tmp.path()).unwrap();
        assert_eq!(resolve_mentions(&mut v, "Call mit @Anna Schmidt, morgen"), "Call mit [[Anna Schmidt]], morgen");
        assert_eq!(resolve_mentions(&mut v, "@anna fragen"), "[[Anna Schmidt]] fragen");
        let ben = resolve_mentions(&mut v, "an @ben");
        assert!(ben.starts_with("an [[Team#^"), "{ben}");
        assert!(ben.ends_with("|Ben Meier]]"), "{ben}");
        assert_eq!(resolve_mentions(&mut v, "mail an a@b.de"), "mail an a@b.de");
        assert_eq!(resolve_mentions(&mut v, "@niemand"), "@niemand");
    }

    #[test]
    fn commit_messages() {
        let mut s = BTreeSet::new();
        s.insert("Inbox".to_string());
        assert!(commit_message(&s).starts_with("Bearbeitet: Inbox\n\nGerät: "));
        for p in ["A", "B", "C", "D"] {
            s.insert(p.into());
        }
        assert!(commit_message(&s).starts_with("Bearbeitet: A, B und 3 weitere"));
    }
}
