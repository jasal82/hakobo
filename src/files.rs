// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Bilder im Ordner `assets/` des Notizbuchs: speichern (Einfügen, Ziehen) und ausliefern.
//! In den Seiten stehen sie als Markdown in der Notiz eines Knotens: `![Name](/assets/bild.png)`.

use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail};

/// Ordner für Bilder und Anhänge (keine Seiten, siehe `vault::ignored_name`).
pub const DIR: &str = "assets";

/// Höchstgröße einer Datei beim Hochladen.
pub const MAX_BYTES: usize = 50 * 1024 * 1024;

/// Bildformate, die Hakobo annimmt und anzeigt.
const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"];

fn ext_for_mime(mime: &str) -> Option<&'static str> {
    Some(match mime.split(';').next()?.trim().to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        _ => return None,
    })
}

/// Sicherer Dateiname für ein Bild: Buchstaben, Ziffern, `-` und `_`, Endung aus dem Namen
/// oder dem Inhaltstyp. `None`, wenn es kein unterstütztes Bild ist.
pub fn safe_name(name: &str, mime: Option<&str>) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let (stem, ext) = match base.rsplit_once('.') {
        Some((s, e)) if IMAGE_EXT.contains(&e.to_ascii_lowercase().as_str()) => (s, e.to_ascii_lowercase()),
        _ => (base, mime.and_then(ext_for_mime)?.to_string()),
    };
    let ext = if ext == "jpeg" { "jpg".to_string() } else { ext };
    let mut out = String::new();
    for c in stem.chars() {
        if c.is_alphanumeric() || c == '_' {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let stem: String = out.trim_matches('-').chars().take(60).collect();
    let stem = stem.trim_end_matches('-');
    Some(format!("{}.{ext}", if stem.is_empty() { "bild" } else { stem }))
}

/// Freier Name in `dir`: `bild.png`, sonst `bild-2.png`, `bild-3.png` …
pub fn unique_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (2..)
        .map(|i| if ext.is_empty() { format!("{stem}-{i}") } else { format!("{stem}-{i}.{ext}") })
        .find(|n| !dir.join(n).exists())
        .expect("freier Name")
}

/// Speichert ein Bild und liefert seinen Pfad im Notizbuch (`assets/bild.png`).
pub fn save(vault: &Path, name: &str, mime: Option<&str>, data: &[u8]) -> Result<String> {
    if data.is_empty() {
        bail!("Die Datei ist leer.");
    }
    if data.len() > MAX_BYTES {
        bail!("Die Datei ist größer als {} MB.", MAX_BYTES / 1024 / 1024);
    }
    let Some(name) = safe_name(name, mime) else {
        bail!("Nur Bilder werden unterstützt (PNG, JPEG, GIF, WebP, BMP, AVIF, SVG).");
    };
    let dir = vault.join(DIR);
    std::fs::create_dir_all(&dir).with_context(|| format!("{} konnte nicht angelegt werden", dir.display()))?;
    let name = unique_name(&dir, &name);
    // Erst vollständig schreiben, dann umbenennen (Dateibeobachter und Git sehen nie halbe Dateien).
    let tmp = dir.join(format!(".{name}.hakobo-tmp"));
    std::fs::write(&tmp, data).with_context(|| format!("{} konnte nicht geschrieben werden", tmp.display()))?;
    std::fs::rename(&tmp, dir.join(&name))?;
    Ok(format!("{DIR}/{name}"))
}

/// Datei zu einem Pfad wie `assets/bild.png` – nur innerhalb von `assets/`, ohne `..`.
pub fn resolve(vault: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim_start_matches('/');
    let path = Path::new(rel);
    let mut parts = path.components();
    if !matches!(parts.next(), Some(Component::Normal(first)) if first == DIR) {
        return None;
    }
    if rel.contains('\\') || !parts.all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    let full = vault.join(path);
    let base = vault.join(DIR).canonicalize().ok()?;
    let real = full.canonicalize().ok()?;
    (real.starts_with(&base) && real.is_file()).then_some(real)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe_and_keep_the_image_type() {
        assert_eq!(safe_name("Bildschirmfoto 2026-11-02 um 14.03.12.png", None).as_deref(), Some("Bildschirmfoto-2026-11-02-um-14-03-12.png"));
        assert_eq!(safe_name("Grüße.JPEG", None).as_deref(), Some("Grüße.jpg"));
        assert_eq!(safe_name("../../böse/../x.gif", None).as_deref(), Some("x.gif"));
        assert_eq!(safe_name("", Some("image/png")).as_deref(), Some("bild.png"));
        assert_eq!(safe_name("image", Some("image/webp; charset=binary")).as_deref(), Some("image.webp"));
        assert_eq!(safe_name("notiz.txt", Some("text/plain")), None);
        assert_eq!(safe_name("skript.exe", None), None);
    }

    #[test]
    fn existing_names_get_a_number() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("bild.png"), b"x").unwrap();
        std::fs::write(tmp.path().join("bild-2.png"), b"x").unwrap();
        assert_eq!(unique_name(tmp.path(), "bild.png"), "bild-3.png");
        assert_eq!(unique_name(tmp.path(), "anderes.png"), "anderes.png");
    }

    #[test]
    fn saved_images_land_in_assets() {
        let tmp = tempfile::tempdir().unwrap();
        let a = save(tmp.path(), "Skizze.png", Some("image/png"), b"\x89PNG").unwrap();
        let b = save(tmp.path(), "Skizze.png", Some("image/png"), b"\x89PNG").unwrap();
        assert_eq!((a.as_str(), b.as_str()), ("assets/Skizze.png", "assets/Skizze-2.png"));
        assert!(save(tmp.path(), "x.png", None, b"").is_err());
        assert!(save(tmp.path(), "x.txt", Some("text/plain"), b"hallo").is_err());
        // Keine halben Dateien liegen herum
        let names: Vec<String> = std::fs::read_dir(tmp.path().join(DIR)).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert!(names.iter().all(|n| !n.ends_with(".hakobo-tmp")));
    }

    #[test]
    fn only_files_inside_assets_are_served() {
        let tmp = tempfile::tempdir().unwrap();
        save(tmp.path(), "bild.png", None, b"x").unwrap();
        std::fs::write(tmp.path().join("Seite.md"), "- geheim").unwrap();
        assert!(resolve(tmp.path(), "assets/bild.png").is_some());
        assert!(resolve(tmp.path(), "/assets/bild.png").is_some());
        assert!(resolve(tmp.path(), "assets/../Seite.md").is_none());
        assert!(resolve(tmp.path(), "Seite.md").is_none());
        assert!(resolve(tmp.path(), "assets\\..\\Seite.md").is_none());
        assert!(resolve(tmp.path(), "assets/fehlt.png").is_none());
        assert!(resolve(tmp.path(), "assets").is_none());
    }
}
