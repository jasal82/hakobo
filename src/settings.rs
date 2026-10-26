//! Einstellungen dieses Rechners (nicht im Notizbuch, nicht synchronisiert).

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Ordner des Notizbuchs (Standard: Dokumente/Sqizzo).
    pub vault: Option<PathBuf>,
    /// Globales Tastenkürzel für die Schnellerfassung, z. B. `Ctrl+Shift+Space`.
    pub hotkey: String,
    /// Beim Schließen des Fensters im Infobereich weiterlaufen.
    pub close_to_tray: bool,
    /// Mit Windows starten (im Infobereich).
    pub autostart: bool,
    /// Ruhepause, nach der Änderungen als Version festgehalten werden.
    pub commit_delay_secs: u64,
    pub sync_enabled: bool,
    pub sync_interval_minutes: u64,
    /// Standard-Erinnerung für Termine mit Uhrzeit (Minuten vorher, `None` = aus).
    pub event_reminder_minutes: Option<i64>,
    /// Ganztägige Todos und Termine morgens erinnern.
    pub all_day_reminders: bool,
    /// Uhrzeit für ganztägige Erinnerungen („09:00“).
    pub all_day_time: String,
    /// `system`, `light` oder `dark`.
    pub theme: String,
    /// Schriftgröße bzw. Zoom der ganzen Oberfläche (1.0 = 100 %).
    pub ui_scale: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            vault: None,
            hotkey: "Ctrl+Shift+Space".into(),
            close_to_tray: true,
            autostart: false,
            commit_delay_secs: 30,
            sync_enabled: true,
            sync_interval_minutes: 5,
            event_reminder_minutes: Some(10),
            all_day_reminders: true,
            all_day_time: "09:00".into(),
            theme: "system".into(),
            ui_scale: 1.0,
        }
    }
}

pub const UI_SCALE_MIN: f64 = 0.7;
pub const UI_SCALE_MAX: f64 = 2.0;

/// Zulässiger Zoomfaktor (ungültige Werte → 100 %).
pub fn clamp_ui_scale(v: f64) -> f64 {
    if v.is_finite() { v.clamp(UI_SCALE_MIN, UI_SCALE_MAX) } else { 1.0 }
}

impl Settings {
    pub fn file(config: &Path) -> PathBuf {
        config.join("settings.json")
    }

    pub fn load(config: &Path) -> Settings {
        std::fs::read_to_string(Self::file(config)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    pub fn save(&self, config: &Path) -> Result<()> {
        std::fs::create_dir_all(config)?;
        crate::vault::write_atomic(&Self::file(config), serde_json::to_string_pretty(self)?.as_bytes())
    }

    pub fn all_day_time(&self) -> chrono::NaiveTime {
        chrono::NaiveTime::parse_from_str(&self.all_day_time, "%H:%M").unwrap_or_else(|_| chrono::NaiveTime::from_hms_opt(9, 0, 0).expect("Uhrzeit"))
    }
}

/// Standardordner des Notizbuchs.
pub fn default_vault() -> PathBuf {
    let base = dirs::document_dir().or_else(dirs::home_dir).unwrap_or_else(|| PathBuf::from("."));
    base.join("Sqizzo")
}

/// Ordner der Einstellungen (`SQIZZO_CONFIG_DIR` für Tests).
pub fn config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("SQIZZO_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("sqizzo")
}

/// Autostart mit Windows (Registry-Schlüssel `Run` des Benutzers).
#[cfg(windows)]
pub fn set_autostart(enabled: bool) -> Result<()> {
    use crate::proc::NoWindow;
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let status = if enabled {
        let exe = std::env::current_exe()?;
        let value = format!("\"{}\" --tray", exe.display());
        std::process::Command::new("reg").args(["add", key, "/v", "Sqizzo", "/t", "REG_SZ", "/d", &value, "/f"]).no_window().output()?
    } else {
        std::process::Command::new("reg").args(["delete", key, "/v", "Sqizzo", "/f"]).no_window().output()?
    };
    if !status.status.success() && enabled {
        anyhow::bail!("Autostart konnte nicht eingerichtet werden: {}", String::from_utf8_lossy(&status.stderr).trim());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn set_autostart(_enabled: bool) -> Result<()> {
    anyhow::bail!("Autostart wird auf diesem System noch nicht unterstützt.")
}
