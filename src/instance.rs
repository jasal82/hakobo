// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Einzelinstanz: Läuft Hakobo bereits, holt ein erneuter Start das Fenster
//! nach vorne. Die Kommandozeile spricht über die API mit der laufenden App,
//! damit Fenster und Dateien nie auseinanderlaufen.

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    #[serde(default)]
    pub vault: PathBuf,
}

fn file(config: &Path) -> PathBuf {
    config.join("instance.json")
}

pub fn register(config: &Path, port: u16, token: &str, vault: &Path) {
    let data = Instance { port, token: token.to_string(), pid: std::process::id(), vault: vault.to_path_buf() };
    if let Ok(json) = serde_json::to_string(&data) {
        let _ = std::fs::write(file(config), json);
    }
}

pub fn unregister(config: &Path) {
    let path = file(config);
    if let Ok(text) = std::fs::read_to_string(&path)
        && let Ok(i) = serde_json::from_str::<Instance>(&text)
        && i.pid == std::process::id()
    {
        let _ = std::fs::remove_file(path);
    }
}

/// Laufende Instanz (nur wenn ihr Port antwortet).
pub fn find(config: &Path) -> Option<Instance> {
    let text = std::fs::read_to_string(file(config)).ok()?;
    let i: Instance = serde_json::from_str(&text).ok()?;
    let addr = SocketAddr::from(([127, 0, 0, 1], i.port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    Some(i)
}

/// API-Aufruf bei der laufenden Instanz.
pub fn request(i: &Instance, method: &str, path: &str, body: Option<&Value>) -> Result<Value> {
    let url = format!("http://127.0.0.1:{}{path}", i.port);
    let req = ureq::request(method, &url).set("Authorization", &format!("Bearer {}", i.token)).timeout(Duration::from_secs(120));
    let resp = match body {
        Some(b) => req.send_json(b.clone()),
        None => req.call(),
    };
    match resp {
        Ok(r) => Ok(r.into_json::<Value>().unwrap_or(Value::Null)),
        Err(ureq::Error::Status(_, r)) => {
            let v: Value = r.into_json().unwrap_or(Value::Null);
            Err(anyhow!("{}", v["error"].as_str().unwrap_or("Fehler der laufenden App")))
        }
        Err(e) => Err(anyhow!("Laufende App nicht erreichbar: {e}")),
    }
}

/// Bittet eine laufende Instanz, ihr Fenster zu zeigen.
pub fn activate_existing(config: &Path) -> bool {
    find(config).is_some_and(|i| request(&i, "POST", "/api/system/focus", None).is_ok())
}
