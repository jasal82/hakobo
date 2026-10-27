// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Typen: Tags mit Feldern, definiert in `.hakobo/types.toml`.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FieldDef {
    pub key: String,
    #[serde(default)]
    pub label: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub multiple: bool,
}

fn default_kind() -> String {
    "text".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TypeDef {
    #[serde(default)]
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Neue Knoten dieses Typs landen standardmäßig auf dieser Seite (z. B. Personen).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
    #[serde(default)]
    pub fields: Vec<FieldDef>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TypesFile {
    #[serde(default)]
    pub types: BTreeMap<String, TypeDef>,
}

pub const FILE: &str = ".hakobo/types.toml";

const HEADER: &str = "# Hakobo-Typen: Ein Tag wird zum Typ, wenn er hier Felder bekommt.\n# Feldarten: text, number, date, select (options), ref (target, multiple), url, email, phone, checkbox\n\n";

impl TypesFile {
    pub fn load(vault: &Path) -> Result<TypesFile> {
        let path = vault.join(FILE);
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(TypesFile::default()),
            Err(e) => return Err(e).with_context(|| format!("{} konnte nicht gelesen werden", path.display())),
        };
        let mut file: TypesFile = toml::from_str(&text).with_context(|| format!("{} ist fehlerhaft", FILE))?;
        file.normalize();
        Ok(file)
    }

    /// Tag-Schlüssel klein, Bezeichnungen ergänzen.
    fn normalize(&mut self) {
        let types = std::mem::take(&mut self.types);
        for (key, mut def) in types {
            let key = key.trim_start_matches('#').to_lowercase();
            if def.label.is_empty() {
                def.label = capitalize(key.rsplit('/').next().unwrap_or(&key));
            }
            for f in &mut def.fields {
                if f.label.is_empty() {
                    f.label = capitalize(&f.key);
                }
            }
            self.types.insert(key, def);
        }
    }

    pub fn save(&self, vault: &Path) -> Result<()> {
        let path = vault.join(FILE);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = format!("{HEADER}{}", self.to_toml());
        crate::vault::write_atomic(&path, text.as_bytes())
    }

    /// Lesbares TOML: Felder als Inline-Tabellen, je Zeile eines.
    fn to_toml(&self) -> String {
        let mut out = String::new();
        for (key, def) in &self.types {
            out.push_str(&format!("[types.{}]\n", toml_key(key)));
            out.push_str(&format!("label = {}\n", toml_str(&def.label)));
            if let Some(c) = &def.color {
                out.push_str(&format!("color = {}\n", toml_str(c)));
            }
            if let Some(i) = &def.icon {
                out.push_str(&format!("icon = {}\n", toml_str(i)));
            }
            if let Some(p) = &def.page {
                out.push_str(&format!("page = {}\n", toml_str(p)));
            }
            out.push_str("fields = [\n");
            for f in &def.fields {
                let mut parts = vec![format!("key = {}", toml_str(&f.key)), format!("label = {}", toml_str(&f.label)), format!("kind = {}", toml_str(&f.kind))];
                if !f.options.is_empty() {
                    let o: Vec<String> = f.options.iter().map(|x| toml_str(x)).collect();
                    parts.push(format!("options = [{}]", o.join(", ")));
                }
                if let Some(t) = &f.target {
                    parts.push(format!("target = {}", toml_str(t)));
                }
                if f.multiple {
                    parts.push("multiple = true".into());
                }
                out.push_str(&format!("  {{ {} }},\n", parts.join(", ")));
            }
            out.push_str("]\n\n");
        }
        out
    }

    pub fn defaults() -> TypesFile {
        let f = |key: &str, label: &str, kind: &str| FieldDef {
            key: key.into(),
            label: label.into(),
            kind: kind.into(),
            options: vec![],
            target: None,
            multiple: false,
        };
        let mut types = BTreeMap::new();
        types.insert(
            "meeting".into(),
            TypeDef {
                label: "Meeting".into(),
                color: Some("violet".into()),
                icon: Some("users".into()),
                page: None,
                fields: vec![
                    f("date", "Datum", "date"),
                    FieldDef { target: Some("person".into()), multiple: true, ..f("teilnehmer", "Teilnehmer", "ref") },
                    FieldDef { target: Some("projekt".into()), ..f("projekt", "Projekt", "ref") },
                    f("ort", "Ort", "text"),
                ],
            },
        );
        types.insert(
            "projekt".into(),
            TypeDef {
                label: "Projekt".into(),
                color: Some("blue".into()),
                icon: Some("folder-kanban".into()),
                page: Some("Projekte".into()),
                fields: vec![
                    FieldDef {
                        options: vec!["idee".into(), "aktiv".into(), "pausiert".into(), "fertig".into()],
                        ..f("status", "Status", "select")
                    },
                    f("ziel", "Ziel", "text"),
                    f("date", "Deadline", "date"),
                ],
            },
        );
        types.insert(
            "person".into(),
            TypeDef {
                label: "Person".into(),
                color: Some("green".into()),
                icon: Some("user".into()),
                page: Some("Personen".into()),
                fields: vec![f("email", "E-Mail", "email"), f("telefon", "Telefon", "phone"), f("firma", "Firma", "text"), f("rolle", "Rolle", "text")],
            },
        );
        types.insert(
            "snippet".into(),
            TypeDef {
                label: "Snippet".into(),
                color: Some("orange".into()),
                icon: Some("code".into()),
                page: Some("Snippets".into()),
                fields: vec![f("sprache", "Sprache", "text"), f("quelle", "Quelle", "url")],
            },
        );
        TypesFile { types }
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

fn toml_str(s: &str) -> String {
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
    format!("\"{escaped}\"")
}

fn toml_key(k: &str) -> String {
    if !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') { k.to_string() } else { toml_str(k) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_roundtrip() {
        let d = TypesFile::defaults();
        let text = d.to_toml();
        let mut back: TypesFile = toml::from_str(&text).unwrap();
        back.normalize();
        assert_eq!(back, d);
        assert!(text.contains("{ key = \"teilnehmer\", label = \"Teilnehmer\", kind = \"ref\", target = \"person\", multiple = true }"));
    }

    #[test]
    fn nested_tag_keys() {
        let text = "[types.\"Projekte/Sqonto\"]\nfields = [{ key = \"phase\" }]\n";
        let mut f: TypesFile = toml::from_str(text).unwrap();
        f.normalize();
        let def = &f.types["projekte/sqonto"];
        assert_eq!(def.label, "Sqonto");
        assert_eq!(def.fields[0].label, "Phase");
        assert_eq!(def.fields[0].kind, "text");
        assert!(f.to_toml().contains("[types.\"projekte/sqonto\"]"));
    }
}
