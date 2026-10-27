// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Desktop-Benachrichtigungen (Windows-Toasts, sonst über notify-rust).

use std::path::Path;
use std::sync::OnceLock;

pub type OnClick = Box<dyn Fn() + Send + Sync + 'static>;

#[cfg(windows)]
const APP_ID: &str = "Hakobo.Notes";

static ICON: OnceLock<std::path::PathBuf> = OnceLock::new();

/// Registriert die App für Benachrichtigungen (Name und Symbol im Info-Center).
pub fn init(config_dir: &Path) {
    let icon = config_dir.join("hakobo-icon.png");
    let _ = std::fs::create_dir_all(config_dir);
    if !icon.exists() {
        let _ = std::fs::write(&icon, crate::assets::ICON_PNG);
    }
    let _ = ICON.set(icon.clone());
    #[cfg(windows)]
    {
        use crate::proc::NoWindow;
        let key = format!(r"HKCU\Software\Classes\AppUserModelId\{APP_ID}");
        let icon_s = icon.to_string_lossy().to_string();
        for (name, value) in [("DisplayName", "Hakobo"), ("IconUri", icon_s.as_str())] {
            let _ = std::process::Command::new("reg").args(["add", &key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"]).no_window().output();
        }
    }
}

/// Zeigt eine Benachrichtigung; ein Klick ruft `on_click` auf.
pub fn show(title: &str, body: &str, on_click: Option<OnClick>) {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::{IconCrop, Sound, Toast};
        let mut toast = Toast::new(APP_ID).title(title).text1(body).sound(Some(Sound::Reminder));
        if let Some(icon) = ICON.get() {
            toast = toast.icon(icon, IconCrop::Square, "Hakobo");
        }
        if let Some(f) = on_click {
            toast = toast.on_activated(move |_| {
                f();
                Ok(())
            });
        }
        if let Err(e) = toast.show() {
            tracing::warn!("Benachrichtigung fehlgeschlagen: {e}");
        }
    }
    #[cfg(not(windows))]
    {
        let _ = on_click;
        if let Err(e) = notify_rust::Notification::new().summary(title).body(body).appname("Hakobo").show() {
            tracing::warn!("Benachrichtigung fehlgeschlagen: {e}");
        }
    }
}
