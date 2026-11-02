// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Sprache der Texte, die das Backend selbst anzeigt (Tray, Erinnerungen,
//! Fehlermeldungen der API, Kommandozeile). Die Oberfläche übersetzt ihre
//! Texte selbst (web/src/i18n); beide folgen der Einstellung `language`.
//!
//! Texte stehen zweisprachig direkt an der Stelle, an der sie entstehen:
//! `tr!("Deutsch {x}", "English {x}")` liefert einen `String` in der aktuellen
//! Sprache. Commit-Nachrichten und das Dateiformat bleiben sprachneutral bzw.
//! deutsch und laufen nicht hierüber.

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    De,
    En,
}

static ENGLISH: AtomicBool = AtomicBool::new(false);

/// Text in der aktuellen Sprache: `tr!("Fällig: {}", "Due: {}", text)`.
/// Beide Varianten sind Formatzeichenketten wie bei `format!`.
#[macro_export]
macro_rules! tr {
    ($de:literal, $en:literal $(, $($arg:tt)*)?) => {
        if $crate::i18n::is_en() { format!($en $(, $($arg)*)?) } else { format!($de $(, $($arg)*)?) }
    };
}

pub fn current() -> Lang {
    if ENGLISH.load(Ordering::Relaxed) { Lang::En } else { Lang::De }
}

pub fn is_en() -> bool {
    current() == Lang::En
}

pub fn set(lang: Lang) {
    ENGLISH.store(lang == Lang::En, Ordering::Relaxed);
}

/// Einstellung (`system`, `de`, `en`) → Sprache. `system`: Deutsch, wenn das
/// System deutsch ist, sonst Englisch.
pub fn resolve(setting: &str) -> Lang {
    match setting {
        "de" => Lang::De,
        "en" => Lang::En,
        _ => system(),
    }
}

/// Einstellung übernehmen; meldet, ob sich die Sprache geändert hat.
pub fn apply(setting: &str) -> bool {
    let lang = resolve(setting);
    let changed = lang != current();
    set(lang);
    changed
}

/// Sprache des Systems (Anzeigesprache unter Windows, sonst Umgebungsvariablen bzw. macOS-Vorgabe).
pub fn system() -> Lang {
    if system_tag().is_some_and(|t| t.to_ascii_lowercase().starts_with("de")) { Lang::De } else { Lang::En }
}

#[cfg(windows)]
fn system_tag() -> Option<String> {
    // Primäre Sprache der Anzeigesprache (LANG_GERMAN = 0x07).
    let id = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
    Some(if id & 0x3ff == 0x07 { "de".into() } else { "en".into() })
}

#[cfg(not(windows))]
fn system_tag() -> Option<String> {
    for var in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(v) = std::env::var(var)
            && !v.is_empty()
            && v != "C"
            && v != "POSIX"
        {
            return Some(v);
        }
    }
    #[cfg(target_os = "macos")]
    {
        // Programme aus dem Finder bekommen kein LANG: Vorgabe des Systems lesen.
        let out = std::process::Command::new("defaults").args(["read", "-g", "AppleLocale"]).output().ok()?;
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !v.is_empty() {
            return Some(v);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_settings_win_over_the_system() {
        assert_eq!(resolve("de"), Lang::De);
        assert_eq!(resolve("en"), Lang::En);
        assert_eq!(resolve("system"), system());
        assert_eq!(resolve(""), system());
    }
}
