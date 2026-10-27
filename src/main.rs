//! Hakobo – Notizen, Todos und Termine als Outline; lokal gespeichert als
//! Markdown, automatisch versioniert mit Git, optional synchronisiert.
//!
//! Ein Programm: Desktop-App (Fenster, Tray, globaler Hotkey), Server für den
//! Browser (`hakobo serve`) und Kommandozeile (`hakobo add`, `agenda`, …).

// Unter Windows als GUI-Programm bauen: kein Konsolenfenster beim Start.
// Aus einem Terminal aufgerufen, hängt sich das Programm an dessen Konsole.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod agenda;
mod app;
mod assets;
mod capture;
mod dates;
#[cfg(any(windows, target_os = "macos"))]
mod desktop;
mod git;
mod instance;
mod legacy;
mod notify;
mod proc;
mod search;
mod server;
mod settings;
mod update;
mod vault;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Result, bail};
use chrono::{Duration, Local};
use clap::{Parser, Subcommand};
use serde_json::{Value, json};

use crate::app::App;
use crate::settings::Settings;

#[derive(Parser)]
#[command(name = "hakobo", version, about = "Hakobo – Notizen, Todos und Termine als Outline, versioniert mit Git")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    /// Ordner des Notizbuchs (Standard: Einstellung bzw. Dokumente/Hakobo).
    #[arg(long, global = true, env = "HAKOBO_VAULT")]
    vault: Option<PathBuf>,
    /// Port für die lokale App (belegt → freier Port).
    #[arg(long, default_value_t = 4519)]
    port: u16,
    /// Kein Fenster öffnen (nur Server, für die Entwicklung).
    #[arg(long, env = "HAKOBO_NO_OPEN", value_parser = clap::builder::FalseyValueParser::new())]
    no_open: bool,
    /// Im Browser statt im App-Fenster öffnen.
    #[arg(long)]
    browser: bool,
    /// Nur im Infobereich starten (z. B. beim Autostart).
    #[arg(long)]
    tray: bool,
    /// Festes Zugangstoken (Standard: zufällig).
    #[arg(long, hide = true)]
    token: Option<String>,
    /// Eigener Einstellungsordner (Tests, Entwicklung).
    #[arg(long, global = true, hide = true, env = "HAKOBO_CONFIG_DIR")]
    config_dir: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Command {
    /// Idee, Todo oder Termin in die Inbox, z. B. `hakobo add "Zahnarzt /morgen 14 uhr"`.
    Add {
        /// Statt in die Inbox unter diese Seite (Titel oder Pfad).
        #[arg(long)]
        to: Option<String>,
        /// Text mit Slash-Befehlen (/morgen, /fällig fr, /todo, /wdh wöchentlich, /erinnerung 1h, #tag, @person). `-` liest von der Standardeingabe.
        #[arg(required = true, num_args = 1..)]
        text: Vec<String>,
    },
    /// Termine und fällige Todos der nächsten Tage.
    Agenda {
        #[arg(long, default_value_t = 7)]
        days: i64,
    },
    /// Fuzzy-Suche, z. B. `hakobo search "rechnung #kunde is:open"`.
    Search {
        #[arg(long, default_value_t = 20)]
        limit: usize,
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
    },
    /// Einträge in der Inbox.
    Inbox,
    /// Jetzt mit dem Remote synchronisieren.
    Sync,
    /// Bestehendes Notizbuch von einem Git-Remote holen (zweites Gerät) und als Standard eintragen.
    Clone {
        /// Adresse des Repositorys, z. B. `git@github.com:name/notizen.git`.
        url: String,
    },
    /// Als Server starten, erreichbar per Browser (z. B. im Heimnetz).
    Serve {
        #[arg(long, default_value = "0.0.0.0", env = "HAKOBO_HOST")]
        host: String,
        #[arg(long, default_value_t = 8090, env = "HAKOBO_PORT")]
        port: u16,
        #[arg(long, env = "HAKOBO_TOKEN")]
        token: Option<String>,
    },
}

fn random_token() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    (0..32).map(|_| format!("{:x}", rng.random_range(0..16u8))).collect()
}

/// Hängt sich unter Windows an die Konsole des aufrufenden Terminals an.
fn attach_console() -> bool {
    #[cfg(all(windows, not(debug_assertions)))]
    {
        use windows_sys::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole};
        if std::io::IsTerminal::is_terminal(&std::io::stdout()) || std::env::var_os("CI").is_some() {
            return true;
        }
        // SAFETY: Einfacher Win32-Aufruf ohne Zeiger.
        unsafe { AttachConsole(ATTACH_PARENT_PROCESS) != 0 }
    }
    #[cfg(not(all(windows, not(debug_assertions))))]
    {
        true
    }
}

fn init_logging(log_file: Option<PathBuf>) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "hakobo=info,warn".into());
    let builder = tracing_subscriber::fmt().with_env_filter(filter).with_target(false);
    match log_file.and_then(|p| {
        let _ = std::fs::create_dir_all(p.parent()?);
        std::fs::File::create(&p).ok()
    }) {
        Some(file) => builder.with_ansi(false).with_writer(std::sync::Mutex::new(file)).init(),
        None => builder.init(),
    }
}

fn main() -> Result<()> {
    // Vor allem anderen: entfernt die Angaben aus der Umgebung, solange kein weiterer Thread läuft.
    let restart = update::take_restart();
    let has_console = attach_console();
    let cli = Cli::parse();
    let is_app = cli.command.is_none();
    let config = match cli.config_dir.clone().filter(|d| !d.as_os_str().is_empty()) {
        Some(dir) => dir,
        None => {
            let config = settings::config_dir();
            if let Err(e) = legacy::take_over_config(&legacy::config_dir(), &config) {
                if is_app && !has_console {
                    legacy::alert(&format!("{e:#}"));
                }
                return Err(e);
            }
            config
        }
    };
    std::fs::create_dir_all(&config)?;
    let mut settings = Settings::load(&config);
    if cli.vault.is_none() && cli.config_dir.is_none() {
        legacy::take_over_vault(&mut settings, &config, &legacy::default_vault(), &settings::default_vault())?;
    }
    let vault_dir = cli.vault.clone().or_else(|| settings.vault.clone()).unwrap_or_else(settings::default_vault);
    init_logging((!has_console && is_app).then(|| config.join("hakobo.log")));

    let result = match cli.command {
        None => run_app(&cli, &vault_dir, config, settings, restart),
        Some(Command::Serve { ref host, port, ref token }) => serve(&vault_dir, config, settings, host, port, token.clone()),
        Some(Command::Add { ref to, ref text }) => cmd_add(&vault_dir, &config, settings, to.as_deref(), text),
        Some(Command::Agenda { days }) => cmd_agenda(&vault_dir, days),
        Some(Command::Search { limit, ref query }) => cmd_search(&vault_dir, &query.join(" "), limit),
        Some(Command::Inbox) => cmd_inbox(&vault_dir),
        Some(Command::Sync) => cmd_sync(&vault_dir, &config, settings),
        Some(Command::Clone { ref url }) => cmd_clone(url, &vault_dir, &config, settings, cli.vault.is_some()),
    };
    if let Err(e) = &result {
        tracing::error!("{e:#}");
        if !is_app {
            eprintln!("Fehler: {e:#}");
            std::process::exit(1);
        }
    }
    result
}

/// Läuft eine App für dasselbe Notizbuch?
fn running_instance(config: &Path, vault: &Path) -> Option<instance::Instance> {
    let i = instance::find(config)?;
    let same = vault::dunce(&i.vault) == vault::dunce(vault);
    same.then_some(i)
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/// `restart`: gestartet von der vorigen Version nach einem Update.
fn run_app(cli: &Cli, vault_dir: &Path, config: PathBuf, settings: Settings, restart: Option<update::Restart>) -> Result<()> {
    // Läuft Hakobo schon? Dann nur dessen Fenster nach vorne holen. Nach einem
    // Update ist die laufende Instanz die alte Version, die sich gerade beendet.
    if restart.is_none() && !cli.no_open && instance::activate_existing(&config) {
        return Ok(());
    }
    // Nach einem Update dieselbe Adresse und dasselbe Token wie zuvor: Offene
    // Browser-Tabs bleiben angemeldet, die Kommandozeile findet die App wieder.
    // Für Entwicklung/Tests kann das Token fest vorgegeben werden.
    let token = match &restart {
        Some(r) => r.token.clone(),
        None => cli.token.clone().filter(|t| !t.is_empty()).unwrap_or_else(random_token),
    };
    if let Some(r) = &restart {
        update::wait_for_previous(r.port);
    }
    let theme = settings.theme.clone();
    legacy::take_over_windows(settings.autostart);
    let app = App::open(vault_dir, config.clone(), settings)?;
    notify::init(&config);
    let rt = tokio::runtime::Runtime::new()?;

    #[cfg(any(windows, target_os = "macos"))]
    let desktop = (!cli.no_open && !cli.browser).then(desktop::Desktop::new);
    #[cfg(any(windows, target_os = "macos"))]
    if let Some(d) = &desktop {
        *app.shell.lock() = d.shell();
    }

    let cfg = server::ServerConfig {
        app: app.clone(),
        local: true,
        host: "127.0.0.1".into(),
        port: restart.as_ref().map_or(cli.port, |r| r.port),
        token: Some(token.clone()),
        wait_for_port: restart.is_some(),
    };
    let (listener, addr) = rt.block_on(server::bind(&cfg))?;
    let base = format!("http://127.0.0.1:{}", addr.port());
    tracing::info!("Hakobo {} läuft unter {base} (Notizbuch {})", update::VERSION, app.vault_dir().display());
    app.spawn_background(rt.handle());
    update::enable(addr.port(), &token, &update_dir(cli, &config), &config);
    update::spawn_checks(rt.handle());
    {
        // Für ein Update beenden wie über „Beenden“ im Infobereich: speichern, abmelden, Fenster zu.
        let (app, config) = (app.clone(), config.clone());
        update::set_quit_handler(move || {
            let quit = app.shell.lock().quit.clone();
            match quit {
                Some(q) => q(),
                None => {
                    app.shutdown();
                    instance::unregister(&config);
                    std::process::exit(0);
                }
            }
        });
    }

    if cli.no_open {
        println!("Hakobo läuft unter {base}/?token={token} – Strg+C zum Beenden.");
        return rt.block_on(serve_until_ctrl_c(cfg, listener, app));
    }
    instance::register(&config, addr.port(), &token, &app.vault_dir());

    #[cfg(any(windows, target_os = "macos"))]
    if let Some(desktop) = desktop {
        rt.spawn(server::serve(cfg, listener));
        let app_exit = app.clone();
        let config_exit = config.clone();
        let result = desktop.run(desktop::RunOptions {
            app: app.clone(),
            base_url: base.clone(),
            token: token.clone(),
            config_dir: config.clone(),
            data_dir: config.join("webview"),
            dark: prefers_dark(&theme),
            // Nach einem Update aus dem Fenster heraus kommt das Fenster wieder.
            start_hidden: cli.tray && restart.is_none(),
            on_exit: Box::new(move || {
                app_exit.shutdown();
                instance::unregister(&config_exit);
            }),
        });
        // Nur bei einem Fehler (z. B. fehlende WebView2-Laufzeit) geht es hier weiter.
        if let Err(e) = result {
            tracing::warn!("Natives Fenster nicht verfügbar ({e:#}) – öffne im Browser.");
            open_in_browser(&format!("{base}/?token={token}"));
            rt.block_on(std::future::pending::<()>());
        }
        return Ok(());
    }

    // Browser-Modus
    let _ = theme;
    let url = format!("{base}/?token={token}");
    let reopen = url.clone();
    {
        let mut shell = app.shell.lock();
        shell.focus = Some(Arc::new(move || open_in_browser(&reopen)));
        let app_quit = app.clone();
        let config_quit = config.clone();
        shell.quit = Some(Arc::new(move || {
            app_quit.shutdown();
            instance::unregister(&config_quit);
            std::process::exit(0);
        }));
    }
    // Nach einem Update lädt sich die offene Seite selbst neu – kein zweiter Tab.
    if restart.is_none() {
        open_in_browser(&url);
    }
    let result = rt.block_on(serve_until_ctrl_c(cfg, listener, app));
    instance::unregister(&config);
    result
}

/// Ordner für Update-Downloads: im Cache (unter Windows lokal, nicht im Roaming-Profil), mit
/// eigenem Einstellungsordner (Tests, Entwicklung) darin.
fn update_dir(cli: &Cli, config: &Path) -> PathBuf {
    match (&cli.config_dir, dirs::cache_dir()) {
        (None, Some(cache)) => cache.join("hakobo").join("update"),
        _ => config.join("update"),
    }
}

async fn serve_until_ctrl_c(cfg: server::ServerConfig, listener: tokio::net::TcpListener, app: Arc<App>) -> Result<()> {
    tokio::select! {
        r = server::serve(cfg, listener) => r?,
        _ = tokio::signal::ctrl_c() => {}
    }
    let a = app.clone();
    tokio::task::spawn_blocking(move || a.shutdown()).await?;
    Ok(())
}

fn serve(vault_dir: &Path, config: PathBuf, settings: Settings, host: &str, port: u16, token: Option<String>) -> Result<()> {
    let token = token.filter(|t| !t.is_empty()).unwrap_or_else(random_token);
    let app = App::open(vault_dir, config, settings)?;
    let rt = tokio::runtime::Runtime::new()?;
    let cfg = server::ServerConfig { app: app.clone(), local: false, host: host.to_string(), port, token: Some(token.clone()), wait_for_port: false };
    let (listener, addr) = rt.block_on(server::bind(&cfg))?;
    app.spawn_background(rt.handle());
    let shown = if host == "0.0.0.0" { format!("http://<rechnername>:{}", addr.port()) } else { format!("http://{addr}") };
    println!();
    println!("  Hakobo {} läuft als Server", env!("CARGO_PKG_VERSION"));
    println!("  Notizbuch:    {}", app.vault_dir().display());
    println!("  Adresse:      {shown}");
    println!("  Direktlink:   {shown}/?token={token}");
    println!();
    rt.block_on(serve_until_ctrl_c(cfg, listener, app))
}

fn prefers_dark(theme: &str) -> bool {
    match theme {
        "dark" => true,
        "light" => false,
        _ => system_dark(),
    }
}

fn system_dark() -> bool {
    #[cfg(windows)]
    {
        use proc::NoWindow;
        std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "/v", "AppsUseLightTheme"])
            .no_window()
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("0x0"))
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn open_in_browser(url: &str) {
    if let Err(e) = open::that_detached(url) {
        eprintln!("Browser konnte nicht geöffnet werden ({e}). Bitte {url} manuell öffnen.");
    }
}

// ---------------------------------------------------------------------------
// Kommandozeile
// ---------------------------------------------------------------------------

fn cmd_add(vault_dir: &Path, config: &Path, settings: Settings, to: Option<&str>, words: &[String]) -> Result<()> {
    let mut text = words.join(" ");
    if text.trim() == "-" {
        text.clear();
        std::io::stdin().read_to_string(&mut text)?;
    }
    if text.trim().is_empty() {
        bail!("Kein Text angegeben.");
    }
    if let Some(i) = running_instance(config, vault_dir) {
        let parent = match to {
            Some(t) => Some(find_page_remote(&i, t)?),
            None => None,
        };
        let r = instance::request(&i, "POST", "/api/capture", Some(&json!({ "text": text, "parent": parent })))?;
        print_captured(&r["node"]["text"], &r["summary"], to);
        return Ok(());
    }
    let app = App::open(vault_dir, config.to_path_buf(), settings)?;
    let parent = match to {
        Some(t) => Some(app.vault.lock().find_page(t).ok_or_else(|| anyhow::anyhow!("Seite „{t}“ nicht gefunden."))?),
        None => None,
    };
    let (id, c) = app.capture(&text, parent.as_deref())?;
    app.commit_now()?;
    let node = app.vault.lock().dto(&id);
    print_captured(&json!(node.map(|n| n.text)), &json!(c.summary), to);
    Ok(())
}

fn find_page_remote(i: &instance::Instance, title: &str) -> Result<String> {
    let snap = instance::request(i, "GET", "/api/vault", None)?;
    let want = title.trim().to_lowercase();
    snap["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|n| n["kind"] == "page")
        .find(|n| n["text"].as_str().is_some_and(|t| t.to_lowercase() == want) || n["path"].as_str().is_some_and(|p| p.to_lowercase() == want))
        .and_then(|n| n["id"].as_str().map(str::to_string))
        .ok_or_else(|| anyhow::anyhow!("Seite „{title}“ nicht gefunden."))
}

fn print_captured(text: &Value, summary: &Value, to: Option<&str>) {
    let place = to.map(|t| format!("Unter „{t}“")).unwrap_or_else(|| "In der Inbox".into());
    println!("✓ {place}: {}", text.as_str().unwrap_or(""));
    for s in summary.as_array().into_iter().flatten() {
        if let Some(s) = s.as_str() {
            println!("  {s}");
        }
    }
}

fn open_vault(vault_dir: &Path) -> Result<vault::Vault> {
    if !vault_dir.exists() {
        bail!("Notizbuch {} gibt es nicht.", vault_dir.display());
    }
    vault::Vault::open(vault_dir)
}

fn cmd_agenda(vault_dir: &Path, days: i64) -> Result<()> {
    let v = open_vault(vault_dir)?;
    let today = Local::now().date_naive();
    let a = agenda::agenda(&v, today, today + Duration::days(days.max(1) - 1), today);
    let line = |e: &agenda::Entry| {
        let check = match e.task {
            Some(t) if t.is_closed() => "[x] ",
            Some(_) => "[ ] ",
            None => "",
        };
        let time = match (e.when.start_time, e.when.end_time) {
            (Some(s), Some(t)) => format!("{}–{}  ", s.format("%H:%M"), t.format("%H:%M")),
            (Some(s), None) => format!("{}  ", s.format("%H:%M")),
            _ => String::new(),
        };
        let rep = e.repeat.as_ref().map(|r| format!("  ↻ {r}")).unwrap_or_default();
        format!("  {time}{check}{}{rep}  · {}", search::plain_text(&e.text), e.page)
    };
    if !a.overdue.is_empty() {
        println!("Überfällig");
        for e in &a.overdue {
            println!("{}  ({})", line(e), e.human);
        }
        println!();
    }
    if a.entries.is_empty() {
        println!("Keine Termine oder fälligen Todos in den nächsten {days} Tagen.");
    }
    let mut day = None;
    for e in &a.entries {
        let d = e.when.start.max(today);
        if day != Some(d) {
            if day.is_some() {
                println!();
            }
            let label = dates::When { start: d, start_time: None, end_date: None, end_time: None }.human_de(today);
            println!("{label}");
            day = Some(d);
        }
        println!("{}", line(e));
    }
    Ok(())
}

fn cmd_search(vault_dir: &Path, query: &str, limit: usize) -> Result<()> {
    let mut v = open_vault(vault_dir)?;
    let docs = v.search_docs();
    let hits = search::search(&docs, &search::Query::parse(query), &search::SearchContext { today: Local::now().date_naive() }, limit);
    if hits.is_empty() {
        println!("Keine Treffer.");
    }
    for h in hits {
        let Some(d) = docs.iter().find(|d| d.id == h.id) else { continue };
        let check = match d.task {
            Some(search::Task::Open) | Some(search::Task::Doing) => "[ ] ",
            Some(_) => "[x] ",
            None => "",
        };
        println!("{check}{}", d.title);
        if !d.path.is_empty() {
            println!("    {}", d.path.join(" › "));
        }
        if let Some(s) = h.snippet {
            println!("    „{}“", s.text);
        }
    }
    Ok(())
}

fn cmd_inbox(vault_dir: &Path) -> Result<()> {
    let v = open_vault(vault_dir)?;
    let inbox = v.get(&v.inbox).map(|n| n.children.clone()).unwrap_or_default();
    if inbox.is_empty() {
        println!("Die Inbox ist leer.");
    }
    let today = Local::now().date_naive();
    for id in inbox {
        let Some(n) = v.get(&id) else { continue };
        let check = match n.task {
            Some(t) if t.is_closed() => "[x] ",
            Some(_) => "[ ] ",
            None => "- ",
        };
        let when = n.when().map(|w| format!("  ({})", w.human_de(today))).unwrap_or_default();
        let kids = if n.children.is_empty() { String::new() } else { format!("  +{}", n.children.len()) };
        println!("{check}{}{when}{kids}", search::plain_text(&n.text));
    }
    Ok(())
}

fn cmd_sync(vault_dir: &Path, config: &Path, settings: Settings) -> Result<()> {
    if let Some(i) = running_instance(config, vault_dir) {
        let r = instance::request(&i, "POST", "/api/sync", None)?;
        return print_sync(&serde_json::from_value(r).unwrap_or_default());
    }
    let app = App::open(vault_dir, config.to_path_buf(), settings)?;
    if git::remote_url(&app.vault_dir()).is_none() {
        bail!("Für dieses Notizbuch ist kein Remote eingerichtet (Einstellungen → Synchronisation).");
    }
    let rt = tokio::runtime::Runtime::new()?;
    let status = rt.block_on(app.sync_now())?;
    print_sync(&serde_json::to_value(status)?.as_object().cloned().unwrap_or_default())
}

fn print_sync(s: &serde_json::Map<String, Value>) -> Result<()> {
    if let Some(e) = s.get("lastError").and_then(|e| e.as_str()) {
        bail!("Synchronisation fehlgeschlagen: {e}");
    }
    println!("✓ Synchronisiert mit {}", s.get("remote").and_then(|r| r.as_str()).unwrap_or("?"));
    if let Some(r) = s.get("resolved").and_then(|r| r.as_array()).filter(|r| !r.is_empty()) {
        println!("  Automatisch zusammengeführt: {}", r.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "));
    }
    Ok(())
}

fn cmd_clone(url: &str, vault_dir: &Path, config: &Path, mut settings: Settings, explicit: bool) -> Result<()> {
    if instance::find(config).is_some() {
        bail!("Bitte Hakobo zuerst beenden.");
    }
    let target = if explicit || !vault_dir.exists() || std::fs::read_dir(vault_dir)?.next().is_none() {
        vault_dir.to_path_buf()
    } else {
        bail!("{} ist nicht leer. Bitte mit --vault einen leeren Ordner angeben.", vault_dir.display());
    };
    println!("Hole {url} …");
    git::clone(url, &target)?;
    git::ensure_repo(&target)?;
    settings.vault = Some(vault::dunce(&target));
    settings.save(config)?;
    println!("✓ Notizbuch liegt in {} und wird ab jetzt synchronisiert.", target.display());
    Ok(())
}
