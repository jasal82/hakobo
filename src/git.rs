//! Versionierung des Notizbuchs. Lokale Operationen (Commit, Verlauf) laufen
//! über libgit2, Netzwerk-Operationen über die installierte `git`-CLI, damit
//! vorhandene Anmeldedaten (Credential Manager, SSH-Agent) greifen.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use git2::{IndexAddOption, Oid, Repository, Signature};
use serde::Serialize;

use crate::proc::NoWindow;

const GITATTRIBUTES: &str = "# Sqizzo: gleichzeitige Änderungen ohne Konfliktmarker zusammenführen\n*.md merge=union\n* text=auto\n";
const GITIGNORE: &str = "# Sqizzo\n.*.sqizzo-tmp\n.obsidian/workspace*.json\n.trash/\n.DS_Store\nThumbs.db\ndesktop.ini\n";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short: String,
    pub summary: String,
    pub author: String,
    pub time: i64,
}

pub fn cli_available() -> bool {
    static AVAIL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *AVAIL.get_or_init(|| Command::new("git").arg("--version").no_window().output().map(|o| o.status.success()).unwrap_or(false))
}

pub fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|h| !h.is_empty())
        .or_else(|| {
            Command::new("hostname").no_window().output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|h| !h.is_empty())
        })
        .unwrap_or_else(|| "unbekannt".into())
}

fn open(dir: &Path) -> Result<Repository> {
    Repository::open(dir).map_err(|e| anyhow!("Kein Git-Repository in {}: {}", dir.display(), e.message()))
}

pub fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

fn signature(repo: &Repository) -> Signature<'static> {
    if let Ok(sig) = repo.signature() {
        return sig.to_owned();
    }
    let host = hostname();
    Signature::now(&format!("Sqizzo ({host})"), "sqizzo@localhost").expect("Signatur")
}

/// Legt Repository, `.gitattributes` und `.gitignore` an (falls nötig).
pub fn ensure_repo(dir: &Path) -> Result<()> {
    let fresh = !is_repo(dir);
    if fresh {
        let mut opts = git2::RepositoryInitOptions::new();
        opts.initial_head("main");
        Repository::init_opts(dir, &opts).with_context(|| format!("Git-Repository in {} konnte nicht angelegt werden", dir.display()))?;
    }
    let attrs = dir.join(".gitattributes");
    match std::fs::read_to_string(&attrs) {
        Ok(text) if text.contains("merge=union") => {}
        Ok(text) => std::fs::write(&attrs, format!("{}\n{GITATTRIBUTES}", text.trim_end()))?,
        Err(_) => std::fs::write(&attrs, GITATTRIBUTES)?,
    }
    let ignore = dir.join(".gitignore");
    match std::fs::read_to_string(&ignore) {
        Ok(text) if text.contains(".sqizzo-tmp") => {}
        Ok(text) => std::fs::write(&ignore, format!("{}\n{GITIGNORE}", text.trim_end()))?,
        Err(_) => std::fs::write(&ignore, GITIGNORE)?,
    }
    if fresh {
        commit_all(dir, "Notizbuch angelegt")?;
    }
    Ok(())
}

/// Committet alle Änderungen. `None`, wenn es nichts zu committen gab.
pub fn commit_all(dir: &Path, message: &str) -> Result<Option<String>> {
    let repo = open(dir)?;
    if repo.state() != git2::RepositoryState::Clean {
        bail!("Das Repository ist mitten in einer Zusammenführung.");
    }
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"].iter(), None)?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if let Some(p) = &parent
        && p.tree_id() == tree_id
    {
        return Ok(None);
    }
    let tree = repo.find_tree(tree_id)?;
    let sig = signature(&repo);
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
    Ok(Some(oid.to_string()))
}

/// Zeitpunkt der letzten Version (Unix-Sekunden).
pub fn head_time(dir: &Path) -> Option<i64> {
    let repo = open(dir).ok()?;
    let c = repo.head().ok()?.peel_to_commit().ok()?;
    Some(c.time().seconds())
}

pub fn head(dir: &Path) -> Option<String> {
    let repo = open(dir).ok()?;
    let id = repo.head().ok()?.target()?;
    Some(id.to_string())
}

fn branch(repo: &Repository) -> String {
    repo.head().ok().and_then(|h| h.shorthand().ok().map(str::to_string)).filter(|b| b != "HEAD").unwrap_or_else(|| "main".into())
}

/// Geänderte Dateien zwischen zwei Commits.
pub fn changed_paths(dir: &Path, from: &str, to: &str) -> Result<Vec<String>> {
    let repo = open(dir)?;
    let a = repo.find_commit(Oid::from_str(from)?)?.tree()?;
    let b = repo.find_commit(Oid::from_str(to)?)?.tree()?;
    let diff = repo.diff_tree_to_tree(Some(&a), Some(&b), None)?;
    let mut out = Vec::new();
    for d in diff.deltas() {
        for f in [d.old_file(), d.new_file()] {
            if let Some(p) = f.path() {
                let p = p.to_string_lossy().replace('\\', "/");
                if !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    Ok(out)
}

/// Verlauf (optional nur Commits, die eine Datei betreffen).
pub fn log(dir: &Path, path: Option<&str>, limit: usize) -> Result<Vec<CommitInfo>> {
    let repo = open(dir)?;
    let mut walk = repo.revwalk()?;
    if walk.push_head().is_err() {
        return Ok(vec![]);
    }
    walk.set_sorting(git2::Sort::TIME)?;
    let mut out = Vec::new();
    for oid in walk.flatten() {
        let Ok(c) = repo.find_commit(oid) else { continue };
        if let Some(p) = path
            && !touches(&repo, &c, p)
        {
            continue;
        }
        let id = c.id().to_string();
        out.push(CommitInfo {
            short: id[..8].to_string(),
            id,
            summary: c.summary().ok().flatten().unwrap_or("").to_string(),
            author: c.author().name().unwrap_or("").to_string(),
            time: c.time().seconds(),
        });
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

fn blob_id(tree: &git2::Tree, path: &str) -> Option<Oid> {
    tree.get_path(Path::new(path)).ok().map(|e| e.id())
}

fn touches(_repo: &Repository, c: &git2::Commit, path: &str) -> bool {
    let Ok(tree) = c.tree() else { return false };
    let now = blob_id(&tree, path);
    if c.parent_count() == 0 {
        return now.is_some();
    }
    // Bei Zusammenführungen zählt nur eine Änderung gegenüber allen Eltern.
    c.parents().all(|p| p.tree().ok().and_then(|t| blob_id(&t, path)) != now)
}

/// Inhalt einer Datei in einer Version (`None`: gab es dort nicht).
pub fn file_at(dir: &Path, rev: &str, path: &str) -> Result<Option<String>> {
    let repo = open(dir)?;
    let commit = repo.revparse_single(rev)?.peel_to_commit()?;
    let tree = commit.tree()?;
    let Ok(entry) = tree.get_path(Path::new(path)) else { return Ok(None) };
    let blob = repo.find_blob(entry.id())?;
    Ok(Some(String::from_utf8_lossy(blob.content()).into_owned()))
}

// ---------------------------------------------------------------------------
// Synchronisation über die git-CLI
// ---------------------------------------------------------------------------

/// Führt git aus (ohne Rückfragen, mit Zeitlimit).
fn run_git(dir: &Path, args: &[&str], timeout: Duration) -> Result<String> {
    if !cli_available() {
        bail!("Für die Synchronisation wird Git benötigt (https://git-scm.com).");
    }
    let mut child = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .no_window()
        .spawn()
        .context("git konnte nicht gestartet werden")?;
    let start = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            bail!("git {} hat zu lange gedauert (Zeitlimit {} s).", args.first().unwrap_or(&""), timeout.as_secs());
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    let out = child.wait_with_output()?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if out.status.success() { Ok(text.trim().to_string()) } else { bail!("{}", text.trim()) }
}

const NET: Duration = Duration::from_secs(90);
const LOCAL: Duration = Duration::from_secs(30);

pub fn remote_url(dir: &Path) -> Option<String> {
    let repo = open(dir).ok()?;
    let r = repo.find_remote("origin").ok()?;
    r.url().ok().map(str::to_string)
}

pub fn set_remote(dir: &Path, url: Option<&str>) -> Result<()> {
    let repo = open(dir)?;
    match url.map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => {
            if repo.find_remote("origin").is_ok() {
                repo.remote_set_url("origin", u)?;
            } else {
                repo.remote("origin", u)?;
            }
        }
        None => {
            if repo.find_remote("origin").is_ok() {
                repo.remote_delete("origin")?;
            }
        }
    }
    Ok(())
}

/// Name des Zweigs im Remote (gleichnamig, sonst dessen HEAD, sonst lokal).
fn remote_branch(dir: &Path, repo: &Repository) -> String {
    let local = branch(repo);
    if repo.find_reference(&format!("refs/remotes/origin/{local}")).is_ok() {
        return local;
    }
    if let Ok(out) = run_git(dir, &["ls-remote", "--symref", "origin", "HEAD"], NET)
        && let Some(line) = out.lines().find(|l| l.starts_with("ref: refs/heads/"))
        && let Some(name) = line.trim_start_matches("ref: refs/heads/").split_whitespace().next()
    {
        return name.to_string();
    }
    for b in ["main", "master"] {
        if repo.find_reference(&format!("refs/remotes/origin/{b}")).is_ok() {
            return b.to_string();
        }
    }
    local
}

/// Holt Änderungen vom Remote (ohne sie einzuspielen).
pub fn fetch(dir: &Path) -> Result<()> {
    run_git(dir, &["fetch", "--prune", "origin"], NET).map(|_| ())
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Integrated {
    /// Lokale Commits, die noch hochgeladen werden müssen.
    pub ahead: usize,
    /// Dateien, die sich durch das Einspielen geändert haben.
    pub changed: Vec<String>,
    /// Konflikte, die automatisch aufgelöst wurden.
    pub resolved: Vec<String>,
}

/// Spielt geholte Änderungen ein (Fast-Forward oder Zusammenführung).
/// Muss bei gesperrtem Notizbuch laufen (Dateien ändern sich).
pub fn integrate(dir: &Path) -> Result<Integrated> {
    let repo = open(dir)?;
    let rb = remote_branch(dir, &repo);
    let remote_ref = format!("refs/remotes/origin/{rb}");
    let Ok(remote) = repo.find_reference(&remote_ref).and_then(|r| r.peel_to_commit()) else {
        // Remote ist leer: alles muss hochgeladen werden.
        let ahead = repo.head().is_ok() as usize;
        return Ok(Integrated { ahead, ..Default::default() });
    };
    let Some(local) = repo.head().ok().and_then(|h| h.peel_to_commit().ok()) else {
        // Lokal noch nichts: Remote übernehmen.
        run_git(dir, &["reset", "--hard", &format!("origin/{rb}")], LOCAL)?;
        return Ok(Integrated { changed: vec!["*".into()], ..Default::default() });
    };
    let (ahead, behind) = repo.graph_ahead_behind(local.id(), remote.id())?;
    if behind == 0 {
        return Ok(Integrated { ahead, ..Default::default() });
    }
    let before = local.id().to_string();
    let target = format!("origin/{rb}");
    let mut resolved = Vec::new();
    if ahead == 0 {
        run_git(dir, &["merge", "--ff-only", &target], LOCAL)?;
    } else {
        let msg = format!("Synchronisiert ({})", hostname());
        let unrelated = repo.merge_base(local.id(), remote.id()).is_err();
        let mut args = vec!["merge", "--no-edit", "-m", &msg];
        if unrelated {
            // Erstes Verbinden mit einem bestehenden Notizbuch: Bei Konflikten
            // außerhalb von Markdown (z. B. Typen) gewinnt das Remote.
            args.extend(["--allow-unrelated-histories", "-X", "theirs"]);
        }
        args.push(&target);
        if let Err(e) = run_git(dir, &args, LOCAL) {
            resolved = resolve_conflicts(dir).with_context(|| format!("Zusammenführen fehlgeschlagen: {e:#}"))?;
            run_git(dir, &["commit", "--no-edit", "-m", &msg], LOCAL)?;
        }
    }
    let after = head(dir).unwrap_or_default();
    let changed = if after != before { changed_paths(dir, &before, &after)? } else { vec![] };
    let repo = open(dir)?;
    let (ahead, _) = match (repo.head().ok().and_then(|h| h.target()), repo.find_reference(&remote_ref).ok().and_then(|r| r.target())) {
        (Some(l), Some(r)) => repo.graph_ahead_behind(l, r)?,
        _ => (0, 0),
    };
    Ok(Integrated { ahead, changed, resolved })
}

/// Löst verbliebene Konflikte: Markdown zeilenweise vereinigt, sonst die
/// lokale Fassung; gelöschte gegen geänderte Dateien → die geänderte bleibt.
fn resolve_conflicts(dir: &Path) -> Result<Vec<String>> {
    let out = run_git(dir, &["diff", "--name-only", "--diff-filter=U", "-z"], LOCAL)?;
    let files: Vec<String> = out.split('\0').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect();
    if files.is_empty() {
        bail!("Unbekannter Fehler beim Zusammenführen");
    }
    let repo = open(dir)?;
    let index = repo.index()?;
    for f in &files {
        let mut stages: [Option<Oid>; 3] = [None, None, None];
        if let Ok(conflicts) = index.conflicts() {
            for c in conflicts.flatten() {
                let path = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref()).map(|e| String::from_utf8_lossy(&e.path).replace('\\', "/"));
                if path.as_deref() == Some(f.as_str()) {
                    stages = [c.ancestor.map(|e| e.id), c.our.map(|e| e.id), c.their.map(|e| e.id)];
                }
            }
        }
        let blob = |id: Option<Oid>| id.and_then(|i| repo.find_blob(i).ok()).map(|b| b.content().to_vec());
        let (base, ours, theirs) = (blob(stages[0]), blob(stages[1]), blob(stages[2]));
        let path = dir.join(f);
        match (ours, theirs) {
            (Some(o), Some(t)) => {
                let merged = if f.ends_with(".md") { union_merge(base.as_deref().unwrap_or(&[]), &o, &t) } else { o };
                std::fs::write(&path, merged)?;
                run_git(dir, &["add", "--", f], LOCAL)?;
            }
            (Some(o), None) => {
                std::fs::write(&path, o)?;
                run_git(dir, &["add", "--", f], LOCAL)?;
            }
            (None, Some(t)) => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&path, t)?;
                run_git(dir, &["add", "--", f], LOCAL)?;
            }
            (None, None) => {
                run_git(dir, &["rm", "--cached", "--ignore-unmatch", "--", f], LOCAL)?;
            }
        }
    }
    Ok(files)
}

/// Zeilenweise Vereinigung über `git merge-file --union` (Rückfall: beide Fassungen).
fn union_merge(base: &[u8], ours: &[u8], theirs: &[u8]) -> Vec<u8> {
    let tmp = std::env::temp_dir().join(format!("sqizzo-merge-{}", rand::random::<u32>()));
    let result = (|| -> Result<Vec<u8>> {
        std::fs::create_dir_all(&tmp)?;
        let (o, b, t) = (tmp.join("ours"), tmp.join("base"), tmp.join("theirs"));
        std::fs::write(&o, ours)?;
        std::fs::write(&b, base)?;
        std::fs::write(&t, theirs)?;
        let status = Command::new("git").args(["merge-file", "--union"]).arg(&o).arg(&b).arg(&t).no_window().output()?;
        if !status.status.success() && status.status.code().is_none_or(|c| c < 0) {
            bail!("merge-file fehlgeschlagen");
        }
        Ok(std::fs::read(&o)?)
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    result.unwrap_or_else(|_| {
        let mut v = ours.to_vec();
        if !v.ends_with(b"\n") {
            v.push(b'\n');
        }
        v.extend_from_slice(theirs);
        v
    })
}

/// Lädt lokale Commits hoch.
pub fn push(dir: &Path) -> Result<()> {
    let repo = open(dir)?;
    let local = branch(&repo);
    let rb = remote_branch(dir, &repo);
    run_git(dir, &["push", "-u", "origin", &format!("{local}:{rb}")], NET).map(|_| ())
}

/// Klont ein Remote in einen leeren Ordner.
pub fn clone(url: &str, dir: &Path) -> Result<()> {
    if dir.exists() && std::fs::read_dir(dir)?.next().is_some() {
        bail!("Der Zielordner {} ist nicht leer.", dir.display());
    }
    let parent = dir.parent().ok_or_else(|| anyhow!("Ungültiger Zielordner"))?;
    std::fs::create_dir_all(parent)?;
    run_git(parent, &["clone", url, &dir.to_string_lossy()], Duration::from_secs(600))?;
    // Zeigt das HEAD des Remotes ins Leere (z. B. „master“, hochgeladen wurde
    // „main“), ist nichts ausgecheckt: vorhandenen Zweig übernehmen.
    let repo = open(dir)?;
    if repo.head().is_err() {
        let candidates = ["main", "master"];
        let found = candidates
            .iter()
            .map(|b| b.to_string())
            .find(|b| repo.find_reference(&format!("refs/remotes/origin/{b}")).is_ok())
            .or_else(|| {
                repo.references_glob("refs/remotes/origin/*").ok()?.flatten().find_map(|r| {
                    let name = r.shorthand().ok()?.trim_start_matches("origin/").to_string();
                    (name != "HEAD").then_some(name)
                })
            });
        if let Some(b) = found {
            run_git(dir, &["checkout", "-B", &b, "--track", &format!("origin/{b}")], LOCAL)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &Path, args: &[&str]) -> String {
        run_git(dir, args, LOCAL).unwrap()
    }

    fn setup_identity(dir: &Path) {
        git(dir, &["config", "user.name", "Test"]);
        git(dir, &["config", "user.email", "test@example.com"]);
    }

    #[test]
    fn commit_only_when_changed() {
        let tmp = tempfile::tempdir().unwrap();
        ensure_repo(tmp.path()).unwrap();
        assert!(tmp.path().join(".gitattributes").exists());
        assert!(commit_all(tmp.path(), "leer").unwrap().is_none());
        std::fs::write(tmp.path().join("A.md"), "- a\n").unwrap();
        assert!(commit_all(tmp.path(), "A").unwrap().is_some());
        std::fs::remove_file(tmp.path().join("A.md")).unwrap();
        assert!(commit_all(tmp.path(), "A weg").unwrap().is_some());
        let log = log(tmp.path(), Some("A.md"), 10).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(file_at(tmp.path(), &log[1].id, "A.md").unwrap().as_deref(), Some("- a\n"));
        assert_eq!(file_at(tmp.path(), &log[0].id, "A.md").unwrap(), None);
    }

    #[test]
    fn sync_two_clones_with_union_merge() {
        if !cli_available() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let remote = tmp.path().join("remote.git");
        std::fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare", "-b", "main"]);
        let remote_url = remote.to_string_lossy().replace('\\', "/");

        // Gerät A legt an und lädt hoch
        let a = tmp.path().join("a");
        std::fs::create_dir_all(&a).unwrap();
        ensure_repo(&a).unwrap();
        setup_identity(&a);
        std::fs::write(a.join("Inbox.md"), "- eins\n- zwei\n").unwrap();
        commit_all(&a, "A1").unwrap();
        set_remote(&a, Some(&remote_url)).unwrap();
        fetch(&a).unwrap();
        let r = integrate(&a).unwrap();
        assert!(r.ahead > 0);
        push(&a).unwrap();

        // Gerät B klont
        let b = tmp.path().join("b");
        clone(&remote_url, &b).unwrap();
        setup_identity(&b);
        assert_eq!(std::fs::read_to_string(b.join("Inbox.md")).unwrap().replace("\r\n", "\n"), "- eins\n- zwei\n");

        // Beide ändern dieselbe Stelle
        std::fs::write(a.join("Inbox.md"), "- eins\n- zwei\n- von A\n").unwrap();
        commit_all(&a, "A2").unwrap();
        fetch(&a).unwrap();
        integrate(&a).unwrap();
        push(&a).unwrap();
        std::fs::write(b.join("Inbox.md"), "- eins\n- zwei\n- von B\n").unwrap();
        commit_all(&b, "B1").unwrap();
        fetch(&b).unwrap();
        let r = integrate(&b).unwrap();
        assert!(r.changed.contains(&"Inbox.md".to_string()));
        let text = std::fs::read_to_string(b.join("Inbox.md")).unwrap().replace("\r\n", "\n");
        assert!(text.contains("- von A") && text.contains("- von B"), "{text}");
        assert!(!text.contains("<<<<<<<"));
        push(&b).unwrap();

        // A holt das Ergebnis per Fast-Forward
        fetch(&a).unwrap();
        let r = integrate(&a).unwrap();
        assert_eq!(r.ahead, 0);
        let text_a = std::fs::read_to_string(a.join("Inbox.md")).unwrap().replace("\r\n", "\n");
        assert_eq!(text_a, text);
    }

    #[test]
    fn clone_checks_out_branch_when_remote_head_is_dangling() {
        if !cli_available() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let remote = tmp.path().join("remote.git");
        std::fs::create_dir_all(&remote).unwrap();
        // HEAD zeigt auf „master“, hochgeladen wird „main“.
        git(&remote, &["init", "--bare", "-b", "master"]);
        let url = remote.to_string_lossy().replace('\\', "/");
        let a = tmp.path().join("a");
        std::fs::create_dir_all(&a).unwrap();
        ensure_repo(&a).unwrap();
        setup_identity(&a);
        std::fs::write(a.join("Inbox.md"), "- eins\n").unwrap();
        commit_all(&a, "1").unwrap();
        set_remote(&a, Some(&url)).unwrap();
        push(&a).unwrap();
        let b = tmp.path().join("b");
        clone(&url, &b).unwrap();
        assert!(b.join("Inbox.md").exists());
    }

    #[test]
    fn non_markdown_conflict_keeps_local() {
        if !cli_available() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let remote = tmp.path().join("remote.git");
        std::fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare", "-b", "main"]);
        let url = remote.to_string_lossy().replace('\\', "/");
        let a = tmp.path().join("a");
        std::fs::create_dir_all(a.join(".sqizzo")).unwrap();
        ensure_repo(&a).unwrap();
        setup_identity(&a);
        std::fs::write(a.join(".sqizzo/types.toml"), "x = 1\n").unwrap();
        commit_all(&a, "1").unwrap();
        set_remote(&a, Some(&url)).unwrap();
        push(&a).unwrap();
        let b = tmp.path().join("b");
        clone(&url, &b).unwrap();
        setup_identity(&b);
        std::fs::write(a.join(".sqizzo/types.toml"), "x = 2\n").unwrap();
        commit_all(&a, "2").unwrap();
        push(&a).unwrap();
        std::fs::write(b.join(".sqizzo/types.toml"), "x = 3\n").unwrap();
        commit_all(&b, "3").unwrap();
        fetch(&b).unwrap();
        let r = integrate(&b).unwrap();
        assert_eq!(r.resolved, vec![".sqizzo/types.toml".to_string()]);
        assert_eq!(std::fs::read_to_string(b.join(".sqizzo/types.toml")).unwrap().replace("\r\n", "\n"), "x = 3\n");
        assert_eq!(open(&b).unwrap().state(), git2::RepositoryState::Clean);
    }
}
