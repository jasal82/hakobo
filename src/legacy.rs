//! Übernahme von Sqizzo, dem früheren Namen von Hakobo: Einstellungsordner,
//! Notizbuch im Standardordner, `.sqizzo/` im Notizbuch und Windows-Einträge.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::settings::Settings;

/// Einstellungsordner von Sqizzo.
pub fn config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("sqizzo")
}

/// Standardordner des Notizbuchs von Sqizzo.
pub fn default_vault() -> PathBuf {
    dirs::document_dir().or_else(dirs::home_dir).unwrap_or_else(|| PathBuf::from(".")).join("Sqizzo")
}

/// Übernimmt den Einstellungsordner samt WebView-Profil, Erinnerungen und Fensterposition.
/// Läuft Sqizzo noch, bricht der Start ab: Sonst entstünden leere Einstellungen, und die
/// Übernahme fände nie mehr statt.
pub fn take_over_config(legacy: &Path, config: &Path) -> Result<bool> {
    if config.exists() || !legacy.is_dir() {
        return Ok(false);
    }
    if crate::instance::find(legacy).is_some() {
        bail!("Sqizzo heißt jetzt Hakobo und läuft noch. Bitte Sqizzo beenden (Infobereich → Beenden) und Hakobo erneut starten.");
    }
    std::fs::rename(legacy, config).with_context(|| format!("Die Einstellungen aus {} konnten nicht übernommen werden", legacy.display()))?;
    for name in ["sqizzo.log", "sqizzo-icon.png"] {
        let _ = std::fs::remove_file(config.join(name));
    }
    tracing::info!("Einstellungen von Sqizzo übernommen");
    Ok(true)
}

/// Übernimmt das Notizbuch aus dem bisherigen Standardordner, solange kein eigener Ordner
/// eingestellt ist. Lässt es sich nicht verschieben (z. B. weil eine Datei darin geöffnet ist),
/// bleibt es am alten Ort und wird als Ordner eingetragen.
pub fn take_over_vault(settings: &mut Settings, config: &Path, legacy: &Path, vault: &Path) -> Result<bool> {
    if settings.vault.is_some() || vault.exists() || !legacy.is_dir() {
        return Ok(false);
    }
    match std::fs::rename(legacy, vault) {
        Ok(()) => tracing::info!("Notizbuch von {} nach {} verschoben", legacy.display(), vault.display()),
        Err(e) => {
            tracing::warn!("Notizbuch bleibt in {} ({e})", legacy.display());
            settings.vault = Some(legacy.to_path_buf());
            settings.save(config)?;
        }
    }
    Ok(true)
}

/// Benennt den Ordner `.sqizzo/` im Notizbuch in `.hakobo/` um.
pub fn take_over_vault_dir(vault: &Path) -> Result<bool> {
    let (legacy, current) = (vault.join(".sqizzo"), vault.join(".hakobo"));
    if current.exists() || !legacy.is_dir() {
        return Ok(false);
    }
    std::fs::rename(&legacy, &current).with_context(|| format!("{} konnte nicht umbenannt werden", legacy.display()))?;
    Ok(true)
}

/// Entfernt die Windows-Einträge von Sqizzo; ein Autostart wird unter neuem Namen angelegt.
#[cfg(windows)]
pub fn take_over_windows(autostart: bool) {
    use crate::proc::NoWindow;
    let run = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let reg = |args: &[&str]| std::process::Command::new("reg").args(args).no_window().output().is_ok_and(|o| o.status.success());
    if reg(&["query", run, "/v", "Sqizzo"]) {
        reg(&["delete", run, "/v", "Sqizzo", "/f"]);
        if autostart && let Err(e) = crate::settings::set_autostart(true) {
            tracing::warn!("{e:#}");
        }
    }
    reg(&["delete", r"HKCU\Software\Classes\AppUserModelId\Sqizzo.Notes", "/f"]);
}

#[cfg(not(windows))]
pub fn take_over_windows(_autostart: bool) {}

/// Zeigt eine Meldung, auch wenn die App ohne Konsole gestartet wurde.
pub fn alert(text: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONWARNING, MB_OK, MessageBoxW};
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let (text, caption) = (wide(text), wide("Hakobo"));
        // SAFETY: Beide Zeichenketten sind nullterminiert und leben bis zum Ende des Aufrufs.
        unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), MB_OK | MB_ICONWARNING) };
    }
    #[cfg(not(windows))]
    eprintln!("{text}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_config_folder_of_sqizzo_is_taken_over() {
        let tmp = tempfile::tempdir().unwrap();
        let (legacy, config) = (tmp.path().join("sqizzo"), tmp.path().join("hakobo"));
        std::fs::create_dir_all(legacy.join("webview")).unwrap();
        std::fs::write(legacy.join("settings.json"), "{}").unwrap();
        std::fs::write(legacy.join("sqizzo.log"), "log").unwrap();
        assert!(take_over_config(&legacy, &config).unwrap());
        assert!(!legacy.exists());
        assert!(config.join("settings.json").exists() && config.join("webview").is_dir());
        assert!(!config.join("sqizzo.log").exists());
        // Danach geschieht nichts mehr.
        assert!(!take_over_config(&legacy, &config).unwrap());
    }

    #[test]
    fn an_existing_config_folder_is_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let (legacy, config) = (tmp.path().join("sqizzo"), tmp.path().join("hakobo"));
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        assert!(!take_over_config(&legacy, &config).unwrap());
        assert!(legacy.exists());
    }

    #[test]
    fn the_config_folder_stays_while_sqizzo_runs() {
        let tmp = tempfile::tempdir().unwrap();
        let (legacy, config) = (tmp.path().join("sqizzo"), tmp.path().join("hakobo"));
        std::fs::create_dir_all(&legacy).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::fs::write(legacy.join("instance.json"), format!(r#"{{"port":{port},"token":"t","pid":1}}"#)).unwrap();
        assert!(take_over_config(&legacy, &config).is_err());
        assert!(legacy.exists() && !config.exists());
    }

    #[test]
    fn the_default_notebook_moves_to_the_new_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let (legacy, vault, config) = (tmp.path().join("Sqizzo"), tmp.path().join("Hakobo"), tmp.path().join("config"));
        std::fs::create_dir_all(legacy.join(".sqizzo")).unwrap();
        std::fs::write(legacy.join("Inbox.md"), "- Idee\n").unwrap();
        let mut settings = Settings::default();
        assert!(take_over_vault(&mut settings, &config, &legacy, &vault).unwrap());
        assert_eq!(std::fs::read_to_string(vault.join("Inbox.md")).unwrap(), "- Idee\n");
        assert!(!legacy.exists());
        assert_eq!(settings.vault, None);
    }

    #[test]
    fn a_chosen_notebook_folder_is_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let (legacy, vault, config) = (tmp.path().join("Sqizzo"), tmp.path().join("Hakobo"), tmp.path().join("config"));
        std::fs::create_dir_all(&legacy).unwrap();
        let mut settings = Settings { vault: Some(tmp.path().join("Notizen")), ..Default::default() };
        assert!(!take_over_vault(&mut settings, &config, &legacy, &vault).unwrap());
        assert!(legacy.exists() && !vault.exists());
    }

    #[test]
    fn the_types_folder_in_the_notebook_is_renamed() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".sqizzo")).unwrap();
        std::fs::write(tmp.path().join(".sqizzo/types.toml"), "[meeting]\n").unwrap();
        assert!(take_over_vault_dir(tmp.path()).unwrap());
        assert_eq!(std::fs::read_to_string(tmp.path().join(".hakobo/types.toml")).unwrap(), "[meeting]\n");
        assert!(!tmp.path().join(".sqizzo").exists());
        assert!(!take_over_vault_dir(tmp.path()).unwrap());
    }
}
