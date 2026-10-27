// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Eingebettete Ressourcen: Web-Oberfläche und Programmsymbol.

use rust_embed::RustEmbed;

/// Gebaute Web-Oberfläche (`web/dist`). In Debug-Builds liest `rust-embed`
/// direkt vom Dateisystem.
#[derive(RustEmbed)]
#[folder = "web/dist/"]
#[exclude = ".keep"]
pub struct Web;

pub const ICON_PNG: &[u8] = include_bytes!("../assets/icon/icon-128.png");
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
pub const ICON_RGBA: &[u8] = include_bytes!("../assets/icon/icon-128.rgba");
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
pub const TRAY_RGBA: &[u8] = include_bytes!("../assets/icon/icon-32.rgba");
