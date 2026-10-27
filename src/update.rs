// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Update-Prüfung und Selbstaktualisierung aus den GitHub-Releases (nur lokale App).
//!
//! Die Prüfung fragt GitHub nur nach dem neuesten Release. Ein Update lädt das Paket für diese
//! Plattform, prüft seine SHA-256-Prüfsumme und
//! - führt unter Windows das neue Setup aus (installierte Version), das das Programm ersetzt und
//!   wieder startet, oder
//! - ersetzt die Programmdatei neben der laufenden (portables ZIP, Archiv für macOS und Linux)
//!   und startet die neue Version. Die laufende Datei wird vorher in `*.old` umbenannt – das
//!   geht auch unter Windows.
//!
//! Die neue Version übernimmt Port und Zugangstoken der alten (siehe [`Restart`]): Offene
//! Browser-Tabs bleiben angemeldet und laden sich nur neu, die Kommandozeile findet die App
//! unter derselben Adresse.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, LazyLock, OnceLock};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const LATEST_URL: &str = "https://api.github.com/repos/jasal82/hakobo/releases/latest";
/// Port und Zugangstoken der vorigen Instanz für das Programm, das nach einem Update startet.
const RESTART_PORT_ENV: &str = "HAKOBO_RESTART_PORT";
const RESTART_TOKEN_ENV: &str = "HAKOBO_RESTART_TOKEN";

/// Programmdatei, wie build.cmd und build.sh sie ausliefern.
#[cfg(windows)]
const PROGRAM: &str = "Hakobo.exe";
#[cfg(not(windows))]
const PROGRAM: &str = "hakobo";
/// Lizenztexte, die jedes Paket neben dem Programm ausliefert (ein Build unter target/ nicht).
const DOCS: [&str; 2] = ["LICENSE.txt", "THIRD-PARTY-LICENSES.txt"];

// ---------------------------------------------------------------------------
// Neustart nach einem Update
// ---------------------------------------------------------------------------

/// Angaben der vorigen Instanz, wenn das Programm nach einem Update startet.
pub struct Restart {
    pub port: u16,
    pub token: String,
}

/// Liest die Angaben der vorigen Instanz und entfernt sie aus der Umgebung, damit sie nicht an
/// weitere Programme (Git, Browser, ein späteres Update) vererbt werden. Muss zu Beginn von
/// `main` aufgerufen werden, bevor weitere Threads laufen.
pub fn take_restart() -> Option<Restart> {
    let port = std::env::var(RESTART_PORT_ENV).ok().and_then(|p| p.parse().ok());
    let token = std::env::var(RESTART_TOKEN_ENV).ok().filter(|t| !t.is_empty());
    // SAFETY: Aufruf zu Beginn von main, es läuft noch kein weiterer Thread.
    unsafe {
        std::env::remove_var(RESTART_PORT_ENV);
        std::env::remove_var(RESTART_TOKEN_ENV);
    }
    Some(Restart { port: port?, token: token? })
}

/// Wartet (höchstens 30 s), bis die vorige Version ihren Port freigegeben hat. Erst dann ist sie
/// ganz beendet – letzte Änderungen committet, Instanz abgemeldet – und das Notizbuch gehört
/// dieser Version; sonst kämen sich beide bei Git in die Quere.
pub fn wait_for_previous(port: u16) {
    for _ in 0..120 {
        match std::net::TcpListener::bind(("127.0.0.1", port)) {
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => std::thread::sleep(Duration::from_millis(250)),
            _ => return,
        }
    }
    tracing::warn!("Die vorige Version gibt Port {port} nicht frei – starte trotzdem");
}

/// Die laufende lokale App; ohne sie (Server-Modus, Kommandozeile) gibt es keine Updates.
struct Local {
    port: u16,
    token: String,
    work: PathBuf,
    config: PathBuf,
}

static LOCAL: OnceLock<Local> = OnceLock::new();

/// Schaltet Updates für die lokale App frei. `work`: Ordner für Downloads.
pub fn enable(port: u16, token: &str, work: &Path, config_dir: &Path) {
    let _ = LOCAL.set(Local { port, token: token.to_string(), work: work.to_path_buf(), config: config_dir.to_path_buf() });
}

pub fn enabled() -> bool {
    LOCAL.get().is_some()
}

static QUIT: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

/// Legt fest, wie sich das Programm für ein Update beendet (speichern, Fenster schließen).
pub fn set_quit_handler(f: impl Fn() + Send + Sync + 'static) {
    let _ = QUIT.set(Box::new(f));
}

fn quit() {
    match QUIT.get() {
        Some(f) => f(),
        None => std::process::exit(0),
    }
}

// ---------------------------------------------------------------------------
// Release und Status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}

impl Release {
    fn version(&self) -> &str {
        self.tag_name.trim_start_matches('v')
    }

    fn is_update(&self) -> bool {
        !self.draft && !self.prerelease && is_newer(self.version(), VERSION)
    }
}

#[derive(Debug, Clone, Deserialize)]
struct Asset {
    name: String,
    #[serde(default)]
    size: u64,
    browser_download_url: String,
    /// `sha256:<hex>`, von GitHub für jede hochgeladene Datei veröffentlicht.
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// Updates gibt es nur in der lokalen App, nicht im Server-Modus.
    pub enabled: bool,
    pub current: String,
    /// Neueste veröffentlichte Version, sobald geprüft wurde.
    pub latest: Option<String>,
    pub available: bool,
    pub published_at: Option<String>,
    /// Versionshinweise (Markdown von GitHub).
    pub notes: String,
    pub release_url: String,
    pub checked_at: Option<String>,
    /// Warum die letzte Prüfung fehlschlug.
    pub check_error: String,
    /// Hakobo kann das Update selbst installieren; sonst Download über `release_url`.
    pub can_install: bool,
    /// Wie das Update installiert wird oder warum Hakobo es nicht selbst kann.
    pub install_note: String,
    pub download_size: u64,
    /// idle | downloading | installing | restarting | failed
    pub phase: &'static str,
    /// Fortschritt des Downloads 0…1.
    pub progress: f64,
    /// Warum die letzte Installation fehlschlug.
    pub error: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Downloading,
    Installing,
    Restarting,
    Failed,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Downloading => "downloading",
            Phase::Installing => "installing",
            Phase::Restarting => "restarting",
            Phase::Failed => "failed",
        }
    }

    fn busy(self) -> bool {
        matches!(self, Phase::Downloading | Phase::Installing | Phase::Restarting)
    }
}

struct State {
    release: Option<Release>,
    checked_at: Option<String>,
    check_error: String,
    phase: Phase,
    done: u64,
    total: u64,
    error: String,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| {
    Mutex::new(State { release: None, checked_at: None, check_error: String::new(), phase: Phase::Idle, done: 0, total: 0, error: String::new() })
});

// ---------------------------------------------------------------------------
// Installationsart
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Method {
    /// Windows-Installation durch das Setup (Inno Setup).
    Installer,
    /// Portables ZIP oder tar.gz: Die Dateien neben dem Programm werden ersetzt.
    Replace,
}

#[derive(Debug, Clone)]
struct Target {
    method: Method,
    exe: PathBuf,
    dir: PathBuf,
}

/// Warum diese Installation nicht selbst aktualisiert werden kann.
#[derive(Debug, Clone)]
enum Unsupported {
    Debug,
    NoExe(String),
    NotPackaged,
    ReadOnly(PathBuf),
    NoPackage,
}

impl Unsupported {
    fn message(&self) -> String {
        match self {
            Unsupported::Debug => "Entwicklungsversion – Updates bitte aus dem Quellcode bauen.".into(),
            Unsupported::NoExe(e) => format!("Die Programmdatei wurde nicht gefunden ({e})."),
            Unsupported::NotPackaged => "Dieses Programm stammt nicht aus einem Hakobo-Paket – bitte manuell aktualisieren.".into(),
            Unsupported::ReadOnly(dir) => format!("Keine Schreibrechte im Programmordner {} – bitte manuell aktualisieren.", dir.display()),
            Unsupported::NoPackage => "Für dieses System gibt es kein passendes Paket – bitte manuell aktualisieren.".into(),
        }
    }
}

/// Wie diese Installation aktualisiert wird – einmal bestimmt, die Programmdatei wandert nicht.
static TARGET: LazyLock<Result<Target, Unsupported>> = LazyLock::new(detect);

fn detect() -> Result<Target, Unsupported> {
    if cfg!(debug_assertions) {
        return Err(Unsupported::Debug);
    }
    let exe = std::env::current_exe().map_err(|e| Unsupported::NoExe(e.to_string()))?;
    let exe = crate::vault::dunce(&exe);
    let dir = exe.parent().map(Path::to_path_buf).ok_or_else(|| Unsupported::NoExe(exe.display().to_string()))?;
    let name = exe.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let ours = if cfg!(windows) { name.eq_ignore_ascii_case(PROGRAM) } else { name == PROGRAM };
    // Jedes Paket liefert die Lizenztexte neben dem Programm aus; ein Build unter target/ nicht.
    if !ours || !dir.join(DOCS[0]).is_file() {
        return Err(Unsupported::NotPackaged);
    }
    if cfg!(windows) && dir.join("unins000.exe").is_file() {
        return Ok(Target { method: Method::Installer, exe, dir });
    }
    if !writable(&dir) {
        return Err(Unsupported::ReadOnly(dir));
    }
    Ok(Target { method: Method::Replace, exe, dir })
}

fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".hakobo-write-test-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// `1.2.3` (ein führendes `v` wird ignoriert); Vorabversionen wie `1.2.3-rc1` werden nicht angeboten.
fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.trim().trim_start_matches('v').split('.').map(|p| p.parse::<u64>().ok());
    let version = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(version)
}

fn is_newer(latest: &str, current: &str) -> bool {
    matches!((parse_version(latest), parse_version(current)), (Some(l), Some(c)) if l > c)
}

/// Paketname für dieses System (siehe build.cmd, build.sh und den Release-Workflow).
fn package_name(version: &str, method: Method) -> Option<String> {
    package_name_for(version, method, std::env::consts::OS, std::env::consts::ARCH)
}

fn package_name_for(version: &str, method: Method, os: &str, arch: &str) -> Option<String> {
    let arch = match arch {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        _ => return None,
    };
    Some(match (os, method) {
        ("windows", Method::Installer) => format!("Hakobo-{version}-windows-{arch}-setup.exe"),
        ("windows", Method::Replace) => format!("Hakobo-{version}-windows-{arch}-portable.zip"),
        ("macos" | "linux", Method::Replace) => format!("Hakobo-{version}-{os}-{arch}.tar.gz"),
        _ => return None,
    })
}

fn plan(r: &Release) -> Result<(Target, Asset), Unsupported> {
    let target = TARGET.clone()?;
    package_name(r.version(), target.method)
        .and_then(|n| r.assets.iter().find(|a| a.name == n))
        .cloned()
        .map(|a| (target, a))
        .ok_or(Unsupported::NoPackage)
}

pub fn status() -> UpdateStatus {
    let s = STATE.lock();
    let mut out = UpdateStatus {
        enabled: enabled(),
        current: VERSION.into(),
        checked_at: s.checked_at.clone(),
        check_error: s.check_error.clone(),
        phase: s.phase.as_str(),
        progress: if s.total > 0 { (s.done as f64 / s.total as f64).min(1.0) } else { 0.0 },
        error: s.error.clone(),
        ..Default::default()
    };
    let Some(r) = &s.release else { return out };
    out.latest = Some(r.version().to_string());
    out.available = r.is_update();
    out.published_at = r.published_at.clone();
    out.notes = r.body.clone().unwrap_or_default();
    out.release_url = r.html_url.clone();
    if out.available {
        match plan(r) {
            Ok((t, a)) => {
                out.can_install = true;
                out.download_size = a.size;
                out.install_note = match t.method {
                    Method::Installer => "Das Installationsprogramm der neuen Version wird heruntergeladen und ausgeführt.".into(),
                    Method::Replace => format!("Die Programmdatei in {} wird ersetzt.", t.dir.display()),
                };
            }
            Err(e) => out.install_note = e.message(),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Prüfung
// ---------------------------------------------------------------------------

/// Fragt GitHub nach dem neuesten Release; ein Fehler bleibt im Status stehen.
pub fn check() -> UpdateStatus {
    let result = fetch_release();
    {
        let mut s = STATE.lock();
        s.checked_at = Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        match result {
            Ok(r) => {
                s.release = Some(r);
                s.check_error.clear();
            }
            Err(e) => {
                tracing::info!("Update-Prüfung fehlgeschlagen: {e:#}");
                s.check_error = format!("{e:#}");
            }
        }
    }
    status()
}

/// Sucht beim Start und danach täglich nach einer neuen Version, sofern nicht abgeschaltet.
pub fn spawn_checks(rt: &tokio::runtime::Handle) {
    rt.spawn(async {
        let mut daily = tokio::time::interval(Duration::from_secs(24 * 3600));
        loop {
            daily.tick().await;
            let _ = tokio::task::spawn_blocking(|| {
                cleanup();
                if auto_check() {
                    check();
                }
            })
            .await;
        }
    });
}

/// Einstellung „Automatisch nach Updates suchen“ (Standard: an).
fn auto_check() -> bool {
    LOCAL.get().is_some_and(|local| crate::settings::Settings::load(&local.config).update_check)
}

/// System-TLS und Proxy aus der Umgebung (`HTTPS_PROXY`, `NO_PROXY`).
fn agent(url: &str, timeout: Duration) -> Result<ureq::Agent> {
    let mut builder = ureq::AgentBuilder::new()
        .user_agent(&format!("Hakobo/{VERSION}"))
        .timeout_connect(Duration::from_secs(15))
        .timeout(timeout);
    if let Some(proxy) = env_proxy::for_url_str(url).to_url().and_then(|u| ureq::Proxy::new(u).ok()) {
        builder = builder.proxy(proxy);
    }
    let tls = native_tls::TlsConnector::new()?;
    Ok(builder.tls_connector(Arc::new(tls)).build())
}

fn fetch_release() -> Result<Release> {
    // Für Tests gegen eine lokale Kopie der API.
    let url = std::env::var("HAKOBO_UPDATE_URL").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| LATEST_URL.into());
    let resp = agent(&url, Duration::from_secs(30))?
        .get(&url)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => anyhow!("Es wurde noch keine Version veröffentlicht."),
            ureq::Error::Status(403 | 429, _) => anyhow!("GitHub lehnt die Abfrage gerade ab (Abfragelimit) – bitte später erneut versuchen."),
            e => anyhow!("GitHub ist nicht erreichbar ({e})."),
        })?;
    resp.into_json().context("Die Antwort von GitHub ist unverständlich")
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/// Startet die Installation im Hintergrund – nur eine zugleich und nur für ein Update, das sich
/// installieren lässt. Die Oberfläche verfolgt sie über [`status`].
pub fn start_install() -> Result<(), String> {
    let local = LOCAL.get().ok_or("Nur in der lokalen App verfügbar.")?;
    {
        let mut s = STATE.lock();
        if s.phase.busy() {
            return Err("Das Update wird bereits installiert.".into());
        }
        let r = s.release.as_ref().ok_or("Bitte zuerst nach Updates suchen.")?;
        if !r.is_update() {
            return Err("Hakobo ist bereits auf dem neuesten Stand.".into());
        }
        plan(r).map_err(|e| e.message())?;
        s.phase = Phase::Downloading;
        s.done = 0;
        s.total = 0;
        s.error.clear();
    }
    std::thread::spawn(move || run_install(local));
    Ok(())
}

fn run_install(local: &Local) {
    let mut command = match install(&local.work) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Update fehlgeschlagen: {e:#}");
            fail(format!("{e:#}"));
            return;
        }
    };
    // Die neue Version übernimmt Port und Token; sie wartet, bis diese Instanz den Port freigibt.
    command.env(RESTART_PORT_ENV, local.port.to_string()).env(RESTART_TOKEN_ENV, &local.token);
    set_phase(Phase::Restarting);
    // Der Seite kurz Zeit geben, den Neustart anzuzeigen.
    std::thread::sleep(Duration::from_millis(800));
    if let Err(e) = command.spawn() {
        let program = command.get_program().to_string_lossy().to_string();
        fail(format!("{program} konnte nicht gestartet werden ({e}). Bitte Hakobo beenden und neu starten."));
        return;
    }
    tracing::info!("Update wird abgeschlossen, Hakobo startet neu");
    quit();
    // Das App-Fenster endet über seine Ereignisschleife; sollte es das nicht tun, hier beenden.
    std::thread::sleep(Duration::from_secs(10));
    std::process::exit(0);
}

fn set_phase(phase: Phase) {
    STATE.lock().phase = phase;
}

fn fail(message: String) {
    let mut s = STATE.lock();
    s.phase = Phase::Failed;
    s.error = message;
}

/// Lädt das Update, prüft es und bringt es an seinen Platz. Liefert den Befehl, der die neue
/// Version startet – bzw. das Setup, das installiert und sie dann startet. Der Aufrufer beendet
/// dieses Programm.
fn install(work: &Path) -> Result<Command> {
    let release = STATE.lock().release.clone().context("Bitte zuerst nach Updates suchen.")?;
    let (target, asset) = plan(&release).map_err(|e| anyhow!(e.message()))?;
    let _ = std::fs::remove_dir_all(work);
    std::fs::create_dir_all(work)?;
    let expected = expected_sha256(&release, &asset)?;
    let package = work.join(&asset.name);
    download(&asset, &package, &expected)?;
    set_phase(Phase::Installing);
    match target.method {
        Method::Installer => Ok(setup_command(&package)),
        Method::Replace => {
            let staged = work.join("new");
            let names = files_to_replace();
            unpack(&package, &staged, &names)?;
            replace_files(&staged, &target.dir, &names)?;
            Ok(restart_command(&target.exe))
        }
    }
}

/// SHA-256 des Pakets, wie GitHub sie veröffentlicht, sonst aus SHA256SUMS.txt des Releases.
fn expected_sha256(r: &Release, a: &Asset) -> Result<String> {
    let hex = match a.digest.as_deref().and_then(|d| d.strip_prefix("sha256:")) {
        Some(hex) => hex.to_ascii_lowercase(),
        None => {
            let sums = r
                .assets
                .iter()
                .find(|x| x.name == "SHA256SUMS.txt")
                .context("Für das Paket ist keine Prüfsumme veröffentlicht – Update abgebrochen.")?;
            let text = agent(&sums.browser_download_url, Duration::from_secs(60))?.get(&sums.browser_download_url).call()?.into_string()?;
            sum_for(&text, &a.name).context("Das Paket fehlt in SHA256SUMS.txt – Update abgebrochen.")?
        }
    };
    if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        bail!("Die veröffentlichte Prüfsumme ist ungültig – Update abgebrochen.");
    }
    Ok(hex)
}

/// Zeile der `sha256sum`-Ausgabe für `name` (`<hex>  <name>`, Binärmodus `<hex> *<name>`).
fn sum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, file) = line.trim().split_once(char::is_whitespace)?;
        (file.trim().trim_start_matches('*') == name).then(|| hash.to_ascii_lowercase())
    })
}

fn download(a: &Asset, file: &Path, expected: &str) -> Result<()> {
    let resp = agent(&a.browser_download_url, Duration::from_secs(3600))?
        .get(&a.browser_download_url)
        .call()
        .map_err(|e| anyhow!("Der Download ist fehlgeschlagen ({e})."))?;
    STATE.lock().total = resp.header("Content-Length").and_then(|l| l.parse().ok()).unwrap_or(a.size);
    let mut reader = resp.into_reader();
    let mut out = File::create(file)?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    loop {
        let n = reader.read(&mut buf).context("Der Download wurde unterbrochen")?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n])?;
        hash.update(&buf[..n]);
        done += n as u64;
        STATE.lock().done = done;
    }
    out.sync_all()?;
    drop(out);
    let got: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if got != expected {
        let _ = std::fs::remove_file(file);
        bail!("Die Prüfsumme des Downloads stimmt nicht – Update abgebrochen.");
    }
    Ok(())
}

/// Programm und Lizenztexte.
fn files_to_replace() -> Vec<&'static str> {
    std::iter::once(PROGRAM).chain(DOCS).collect()
}

/// Entpackt die genannten Dateien aus der obersten Ebene des Pakets (zip oder tar.gz) – sonst
/// nichts, damit ein Paket nirgends außer in `dest` schreiben kann. Das Programm muss enthalten sein.
fn unpack(package: &Path, dest: &Path, names: &[&str]) -> Result<()> {
    let damaged = || "Das Paket ist beschädigt";
    std::fs::create_dir_all(dest)?;
    if package.extension().is_some_and(|e| e == "zip") {
        let mut zip = zip::ZipArchive::new(File::open(package)?).with_context(damaged)?;
        for n in names {
            if let Ok(mut f) = zip.by_name(n) {
                std::io::copy(&mut f, &mut File::create(dest.join(n))?)?;
            }
        }
    } else {
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(File::open(package)?));
        for entry in tar.entries().with_context(damaged)? {
            let mut e = entry.with_context(damaged)?;
            let path = e.path()?.to_string_lossy().trim_start_matches("./").to_string();
            if e.header().entry_type().is_file()
                && let Some(n) = names.iter().find(|n| **n == path)
            {
                std::io::copy(&mut e, &mut File::create(dest.join(n))?)?;
            }
        }
    }
    if !dest.join(PROGRAM).is_file() {
        bail!("Das Paket enthält {PROGRAM} nicht – Update abgebrochen.");
    }
    Ok(())
}

/// Bringt die neuen Dateien an ihren Platz. Die bisherigen werden zuerst in `*.old` umbenannt
/// (ein laufendes Programm lässt sich umbenennen, aber nicht überschreiben); nach einem Fehler
/// wird der vorige Stand wiederhergestellt.
fn replace_files(staged: &Path, dir: &Path, names: &[&str]) -> Result<()> {
    let mut touched: Vec<&str> = Vec::new();
    let result = (|| -> Result<()> {
        for n in names {
            let new = staged.join(n);
            if !new.is_file() {
                continue;
            }
            let (current, old) = (dir.join(n), dir.join(format!("{n}.old")));
            let _ = std::fs::remove_file(&old);
            if current.exists() {
                std::fs::rename(&current, &old).with_context(|| format!("{} kann nicht ersetzt werden", current.display()))?;
            }
            touched.push(n);
            // Kopieren statt Umbenennen: legt eine neue Datei an (macOS prüft Signaturen je Datei).
            std::fs::copy(&new, &current).with_context(|| format!("{} kann nicht geschrieben werden", current.display()))?;
            #[cfg(unix)]
            if *n == PROGRAM {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&current, std::fs::Permissions::from_mode(0o755))?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        for n in touched.iter().rev() {
            let (current, old) = (dir.join(n), dir.join(format!("{n}.old")));
            let _ = std::fs::remove_file(&current);
            if old.exists() {
                let _ = std::fs::rename(&old, &current);
            }
        }
    }
    result
}

/// Das Setup aktualisiert die Installation ohne Rückfragen (mit sichtbarem Fortschritt) und
/// startet das Programm danach wieder – `/RELAUNCH` wertet installer/hakobo.iss aus.
fn setup_command(setup: &Path) -> Command {
    let mut c = Command::new(setup);
    c.args(["/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/RELAUNCH=1", "/LANG=german"]);
    c
}

/// Startet das ersetzte Programm mit denselben Argumenten – außer `--tray`: Nach einem Update aus
/// dem Fenster heraus soll das Fenster wiederkommen.
fn restart_command(exe: &Path) -> Command {
    let mut c = Command::new(exe);
    c.args(restart_args(std::env::args_os().skip(1)));
    c
}

fn restart_args(args: impl Iterator<Item = std::ffi::OsString>) -> Vec<std::ffi::OsString> {
    args.filter(|a| a != "--tray").collect()
}

/// Entfernt, was ein früheres Update hinterlassen hat: das geladene Paket und die ersetzten Dateien.
fn cleanup() {
    if STATE.lock().phase.busy() {
        return;
    }
    if let Some(local) = LOCAL.get() {
        let _ = std::fs::remove_dir_all(&local.work);
    }
    if let Ok(t) = &*TARGET {
        for n in files_to_replace() {
            let _ = std::fs::remove_file(t.dir.join(format!("{n}.old")));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_compared_numerically() {
        assert!(is_newer("0.10.0", "0.9.1"));
        assert!(is_newer("v1.0.0", "0.9.1"));
        assert!(!is_newer("0.9.1", "0.9.1"));
        assert!(!is_newer("0.9.0", "0.9.1"));
        assert!(!is_newer("1.0.0-rc1", "0.9.1"));
        assert!(!is_newer("1.0", "0.9.1"));
    }

    #[test]
    fn drafts_and_prereleases_are_no_updates() {
        let r = Release { tag_name: "v99.0.0".into(), body: None, html_url: String::new(), published_at: None, draft: false, prerelease: false, assets: vec![] };
        assert!(r.is_update());
        assert!(!Release { prerelease: true, ..r.clone() }.is_update());
        assert!(!Release { draft: true, ..r }.is_update());
    }

    #[test]
    fn packages_match_the_release_assets() {
        // Namen wie im Release-Workflow (.github/workflows/build.yml).
        let name = |m, os, arch| package_name_for("0.2.0", m, os, arch);
        assert_eq!(name(Method::Installer, "windows", "x86_64").as_deref(), Some("Hakobo-0.2.0-windows-x64-setup.exe"));
        assert_eq!(name(Method::Replace, "windows", "x86_64").as_deref(), Some("Hakobo-0.2.0-windows-x64-portable.zip"));
        assert_eq!(name(Method::Replace, "macos", "aarch64").as_deref(), Some("Hakobo-0.2.0-macos-arm64.tar.gz"));
        assert_eq!(name(Method::Replace, "linux", "x86_64").as_deref(), Some("Hakobo-0.2.0-linux-x64.tar.gz"));
        assert_eq!(name(Method::Replace, "linux", "riscv64"), None);
        assert_eq!(name(Method::Installer, "linux", "x86_64"), None);
    }

    #[test]
    fn checksums_are_found_in_sha256sums() {
        let sums = "861cce  SHA256SUMS.txt\nABC123  Hakobo-1.0.0-windows-x64-setup.exe\ndef456 *Hakobo-1.0.0-linux-x64.tar.gz\n";
        assert_eq!(sum_for(sums, "Hakobo-1.0.0-windows-x64-setup.exe").as_deref(), Some("abc123"));
        assert_eq!(sum_for(sums, "Hakobo-1.0.0-linux-x64.tar.gz").as_deref(), Some("def456"));
        assert_eq!(sum_for(sums, "Hakobo-1.0.0-windows-x64-portable.zip"), None);
    }

    #[test]
    fn only_the_program_files_are_unpacked() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let names = files_to_replace();
        // zip wie von Compress-Archive
        let zip_path = dir.join("p.zip");
        let mut zip = zip::ZipWriter::new(File::create(&zip_path).unwrap());
        for (n, body) in [(PROGRAM, "program"), (DOCS[0], "licenses"), ("data/notes.txt", "fremd")] {
            zip.start_file(n, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        unpack(&zip_path, &dir.join("z"), &names).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("z").join(PROGRAM)).unwrap(), "program");
        assert_eq!(std::fs::read_to_string(dir.join("z").join(DOCS[0])).unwrap(), "licenses");
        assert!(!dir.join("z").join("data").exists());
        // tar.gz wie von build.sh
        let tar_path = dir.join("p.tar.gz");
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(File::create(&tar_path).unwrap(), flate2::Compression::fast()));
        for (n, body) in [(PROGRAM.to_string(), "program"), (format!("./{}", DOCS[0]), "licenses"), (format!("data/{PROGRAM}"), "fremd")] {
            let mut h = tar::Header::new_gnu();
            h.set_size(body.len() as u64);
            h.set_mode(0o755);
            h.set_cksum();
            tar.append_data(&mut h, n, body.as_bytes()).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap();
        unpack(&tar_path, &dir.join("t"), &names).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("t").join(PROGRAM)).unwrap(), "program");
        assert_eq!(std::fs::read_to_string(dir.join("t").join(DOCS[0])).unwrap(), "licenses");
        assert!(!dir.join("t").join("data").exists());
        // Ein Paket ohne Programm wird abgelehnt.
        let mut zip = zip::ZipWriter::new(File::create(&zip_path).unwrap());
        zip.start_file(DOCS[0], zip::write::SimpleFileOptions::default()).unwrap();
        zip.finish().unwrap();
        assert!(unpack(&zip_path, &dir.join("z2"), &names).is_err());
    }

    #[test]
    fn files_are_replaced_and_restored_on_error() {
        let tmp = tempfile::tempdir().unwrap();
        let (app, staged) = (tmp.path().join("app"), tmp.path().join("new"));
        std::fs::create_dir_all(&app).unwrap();
        std::fs::create_dir_all(&staged).unwrap();
        for n in [PROGRAM, DOCS[0]] {
            std::fs::write(app.join(n), "alt").unwrap();
            std::fs::write(staged.join(n), "neu").unwrap();
        }
        replace_files(&staged, &app, &[PROGRAM, DOCS[0]]).unwrap();
        assert_eq!(std::fs::read_to_string(app.join(PROGRAM)).unwrap(), "neu");
        assert_eq!(std::fs::read_to_string(app.join(format!("{}.old", DOCS[0]))).unwrap(), "alt");

        // Die zweite Datei lässt sich nicht schreiben (ihr Ordner fehlt): Die erste kommt zurück.
        std::fs::write(staged.join(PROGRAM), "neuer").unwrap();
        std::fs::create_dir_all(staged.join("fehlt")).unwrap();
        std::fs::write(staged.join("fehlt").join("x"), "neu").unwrap();
        assert!(replace_files(&staged, &app, &[PROGRAM, "fehlt/x"]).is_err());
        assert_eq!(std::fs::read_to_string(app.join(PROGRAM)).unwrap(), "neu");
    }

    #[test]
    fn the_tray_flag_is_not_passed_on_after_an_update() {
        let args = ["--tray", "--vault", "D:\\Notizen"].map(std::ffi::OsString::from);
        assert_eq!(restart_args(args.into_iter()), ["--vault", "D:\\Notizen"]);
    }
}
