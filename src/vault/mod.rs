//! Das Notizbuch im Speicher: ein Baum aus Wurzel, Seiten (Dateien/Ordner)
//! und Knoten. Änderungen kommen als Operationen aus der Oberfläche, werden
//! im Baum angewendet und seitenweise als Markdown zurückgeschrieben.

pub mod inline;
pub mod markdown;
pub mod types;

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, anyhow, bail};
use chrono::{Local, NaiveDateTime};
use serde::{Deserialize, Serialize};

use crate::dates::{Repeat, When};
use crate::search::{self, SearchDoc};
pub use markdown::Task;
use markdown::{FmEntry, ParsedItem, ParsedPage};
use types::TypesFile;

pub type NodeId = String;
pub const ROOT: &str = "root";
pub const INBOX_TITLE: &str = "Inbox";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Root,
    Page,
    Item,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Field {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub struct PageMeta {
    /// Relativer Pfad ohne `.md`, mit `/` getrennt, z. B. `Projekte/Sqonto`.
    pub path: String,
    pub has_file: bool,
    /// Ursprüngliche Frontmatter-Einträge (für unveränderte Rückgabe).
    pub frontmatter: Option<Vec<FmEntry>>,
    /// Letzte Änderung der Datei (Unix-Sekunden).
    pub modified: i64,
}

#[derive(Debug, Clone)]
pub struct Node {
    pub id: NodeId,
    pub kind: Kind,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub text: String,
    pub body: String,
    pub fields: Vec<Field>,
    pub task: Option<Task>,
    /// ID als `^id` in die Datei schreiben (Knoten ist verlinkt).
    pub pin_id: bool,
    pub page: Option<PageMeta>,
}

impl Node {
    pub fn field(&self, key: &str) -> Option<&str> {
        self.fields.iter().find(|f| f.key.eq_ignore_ascii_case(key)).map(|f| f.value.as_str())
    }

    pub fn set_field(&mut self, key: &str, value: Option<String>) {
        match value {
            Some(v) => match self.fields.iter_mut().find(|f| f.key.eq_ignore_ascii_case(key)) {
                Some(f) => f.value = v,
                None => self.fields.push(Field { key: key.to_string(), value: v }),
            },
            None => self.fields.retain(|f| !f.key.eq_ignore_ascii_case(key)),
        }
    }

    /// Datum aus `date::` (oder `due::`); Todos im Format von Obsidian Tasks
    /// (`📅 2026-10-30` im Text) werden ebenfalls erkannt.
    pub fn when(&self) -> Option<When> {
        if let Some(w) = self.field("date").or_else(|| self.field("due")).and_then(When::parse) {
            return Some(w);
        }
        let pos = self.text.find('📅')?;
        let rest = self.text[pos + '📅'.len_utf8()..].trim_start();
        When::parse(rest.get(..10)?)
    }

}

/// Knoten für die Oberfläche (inklusive abgeleiteter Tags und Links).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDto {
    pub id: String,
    pub kind: Kind,
    pub parent: Option<String>,
    pub children: Vec<String>,
    pub text: String,
    pub body: String,
    pub fields: Vec<Field>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<Task>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<LinkDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkDto {
    pub key: String,
    pub id: Option<String>,
}

/// Änderungen aus der Oberfläche.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    Create {
        #[serde(default)]
        id: Option<String>,
        parent: String,
        #[serde(default)]
        index: Option<usize>,
        #[serde(default)]
        text: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        fields: Vec<Field>,
        #[serde(default)]
        task: Option<Task>,
        #[serde(default)]
        page: bool,
    },
    Update {
        id: String,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        body: Option<String>,
        #[serde(default, deserialize_with = "double_option")]
        task: Option<Option<Task>>,
        #[serde(default)]
        fields: Option<Vec<Field>>,
    },
    Move {
        id: String,
        parent: String,
        #[serde(default)]
        index: Option<usize>,
    },
    Delete {
        id: String,
    },
    /// Knoten als eigene Seite auslagern (Unterseite der umgebenden Seite);
    /// an der alten Stelle bleibt ein Link.
    ToPage {
        id: String,
    },
}

fn double_option<'de, D, T>(d: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// Ergebnis von Operationen: geänderte und entfernte Knoten.
#[derive(Debug, Default)]
pub struct Changes {
    pub touched: BTreeSet<NodeId>,
    pub removed: BTreeSet<NodeId>,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.touched.is_empty() && self.removed.is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub nodes: Vec<NodeDto>,
    pub removed: Vec<NodeId>,
}

pub struct Vault {
    pub dir: PathBuf,
    nodes: HashMap<NodeId, Node>,
    pub inbox: NodeId,
    pub types: TypesFile,
    pub types_error: Option<String>,
    /// Seiten, die geschrieben werden müssen.
    dirty: HashSet<NodeId>,
    /// Inhalt (Hash), den wir zuletzt auf der Platte gesehen/geschrieben haben.
    disk_hash: HashMap<String, u64>,
    /// Geänderte Seiten seit der letzten Version (für die Commit-Nachricht).
    pub pending_commit: BTreeSet<String>,
    pub version: u64,
    page_titles: HashMap<String, Vec<NodeId>>,
    page_paths: HashMap<String, NodeId>,
    search_cache: Option<(u64, Arc<Vec<SearchDoc>>)>,
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

pub fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

const ALNUM: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

fn id_from_hash(mut h: u64) -> String {
    let mut s = String::with_capacity(6);
    s.push(ALNUM[(h % 26) as usize] as char);
    h /= 26;
    for _ in 0..5 {
        s.push(ALNUM[(h % 36) as usize] as char);
        h /= 36;
    }
    s
}

pub fn random_id() -> String {
    id_from_hash(rand::random::<u64>())
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && id != ROOT
}

/// Anzeigetitel: Klartext ohne Tags (für Linktexte).
pub fn display_title(text: &str) -> String {
    let plain = search::plain_text(text);
    let mut out = String::new();
    let mut last = 0;
    for (r, _) in inline::tags_with_ranges(&plain) {
        out.push_str(&plain[last..r.start]);
        last = r.end;
    }
    out.push_str(&plain[last..]);
    let t = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() { plain.trim().to_string() } else { t }
}

/// Schreibt eine Datei atomar (temporäre Datei + Umbenennen).
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.sqizzo-tmp"));
    std::fs::write(&tmp, data).with_context(|| format!("{} konnte nicht geschrieben werden", path.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("{} konnte nicht ersetzt werden", path.display()))?;
    Ok(())
}

/// Zulässiger Dateiname für einen Seitentitel.
pub fn sanitize_title(s: &str) -> String {
    let mut t: String = s
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '#' | '^' | '[' | ']') || c.is_control() { '-' } else { c })
        .collect();
    t = t.trim().trim_end_matches(['.', ' ']).trim_start_matches('.').to_string();
    if t.is_empty() {
        t = "Unbenannt".into();
    }
    let upper = t.to_ascii_uppercase();
    let base = upper.split('.').next().unwrap_or("");
    let reserved = matches!(base, "CON" | "PRN" | "AUX" | "NUL")
        || ((base.starts_with("COM") || base.starts_with("LPT")) && base.len() == 4 && base.as_bytes()[3].is_ascii_digit());
    if reserved {
        t.push('_');
    }
    if t.chars().count() > 120 {
        t = t.chars().take(120).collect::<String>().trim_end().to_string();
    }
    t
}

/// Natürliche Sortierung („Seite 2“ vor „Seite 10“), ohne Groß/Klein.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(&c) = ai.peek().filter(|c| c.is_ascii_digit()) {
                    na.push(c);
                    ai.next();
                }
                let mut nb = String::new();
                while let Some(&c) = bi.peek().filter(|c| c.is_ascii_digit()) {
                    nb.push(c);
                    bi.next();
                }
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let o = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                ai.next();
                bi.next();
            }
        }
    }
}

fn now() -> NaiveDateTime {
    Local::now().naive_local()
}

fn file_mtime(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn parent_path(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(p, _)| p)
}

fn last_segment(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Ist ein Pfadbestandteil versteckt oder kein Seitenordner?
fn ignored_name(name: &str, top: bool) -> bool {
    name.starts_with('.') || (top && (name.eq_ignore_ascii_case("assets") || name == "node_modules"))
}

struct Rebuild {
    old: HashMap<NodeId, Node>,
    used: HashSet<NodeId>,
    reserved: HashSet<String>,
}

/// Gelesene Datei: Inhalt, Hash, Änderungszeit.
type FileContent = (ParsedPage, u64, i64);

/// Seiten auf der Platte (Pfad → (hat Datei, ist Ordner)).
type DiskPages = Vec<(String, bool, bool)>;

impl Vault {
    /// Öffnet (oder legt an) ein Notizbuch.
    pub fn open(dir: &Path) -> Result<Vault> {
        std::fs::create_dir_all(dir).with_context(|| format!("Ordner {} konnte nicht angelegt werden", dir.display()))?;
        let dir = dunce(dir);
        let (types, types_error) = match TypesFile::load(&dir) {
            Ok(t) if t.types.is_empty() && !dir.join(types::FILE).exists() => {
                let d = TypesFile::defaults();
                if let Err(e) = d.save(&dir) {
                    tracing::warn!("Typen konnten nicht angelegt werden: {e:#}");
                }
                (d, None)
            }
            Ok(t) => (t, None),
            Err(e) => (TypesFile::default(), Some(format!("{e:#}"))),
        };
        let mut v = Vault {
            dir,
            nodes: HashMap::new(),
            inbox: String::new(),
            types,
            types_error,
            dirty: HashSet::new(),
            disk_hash: HashMap::new(),
            pending_commit: BTreeSet::new(),
            version: 1,
            page_titles: HashMap::new(),
            page_paths: HashMap::new(),
            search_cache: None,
        };
        v.nodes.insert(
            ROOT.into(),
            Node {
                id: ROOT.into(),
                kind: Kind::Root,
                parent: None,
                children: vec![],
                text: String::new(),
                body: String::new(),
                fields: vec![],
                task: None,
                pin_id: false,
                page: None,
            },
        );
        v.reload_from_disk()?;
        Ok(v)
    }

    // -- Lesen -------------------------------------------------------------

    pub fn get(&self, id: &str) -> Option<&Node> {
        self.nodes.get(id)
    }

    pub fn nodes(&self) -> impl Iterator<Item = &Node> {
        self.nodes.values()
    }

    /// Vorfahren von der Wurzel an (ohne Wurzel, ohne den Knoten selbst).
    pub fn ancestors(&self, id: &str) -> Vec<&Node> {
        let mut out = Vec::new();
        let mut cur = self.nodes.get(id).and_then(|n| n.parent.as_deref());
        while let Some(p) = cur {
            let Some(n) = self.nodes.get(p) else { break };
            if n.kind == Kind::Root {
                break;
            }
            out.push(n);
            cur = n.parent.as_deref();
        }
        out.reverse();
        out
    }

    /// Seite, zu der ein Knoten gehört (bei Seiten: sie selbst).
    pub fn page_of(&self, id: &str) -> Option<&Node> {
        let mut cur = self.nodes.get(id)?;
        loop {
            if cur.kind == Kind::Page {
                return Some(cur);
            }
            cur = self.nodes.get(cur.parent.as_deref()?)?;
        }
    }

    pub fn is_descendant(&self, id: &str, ancestor: &str) -> bool {
        let mut cur = self.nodes.get(id).and_then(|n| n.parent.clone());
        while let Some(p) = cur {
            if p == ancestor {
                return true;
            }
            cur = self.nodes.get(&p).and_then(|n| n.parent.clone());
        }
        false
    }

    /// Alle Knoten eines Teilbaums (inklusive Wurzel des Teilbaums).
    pub fn subtree(&self, id: &str) -> Vec<NodeId> {
        let mut out = Vec::new();
        let mut stack = vec![id.to_string()];
        while let Some(n) = stack.pop() {
            if let Some(node) = self.nodes.get(&n) {
                stack.extend(node.children.iter().rev().cloned());
            }
            out.push(n);
        }
        out
    }

    pub fn page_by_path(&self, path: &str) -> Option<&Node> {
        self.page_paths.get(&path.to_lowercase()).and_then(|id| self.nodes.get(id))
    }

    /// Tags eines Knotens (Text, Notiz, bei Seiten Frontmatter `tags`).
    pub fn tags_of(&self, n: &Node) -> Vec<String> {
        let mut t = inline::tags(&n.text);
        for x in inline::tags(&n.body) {
            if !t.contains(&x) {
                t.push(x);
            }
        }
        if n.kind == Kind::Page
            && let Some(v) = n.field("tags")
        {
            for x in v.split(',') {
                let x = x.trim().trim_start_matches('#').to_lowercase();
                if !x.is_empty() && !t.contains(&x) {
                    t.push(x);
                }
            }
        }
        t
    }

    /// Hat der Knoten den Tag (oder einen Unter-Tag davon)?
    pub fn has_tag(&self, n: &Node, tag: &str) -> bool {
        let tag = tag.to_lowercase();
        self.tags_of(n).iter().any(|t| *t == tag || t.starts_with(&format!("{tag}/")))
    }

    /// Alle Links eines Knotens (Text, Notiz, Felder).
    pub fn links_of(&self, n: &Node) -> Vec<inline::LinkRef> {
        let mut out = inline::links(&n.text);
        out.extend(inline::links(&n.body));
        for f in &n.fields {
            out.extend(inline::links(&f.value));
        }
        out
    }

    /// Findet eine Seite zu einem Linkziel.
    pub fn find_page(&self, target: &str) -> Option<NodeId> {
        let t = target.trim().trim_end_matches(".md").replace('\\', "/").trim_matches('/').to_lowercase();
        if t.is_empty() {
            return None;
        }
        if let Some(id) = self.page_paths.get(&t) {
            return Some(id.clone());
        }
        if t.contains('/') {
            let suffix = format!("/{t}");
            return self
                .page_paths
                .iter()
                .filter(|(p, _)| p.ends_with(&suffix))
                .min_by(|a, b| a.0.len().cmp(&b.0.len()).then_with(|| a.0.cmp(b.0)))
                .map(|(_, id)| id.clone());
        }
        let ids = self.page_titles.get(&t)?;
        ids.iter()
            .filter_map(|id| self.nodes.get(id))
            .min_by(|a, b| {
                let (pa, pb) = (&a.page.as_ref().unwrap().path, &b.page.as_ref().unwrap().path);
                pa.matches('/').count().cmp(&pb.matches('/').count()).then_with(|| pa.cmp(pb))
            })
            .map(|n| n.id.clone())
    }

    /// Löst einen Link auf (Seite oder Knoten).
    pub fn resolve(&self, l: &inline::LinkRef) -> Option<NodeId> {
        let page = self.find_page(&l.target);
        match l.anchor.as_deref() {
            Some(a) if a.starts_with('^') => {
                let id = &a[1..];
                self.nodes.get(id).filter(|n| n.kind == Kind::Item).map(|n| n.id.clone()).or(page)
            }
            Some(heading) if !heading.is_empty() => {
                let p = page?;
                let want = heading.trim().to_lowercase();
                self.subtree(&p)
                    .into_iter()
                    .find(|id| {
                        self.nodes.get(id).is_some_and(|n| {
                            n.kind == Kind::Item && n.text.trim_start_matches('#').trim().to_lowercase() == want
                        })
                    })
                    .or(Some(p))
            }
            _ => page,
        }
    }

    /// Kürzestes eindeutiges Linkziel für eine Seite.
    pub fn link_target(&self, page_id: &str) -> String {
        let Some(n) = self.nodes.get(page_id) else { return String::new() };
        let Some(p) = &n.page else { return n.text.clone() };
        let unique = self.page_titles.get(&n.text.to_lowercase()).is_none_or(|v| v.len() <= 1);
        if unique { n.text.clone() } else { p.path.clone() }
    }

    /// Linktext auf einen beliebigen Knoten.
    pub fn link_to(&mut self, id: &str) -> Result<String> {
        let node = self.nodes.get(id).ok_or_else(|| anyhow!("Knoten nicht gefunden"))?;
        match node.kind {
            Kind::Page => Ok(inline::format_link(&self.link_target(id), None, None)),
            Kind::Item => {
                let page = self.page_of(id).map(|p| p.id.clone()).ok_or_else(|| anyhow!("Seite nicht gefunden"))?;
                let alias = display_title(&node.text);
                let target = self.link_target(&page);
                self.pin(id);
                Ok(inline::format_link(&target, Some(&format!("^{id}")), Some(alias.trim())))
            }
            Kind::Root => bail!("Die Wurzel kann nicht verlinkt werden."),
        }
    }

    /// Sorgt dafür, dass die ID eines Knotens in der Datei steht.
    fn pin(&mut self, id: &str) {
        let page = match self.nodes.get_mut(id) {
            Some(n) if n.kind == Kind::Item && !n.pin_id => {
                n.pin_id = true;
                self.page_of(id).map(|p| p.id.clone())
            }
            _ => None,
        };
        if let Some(p) = page {
            self.mark_dirty(&p);
        }
    }

    pub fn dto(&self, id: &str) -> Option<NodeDto> {
        let n = self.nodes.get(id)?;
        let links = self
            .links_of(n)
            .into_iter()
            .map(|l| LinkDto { id: self.resolve(&l), key: l.key() })
            .collect::<Vec<_>>();
        Some(NodeDto {
            id: n.id.clone(),
            kind: n.kind,
            parent: n.parent.clone(),
            children: n.children.clone(),
            text: n.text.clone(),
            body: n.body.clone(),
            fields: n.fields.clone(),
            task: n.task,
            tags: self.tags_of(n),
            links,
            path: n.page.as_ref().map(|p| p.path.clone()),
        })
    }

    pub fn all_dtos(&self) -> Vec<NodeDto> {
        self.nodes.keys().filter_map(|id| self.dto(id)).collect()
    }

    pub fn patch(&self, changes: &Changes) -> Patch {
        Patch {
            nodes: changes.touched.iter().filter(|id| !changes.removed.contains(*id)).filter_map(|id| self.dto(id)).collect(),
            removed: changes.removed.iter().cloned().collect(),
        }
    }

    /// Tags mit Anzahl der Knoten.
    pub fn tag_counts(&self) -> Vec<(String, usize)> {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for n in self.nodes.values() {
            for t in self.tags_of(n) {
                *counts.entry(t).or_default() += 1;
            }
        }
        for key in self.types.types.keys() {
            counts.entry(key.clone()).or_default();
        }
        let mut v: Vec<_> = counts.into_iter().collect();
        v.sort_by(|a, b| a.0.cmp(&b.0));
        v
    }

    /// Suchindex (zwischengespeichert bis zur nächsten Änderung).
    pub fn search_docs(&mut self) -> Arc<Vec<SearchDoc>> {
        if let Some((v, docs)) = &self.search_cache
            && *v == self.version
        {
            return docs.clone();
        }
        let mut docs = Vec::with_capacity(self.nodes.len());
        let mut titles: HashMap<&str, String> = HashMap::new();
        for n in self.nodes.values() {
            titles.insert(n.id.as_str(), search::plain_text(&n.text));
        }
        for n in self.nodes.values() {
            if n.kind == Kind::Root {
                continue;
            }
            let path = self.ancestors(&n.id).iter().map(|a| titles.get(a.id.as_str()).cloned().unwrap_or_default()).collect();
            let modified = self.page_of(&n.id).and_then(|p| p.page.as_ref()).map(|p| p.modified).unwrap_or(0);
            docs.push(SearchDoc {
                id: n.id.clone(),
                is_page: n.kind == Kind::Page,
                title: titles.get(n.id.as_str()).cloned().unwrap_or_default(),
                body: search::plain_text(&n.body),
                path,
                tags: self.tags_of(n),
                task: n.task.map(|t| match t {
                    Task::Open => search::Task::Open,
                    Task::Doing => search::Task::Doing,
                    Task::Done => search::Task::Done,
                    Task::Cancelled => search::Task::Cancelled,
                }),
                date: n.when().map(|w| w.start),
                fields: n
                    .fields
                    .iter()
                    .filter(|f| !matches!(f.key.as_str(), "date" | "repeat" | "remind" | "done" | "tags"))
                    .map(|f| (f.key.clone(), search::plain_text(&f.value)))
                    .collect(),
                modified,
            });
        }
        let docs = Arc::new(docs);
        self.search_cache = Some((self.version, docs.clone()));
        docs
    }

    // -- Laden -------------------------------------------------------------

    pub fn page_file(&self, path: &str) -> PathBuf {
        let mut p = self.dir.clone();
        if let Some(parent) = parent_path(path) {
            for seg in parent.split('/') {
                p.push(seg);
            }
        }
        p.push(format!("{}.md", last_segment(path)));
        p
    }

    fn page_dir(&self, path: &str) -> PathBuf {
        let mut p = self.dir.clone();
        for seg in path.split('/') {
            p.push(seg);
        }
        p
    }

    /// Alle Seiten auf der Platte.
    fn scan_disk(&self) -> DiskPages {
        let mut map: HashMap<String, (String, bool, bool)> = HashMap::new();
        let walker = walkdir::WalkDir::new(&self.dir).min_depth(1).follow_links(false).into_iter().filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !ignored_name(&name, e.depth() == 1)
        });
        for entry in walker.flatten() {
            let Ok(rel) = entry.path().strip_prefix(&self.dir) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            if entry.file_type().is_dir() {
                let e = map.entry(rel.to_lowercase()).or_insert((rel.clone(), false, false));
                e.2 = true;
            } else if entry.file_type().is_file()
                && let Some(stem) = rel.strip_suffix(".md").or_else(|| rel.strip_suffix(".MD"))
            {
                let e = map.entry(stem.to_lowercase()).or_insert((stem.to_string(), false, false));
                e.1 = true;
                // Schreibweise der Datei bevorzugen
                e.0 = stem.to_string();
            }
        }
        let mut v: Vec<_> = map.into_values().collect();
        v.sort_by(|a, b| a.0.matches('/').count().cmp(&b.0.matches('/').count()).then_with(|| a.0.cmp(&b.0)));
        v
    }

    /// Liest das Notizbuch (erneut) von der Platte. Ungespeicherte Seiten
    /// im Speicher haben Vorrang. Liefert `true`, wenn sich etwas geändert hat.
    pub fn reload_from_disk(&mut self) -> Result<bool> {
        let disk = self.scan_disk();
        let mut changed = false;
        let disk_paths: HashSet<String> = disk.iter().map(|d| d.0.to_lowercase()).collect();

        // Verschwundene Seiten entfernen (tiefste zuerst).
        let mut gone: Vec<(String, NodeId)> = self
            .nodes
            .values()
            .filter_map(|n| n.page.as_ref().map(|p| (p.path.clone(), n.id.clone())))
            .filter(|(p, id)| !disk_paths.contains(&p.to_lowercase()) && !self.dirty.contains(id) && !p.eq_ignore_ascii_case(INBOX_TITLE))
            .collect();
        gone.sort_by_key(|g| std::cmp::Reverse(g.0.matches('/').count()));
        for (_, id) in gone {
            if self.nodes.contains_key(&id) {
                self.remove_subtree(&id);
                changed = true;
            }
        }

        // Inbox existiert immer (zur Not ohne Datei).
        let mut disk = disk;
        if !disk.iter().any(|d| d.0.eq_ignore_ascii_case(INBOX_TITLE)) {
            disk.insert(0, (INBOX_TITLE.to_string(), false, false));
        }

        // Alle Dateien lesen, reservierte IDs sammeln.
        let mut parsed: Vec<(String, Option<FileContent>, bool)> = Vec::new();
        let mut reserved = HashSet::new();
        for (path, has_file, _is_dir) in &disk {
            let key = path.to_lowercase();
            let existing = self.page_paths.get(&key).cloned();
            if existing.as_ref().is_some_and(|id| self.dirty.contains(id)) {
                parsed.push((path.clone(), None, *has_file));
                continue;
            }
            if *has_file {
                let file = self.page_file(path);
                let text = std::fs::read_to_string(&file).unwrap_or_default();
                let hash = fnv(&text);
                let unchanged = existing.is_some() && self.disk_hash.get(&key) == Some(&hash);
                if unchanged {
                    parsed.push((path.clone(), None, true));
                    continue;
                }
                let page = markdown::parse_page(&text);
                collect_ids(&page.items, &mut reserved);
                parsed.push((path.clone(), Some((page, hash, file_mtime(&file))), true));
            } else {
                parsed.push((path.clone(), None, false));
            }
        }

        for (path, content, has_file) in parsed {
            let key = path.to_lowercase();
            let page_id = match self.page_paths.get(&key).cloned() {
                Some(id) => id,
                None => {
                    let id = self.add_page_node(&path);
                    changed = true;
                    id
                }
            };
            if content.is_none() && !has_file {
                // Seite ohne Datei (Ordner oder Inbox): Inhalt leeren, falls die Datei verschwand.
                let had_file = self.nodes.get(&page_id).and_then(|n| n.page.as_ref()).is_some_and(|p| p.has_file);
                if had_file && !self.dirty.contains(&page_id) {
                    self.replace_page_content(&page_id, ParsedPage::default(), &reserved);
                    if let Some(p) = self.nodes.get_mut(&page_id).and_then(|n| n.page.as_mut()) {
                        p.has_file = false;
                    }
                    self.disk_hash.remove(&key);
                    changed = true;
                }
                continue;
            }
            if let Some((page, hash, mtime)) = content {
                self.replace_page_content(&page_id, page, &reserved);
                if let Some(p) = self.nodes.get_mut(&page_id).and_then(|n| n.page.as_mut()) {
                    p.has_file = true;
                    p.modified = mtime;
                }
                self.disk_hash.insert(key, hash);
                changed = true;
            }
        }
        self.inbox = self.page_paths.get(&INBOX_TITLE.to_lowercase()).cloned().unwrap_or_default();
        if changed {
            self.sort_all_children();
            self.reindex_pages();
            self.version += 1;
        }
        Ok(changed)
    }

    fn add_page_node(&mut self, path: &str) -> NodeId {
        let parent = match parent_path(path) {
            Some(pp) => match self.page_paths.get(&pp.to_lowercase()) {
                Some(id) => id.clone(),
                None => self.add_page_node(pp),
            },
            None => ROOT.to_string(),
        };
        let mut id = id_from_hash(fnv(&format!("p:{}", path.to_lowercase())));
        let mut salt = 0;
        while self.nodes.contains_key(&id) {
            salt += 1;
            id = id_from_hash(fnv(&format!("p:{}:{salt}", path.to_lowercase())));
        }
        self.nodes.insert(
            id.clone(),
            Node {
                id: id.clone(),
                kind: Kind::Page,
                parent: Some(parent.clone()),
                children: vec![],
                text: last_segment(path).to_string(),
                body: String::new(),
                fields: vec![],
                task: None,
                pin_id: false,
                page: Some(PageMeta { path: path.to_string(), has_file: false, frontmatter: None, modified: 0 }),
            },
        );
        if let Some(p) = self.nodes.get_mut(&parent) {
            p.children.push(id.clone());
        }
        self.page_paths.insert(path.to_lowercase(), id.clone());
        self.page_titles.entry(last_segment(path).to_lowercase()).or_default().push(id.clone());
        id
    }

    /// Ersetzt Notiz, Frontmatter und Knoten einer Seite; IDs bleiben, wo möglich, erhalten.
    fn replace_page_content(&mut self, page_id: &str, page: ParsedPage, reserved: &HashSet<String>) {
        let (old_items, path) = {
            let n = &self.nodes[page_id];
            let items: Vec<NodeId> = n.children.iter().filter(|c| self.nodes.get(*c).is_some_and(|x| x.kind == Kind::Item)).cloned().collect();
            (items, n.page.as_ref().map(|p| p.path.clone()).unwrap_or_default())
        };
        let mut rb = Rebuild { old: HashMap::new(), used: HashSet::new(), reserved: reserved.clone() };
        for item in &old_items {
            for id in self.subtree(item) {
                if let Some(n) = self.nodes.remove(&id) {
                    rb.old.insert(id, n);
                }
            }
        }
        let new_items = self.build_items(&mut rb, page_id, &old_items, page.items, &path.to_lowercase());
        let n = self.nodes.get_mut(page_id).expect("Seite");
        let pages: Vec<NodeId> = n.children.iter().filter(|c| !old_items.contains(c)).cloned().collect();
        n.children = new_items;
        n.children.extend(pages);
        n.body = page.body;
        n.fields = page
            .frontmatter
            .as_ref()
            .map(|fm| fm.iter().filter(|e| !e.key.is_empty()).map(|e| Field { key: e.key.clone(), value: e.value() }).collect())
            .unwrap_or_default();
        if let Some(meta) = n.page.as_mut() {
            meta.frontmatter = page.frontmatter;
        }
    }

    fn det_id(&self, seed: &str, rb: &Rebuild) -> NodeId {
        let mut salt = 0u32;
        loop {
            let s = if salt == 0 { seed.to_string() } else { format!("{seed}\u{3}{salt}") };
            let id = id_from_hash(fnv(&s));
            if !self.nodes.contains_key(&id) && !rb.used.contains(&id) && !rb.reserved.contains(&id) && !rb.old.contains_key(&id) {
                return id;
            }
            salt += 1;
        }
    }

    fn build_items(&mut self, rb: &mut Rebuild, parent: &str, old_children: &[NodeId], items: Vec<ParsedItem>, chain: &str) -> Vec<NodeId> {
        let mut out = Vec::with_capacity(items.len());
        let mut occurrences: HashMap<String, usize> = HashMap::new();
        for item in items {
            let occ = {
                let c = occurrences.entry(item.text.clone()).or_default();
                *c += 1;
                *c - 1
            };
            let persisted = item.id.clone().filter(|p| valid_id(p) && !self.nodes.contains_key(p) && !rb.used.contains(p));
            let id = if let Some(p) = persisted {
                p
            } else if let Some(o) = old_children
                .iter()
                .find(|o| !rb.used.contains(*o) && !self.nodes.contains_key(*o) && rb.old.get(*o).is_some_and(|n| n.text == item.text))
            {
                o.clone()
            } else {
                self.det_id(&format!("{chain}\u{1}{}\u{1}{occ}", item.text), rb)
            };
            rb.used.insert(id.clone());
            let old_grandchildren = rb.old.get(&id).map(|n| n.children.clone()).unwrap_or_default();
            let child_chain = format!("{chain}\u{2}{}", item.text);
            self.nodes.insert(
                id.clone(),
                Node {
                    id: id.clone(),
                    kind: Kind::Item,
                    parent: Some(parent.to_string()),
                    children: vec![],
                    text: item.text,
                    body: item.body,
                    fields: item.fields.into_iter().map(|(key, value)| Field { key, value }).collect(),
                    task: item.task,
                    pin_id: item.id.is_some(),
                    page: None,
                },
            );
            let kids = self.build_items(rb, &id, &old_grandchildren, item.children, &child_chain);
            if let Some(n) = self.nodes.get_mut(&id) {
                n.children = kids;
            }
            out.push(id);
        }
        out
    }

    fn sort_all_children(&mut self) {
        let ids: Vec<NodeId> = self.nodes.values().filter(|n| n.kind != Kind::Item).map(|n| n.id.clone()).collect();
        for id in ids {
            self.sort_page_children(&id);
        }
    }

    /// Knoten zuerst (Reihenfolge bleibt), dann Unterseiten alphabetisch;
    /// in der Wurzel die Inbox vorne.
    fn sort_page_children(&mut self, id: &str) {
        let Some(n) = self.nodes.get(id) else { return };
        let mut items = Vec::new();
        let mut pages = Vec::new();
        for c in &n.children {
            match self.nodes.get(c) {
                Some(x) if x.kind == Kind::Page => pages.push((x.text.clone(), c.clone())),
                Some(_) => items.push(c.clone()),
                None => {}
            }
        }
        let inbox = self.inbox.clone();
        pages.sort_by(|a, b| {
            let (ia, ib) = (a.1 == inbox || a.0.eq_ignore_ascii_case(INBOX_TITLE) && id == ROOT, b.1 == inbox || b.0.eq_ignore_ascii_case(INBOX_TITLE) && id == ROOT);
            ib.cmp(&ia).then_with(|| natural_cmp(&a.0, &b.0))
        });
        items.extend(pages.into_iter().map(|p| p.1));
        if let Some(n) = self.nodes.get_mut(id) {
            n.children = items;
        }
    }

    fn reindex_pages(&mut self) {
        self.page_titles.clear();
        self.page_paths.clear();
        for n in self.nodes.values() {
            if let Some(p) = &n.page {
                self.page_paths.insert(p.path.to_lowercase(), n.id.clone());
                self.page_titles.entry(n.text.to_lowercase()).or_default().push(n.id.clone());
            }
        }
    }

    fn remove_subtree(&mut self, id: &str) -> Vec<NodeId> {
        let ids = self.subtree(id);
        if let Some(parent) = self.nodes.get(id).and_then(|n| n.parent.clone())
            && let Some(p) = self.nodes.get_mut(&parent)
        {
            p.children.retain(|c| c != id);
        }
        for i in &ids {
            if let Some(n) = self.nodes.remove(i)
                && let Some(p) = n.page
            {
                self.page_paths.remove(&p.path.to_lowercase());
                self.disk_hash.remove(&p.path.to_lowercase());
                self.dirty.remove(i);
            }
        }
        self.reindex_pages();
        ids
    }

    // -- Schreiben ---------------------------------------------------------

    fn mark_dirty(&mut self, page_id: &str) {
        self.dirty.insert(page_id.to_string());
        if let Some(p) = self.nodes.get(page_id).and_then(|n| n.page.as_ref()) {
            self.pending_commit.insert(p.path.clone());
        }
    }

    pub fn has_dirty(&self) -> bool {
        !self.dirty.is_empty()
    }

    /// Stammt eine Änderung auf der Platte von außen (nicht von uns)?
    /// `rel`: Pfad relativ zum Notizbuch.
    pub fn is_foreign_change(&self, rel: &str) -> bool {
        let rel = rel.replace('\\', "/");
        let segs: Vec<&str> = rel.split('/').collect();
        if segs.iter().enumerate().any(|(i, s)| ignored_name(s, i == 0)) {
            return false;
        }
        let path = self.dir.join(&rel);
        if let Some(stem) = rel.strip_suffix(".md") {
            return match std::fs::read_to_string(&path) {
                Ok(text) => self.disk_hash.get(&stem.to_lowercase()) != Some(&fnv(&text)),
                Err(_) => self.page_by_path(stem).and_then(|p| p.page.as_ref()).is_some_and(|m| m.has_file),
            };
        }
        if path.is_dir() {
            return self.page_by_path(&rel).is_none();
        }
        !path.exists() && self.page_by_path(&rel).is_some()
    }

    fn item_to_parsed(&self, id: &str) -> ParsedItem {
        let n = &self.nodes[id];
        ParsedItem {
            text: self.refresh_aliases(&n.text),
            task: n.task,
            id: n.pin_id.then(|| n.id.clone()),
            fields: n.fields.iter().map(|f| (f.key.clone(), self.refresh_aliases(&f.value))).collect(),
            body: self.refresh_aliases(&n.body),
            children: n.children.iter().filter(|c| self.nodes.get(*c).is_some_and(|x| x.kind == Kind::Item)).map(|c| self.item_to_parsed(c)).collect(),
        }
    }

    /// Frischt Anzeigetexte von Knoten-Links auf (`[[Seite#^id|Text]]`).
    fn refresh_aliases(&self, text: &str) -> String {
        if !text.contains("[[") {
            return text.to_string();
        }
        inline::rewrite_links(text, |l| {
            let id = l.block_id()?;
            l.alias.as_ref()?;
            let target = self.nodes.get(id)?;
            let alias = display_title(&target.text);
            let alias = alias.trim();
            if alias.is_empty() || Some(alias) == l.alias.as_deref() {
                return None;
            }
            Some(inline::format_link(&l.target, l.anchor.as_deref(), Some(alias)))
        })
    }

    fn page_to_parsed(&self, page_id: &str) -> ParsedPage {
        let n = &self.nodes[page_id];
        let meta = n.page.as_ref();
        let original = meta.and_then(|m| m.frontmatter.clone());
        let frontmatter = build_frontmatter(original.as_deref(), &n.fields);
        ParsedPage {
            frontmatter,
            body: n.body.clone(),
            items: n.children.iter().filter(|c| self.nodes.get(*c).is_some_and(|x| x.kind == Kind::Item)).map(|c| self.item_to_parsed(c)).collect(),
        }
    }

    /// Schreibt alle geänderten Seiten. Liefert die geschriebenen Pfade.
    pub fn flush(&mut self) -> Result<Vec<String>> {
        let dirty: Vec<NodeId> = self.dirty.drain().collect();
        let mut written = Vec::new();
        let mut first_err = None;
        for id in dirty {
            let Some(n) = self.nodes.get(&id) else { continue };
            let Some(meta) = &n.page else { continue };
            let path = meta.path.clone();
            let parsed = self.page_to_parsed(&id);
            let empty = parsed.items.is_empty() && parsed.body.is_empty() && parsed.frontmatter.is_none();
            if !meta.has_file && empty {
                continue;
            }
            let text = markdown::write_page(&parsed);
            let file = self.page_file(&path);
            match write_atomic(&file, text.as_bytes()) {
                Ok(()) => {
                    self.disk_hash.insert(path.to_lowercase(), fnv(&text));
                    if let Some(m) = self.nodes.get_mut(&id).and_then(|n| n.page.as_mut()) {
                        m.has_file = true;
                        m.modified = file_mtime(&file);
                        m.frontmatter = parsed.frontmatter;
                    }
                    written.push(path);
                }
                Err(e) => {
                    self.dirty.insert(id);
                    first_err.get_or_insert(e);
                }
            }
        }
        match first_err {
            Some(e) => Err(e),
            None => Ok(written),
        }
    }

    // -- Ändern ------------------------------------------------------------

    pub fn apply(&mut self, ops: Vec<Op>) -> Result<Changes> {
        let mut ch = Changes::default();
        for op in ops {
            self.apply_one(op, &mut ch)?;
        }
        if !ch.is_empty() {
            self.version += 1;
        }
        Ok(ch)
    }

    fn apply_one(&mut self, op: Op, ch: &mut Changes) -> Result<()> {
        match op {
            Op::Create { id, parent, index, text, body, fields, task, page } => {
                if page {
                    let id = self.create_page(&parent, &text, id, ch)?;
                    if !body.is_empty() || !fields.is_empty() {
                        let n = self.nodes.get_mut(&id).expect("neue Seite");
                        n.body = body;
                        n.fields = fields;
                        self.mark_dirty(&id);
                    }
                } else {
                    self.create_item(id, &parent, index, text, body, fields, task, ch)?;
                }
            }
            Op::Update { id, text, body, task, fields } => self.update(&id, text, body, task, fields, ch)?,
            Op::Move { id, parent, index } => self.move_node(&id, &parent, index, ch)?,
            Op::Delete { id } => self.delete(&id, ch)?,
            Op::ToPage { id } => {
                self.item_to_page(&id, ch)?;
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_item(
        &mut self,
        id: Option<String>,
        parent: &str,
        index: Option<usize>,
        text: String,
        body: String,
        fields: Vec<Field>,
        task: Option<Task>,
        ch: &mut Changes,
    ) -> Result<NodeId> {
        let p = self.nodes.get(parent).ok_or_else(|| anyhow!("Übergeordneter Knoten nicht gefunden"))?;
        if p.kind == Kind::Root {
            bail!("In der obersten Ebene stehen nur Seiten.");
        }
        let id = match id {
            Some(i) if valid_id(&i) && !self.nodes.contains_key(&i) => i,
            Some(i) if self.nodes.contains_key(&i) => bail!("ID {i} ist bereits vergeben."),
            _ => self.fresh_id(),
        };
        let item_count = p.children.iter().filter(|c| self.nodes.get(*c).is_some_and(|x| x.kind == Kind::Item)).count();
        let idx = index.unwrap_or(item_count).min(item_count);
        self.nodes.insert(
            id.clone(),
            Node {
                id: id.clone(),
                kind: Kind::Item,
                parent: Some(parent.to_string()),
                children: vec![],
                text: text.replace(['\n', '\r'], " "),
                body,
                fields,
                task,
                pin_id: false,
                page: None,
            },
        );
        self.nodes.get_mut(parent).expect("Elternknoten").children.insert(idx, id.clone());
        self.pin_link_targets(&id);
        ch.touched.insert(id.clone());
        ch.touched.insert(parent.to_string());
        if let Some(page) = self.page_of(&id).map(|p| p.id.clone()) {
            self.mark_dirty(&page);
        }
        Ok(id)
    }

    fn fresh_id(&self) -> NodeId {
        loop {
            let id = random_id();
            if !self.nodes.contains_key(&id) {
                return id;
            }
        }
    }

    /// Verlinkte Knoten bekommen eine feste ID in der Datei.
    fn pin_link_targets(&mut self, id: &str) {
        let Some(n) = self.nodes.get(id) else { return };
        let targets: Vec<String> = self.links_of(n).iter().filter_map(|l| l.block_id().map(str::to_string)).collect();
        for t in targets {
            self.pin(&t);
        }
    }

    pub fn create_page(&mut self, parent: &str, title: &str, id: Option<String>, ch: &mut Changes) -> Result<NodeId> {
        let p = self.nodes.get(parent).ok_or_else(|| anyhow!("Übergeordnete Seite nicht gefunden"))?;
        let parent_path = match p.kind {
            Kind::Root => None,
            Kind::Page => p.page.as_ref().map(|m| m.path.clone()),
            Kind::Item => bail!("Seiten können nur unter Seiten angelegt werden."),
        };
        let title = self.unique_title(parent_path.as_deref(), &sanitize_title(title), None);
        let path = match &parent_path {
            Some(pp) => format!("{pp}/{title}"),
            None => title.clone(),
        };
        let page_id = self.add_page_node(&path);
        // Gewünschte ID übernehmen, falls frei (die Oberfläche kennt sie schon).
        let page_id = match id {
            Some(want) if valid_id(&want) && !self.nodes.contains_key(&want) => {
                let mut n = self.nodes.remove(&page_id).expect("neue Seite");
                n.id = want.clone();
                self.nodes.insert(want.clone(), n);
                if let Some(par) = self.nodes.get_mut(parent) {
                    for c in par.children.iter_mut() {
                        if *c == page_id {
                            *c = want.clone();
                        }
                    }
                }
                want
            }
            _ => page_id,
        };
        self.reindex_pages();
        self.sort_page_children(parent);
        // Leere Datei anlegen, damit die Seite sofort existiert.
        let file = self.page_file(&path);
        write_atomic(&file, b"")?;
        self.disk_hash.insert(path.to_lowercase(), fnv(""));
        if let Some(m) = self.nodes.get_mut(&page_id).and_then(|n| n.page.as_mut()) {
            m.has_file = true;
            m.modified = file_mtime(&file);
        }
        self.pending_commit.insert(path);
        ch.touched.insert(page_id.clone());
        ch.touched.insert(parent.to_string());
        self.version += 1;
        Ok(page_id)
    }

    /// Freier Titel unter einer Seite („Titel 2“, „Titel 3“ …).
    fn unique_title(&self, parent_path: Option<&str>, title: &str, except: Option<&str>) -> String {
        let taken = |t: &str| {
            let path = match parent_path {
                Some(pp) => format!("{pp}/{t}"),
                None => t.to_string(),
            };
            self.page_paths.get(&path.to_lowercase()).is_some_and(|id| Some(id.as_str()) != except)
        };
        if !taken(title) {
            return title.to_string();
        }
        (2..).map(|i| format!("{title} {i}")).find(|t| !taken(t)).expect("freier Titel")
    }

    fn update(&mut self, id: &str, text: Option<String>, body: Option<String>, task: Option<Option<Task>>, fields: Option<Vec<Field>>, ch: &mut Changes) -> Result<()> {
        let kind = self.nodes.get(id).map(|n| n.kind).ok_or_else(|| anyhow!("Knoten nicht gefunden"))?;
        if kind == Kind::Root {
            bail!("Die Wurzel kann nicht geändert werden.");
        }
        if kind == Kind::Page
            && let Some(t) = &text
            && *t != self.nodes[id].text
        {
            self.rename_page(id, t, ch)?;
        }
        let n = self.nodes.get_mut(id).expect("Knoten");
        if kind == Kind::Item
            && let Some(t) = text
        {
            n.text = t.replace(['\n', '\r'], " ");
        }
        if let Some(b) = body {
            n.body = b;
        }
        if let Some(f) = fields {
            n.fields = f.into_iter().filter(|f| !f.key.trim().is_empty()).collect();
        }
        if kind == Kind::Item
            && let Some(t) = task
        {
            let before = n.task;
            n.task = t;
            if t == Some(Task::Done) && before != Some(Task::Done) {
                complete(n, now());
            } else if t != Some(Task::Done) {
                n.set_field("done", None);
            }
        }
        ch.touched.insert(id.to_string());
        self.pin_link_targets(id);
        if let Some(page) = self.page_of(id).map(|p| p.id.clone()) {
            self.mark_dirty(&page);
        }
        Ok(())
    }

    /// Links, die auf Knoten der Menge `ids` zeigen: (Knoten, Linkschlüssel) → Ziel.
    fn incoming_links(&self, ids: &HashSet<NodeId>) -> HashMap<NodeId, HashMap<String, NodeId>> {
        let mut out: HashMap<NodeId, HashMap<String, NodeId>> = HashMap::new();
        for n in self.nodes.values() {
            for l in self.links_of(n) {
                if let Some(t) = self.resolve(&l)
                    && ids.contains(&t)
                {
                    out.entry(n.id.clone()).or_default().insert(l.key(), t);
                }
            }
        }
        out
    }

    /// Schreibt gesammelte Links auf ihre (neuen) Ziele um.
    fn rewrite_incoming(&mut self, incoming: HashMap<NodeId, HashMap<String, NodeId>>, ch: &mut Changes) {
        for (source, map) in incoming {
            let Some(n) = self.nodes.get(&source) else { continue };
            let fix = |text: &str| {
                inline::rewrite_links(text, |l| {
                    let target = map.get(&l.key())?;
                    let tn = self.nodes.get(target)?;
                    let new = match tn.kind {
                        Kind::Page => inline::format_link(&self.link_target(target), None, l.alias.as_deref()),
                        Kind::Item => {
                            let page = self.page_of(target)?;
                            let anchor = l.anchor.clone().unwrap_or_else(|| format!("^{target}"));
                            inline::format_link(&self.link_target(&page.id), Some(&anchor), l.alias.as_deref())
                        }
                        Kind::Root => return None,
                    };
                    (new != l_text(text, l)).then_some(new)
                })
            };
            let text = fix(&n.text);
            let body = fix(&n.body);
            let fields: Vec<Field> = n.fields.iter().map(|f| Field { key: f.key.clone(), value: fix(&f.value) }).collect();
            let changed = text != n.text || body != n.body || fields != n.fields;
            if changed {
                let n = self.nodes.get_mut(&source).expect("Quelle");
                n.text = text;
                n.body = body;
                n.fields = fields;
                ch.touched.insert(source.clone());
                if let Some(p) = self.page_of(&source).map(|p| p.id.clone()) {
                    self.mark_dirty(&p);
                }
            }
        }
    }

    fn page_subtree_set(&self, id: &str) -> HashSet<NodeId> {
        self.subtree(id).into_iter().collect()
    }

    fn rename_page(&mut self, id: &str, new_title: &str, ch: &mut Changes) -> Result<()> {
        if id == self.inbox {
            bail!("Die Inbox kann nicht umbenannt werden.");
        }
        let n = &self.nodes[id];
        let old_path = n.page.as_ref().map(|p| p.path.clone()).unwrap_or_default();
        let parent = parent_path(&old_path).map(str::to_string);
        let title = self.unique_title(parent.as_deref(), &sanitize_title(new_title), Some(id));
        if title == n.text {
            return Ok(());
        }
        let new_path = match &parent {
            Some(pp) => format!("{pp}/{title}"),
            None => title.clone(),
        };
        self.relocate_page(id, &new_path, ch)
    }

    /// Verschiebt/benennt eine Seite (Datei und Ordner) und passt Links an.
    fn relocate_page(&mut self, id: &str, new_path: &str, ch: &mut Changes) -> Result<()> {
        let old_path = self.nodes[id].page.as_ref().map(|p| p.path.clone()).unwrap_or_default();
        let affected = self.page_subtree_set(id);
        let incoming = self.incoming_links(&affected);
        // Erst ungespeicherte Änderungen schreiben, dann Dateien bewegen.
        self.flush()?;
        let (old_file, new_file) = (self.page_file(&old_path), self.page_file(new_path));
        let (old_dir, new_dir) = (self.page_dir(&old_path), self.page_dir(new_path));
        if let Some(d) = new_file.parent() {
            std::fs::create_dir_all(d)?;
        }
        if old_file.exists() {
            std::fs::rename(&old_file, &new_file).with_context(|| format!("{} konnte nicht umbenannt werden", old_file.display()))?;
        }
        if old_dir.is_dir() {
            std::fs::rename(&old_dir, &new_dir).with_context(|| format!("{} konnte nicht umbenannt werden", old_dir.display()))?;
        }
        // Pfade im Teilbaum anpassen.
        for nid in self.subtree(id) {
            let Some(n) = self.nodes.get_mut(&nid) else { continue };
            let Some(meta) = n.page.as_mut() else { continue };
            let rest = &meta.path[old_path.len().min(meta.path.len())..];
            let updated = format!("{new_path}{rest}");
            if let Some(h) = self.disk_hash.remove(&meta.path.to_lowercase()) {
                self.disk_hash.insert(updated.to_lowercase(), h);
            }
            self.pending_commit.insert(meta.path.clone());
            meta.path = updated.clone();
            n.text = last_segment(&updated).to_string();
            self.pending_commit.insert(updated);
            ch.touched.insert(nid.clone());
        }
        self.reindex_pages();
        self.rewrite_incoming(incoming, ch);
        self.version += 1;
        Ok(())
    }

    fn move_node(&mut self, id: &str, parent: &str, index: Option<usize>, ch: &mut Changes) -> Result<()> {
        let node = self.nodes.get(id).ok_or_else(|| anyhow!("Knoten nicht gefunden"))?;
        let target = self.nodes.get(parent).ok_or_else(|| anyhow!("Ziel nicht gefunden"))?;
        if id == parent || self.is_descendant(parent, id) {
            bail!("Ein Knoten kann nicht in sich selbst verschoben werden.");
        }
        let old_parent = node.parent.clone().unwrap_or_default();
        match node.kind {
            Kind::Root => bail!("Die Wurzel kann nicht verschoben werden."),
            Kind::Page => {
                if target.kind == Kind::Item {
                    bail!("Seiten können nur unter Seiten liegen.");
                }
                if id == self.inbox {
                    bail!("Die Inbox bleibt in der obersten Ebene.");
                }
                if old_parent == parent {
                    return Ok(());
                }
                let parent_path = target.page.as_ref().map(|p| p.path.clone());
                let title = self.unique_title(parent_path.as_deref(), &node.text, Some(id));
                let new_path = match parent_path {
                    Some(pp) => format!("{pp}/{title}"),
                    None => title,
                };
                self.relocate_page(id, &new_path, ch)?;
                if let Some(p) = self.nodes.get_mut(&old_parent) {
                    p.children.retain(|c| c != id);
                }
                self.nodes.get_mut(parent).expect("Ziel").children.push(id.to_string());
                self.nodes.get_mut(id).expect("Seite").parent = Some(parent.to_string());
                self.sort_page_children(parent);
                ch.touched.extend([old_parent, parent.to_string(), id.to_string()]);
                Ok(())
            }
            Kind::Item => {
                if target.kind == Kind::Root {
                    bail!("In der obersten Ebene stehen nur Seiten.");
                }
                let old_page = self.page_of(id).map(|p| p.id.clone());
                let pinned: HashSet<NodeId> = self.subtree(id).into_iter().filter(|x| self.nodes.get(x).is_some_and(|n| n.pin_id)).collect();
                let new_page = self.page_of(parent).map(|p| p.id.clone());
                let incoming = if old_page != new_page && !pinned.is_empty() { self.incoming_links(&pinned) } else { HashMap::new() };
                if let Some(p) = self.nodes.get_mut(&old_parent) {
                    p.children.retain(|c| c != id);
                }
                let target = self.nodes.get(parent).expect("Ziel");
                let item_count = target.children.iter().filter(|c| self.nodes.get(*c).is_some_and(|x| x.kind == Kind::Item)).count();
                let idx = index.unwrap_or(item_count).min(item_count);
                self.nodes.get_mut(parent).expect("Ziel").children.insert(idx, id.to_string());
                self.nodes.get_mut(id).expect("Knoten").parent = Some(parent.to_string());
                for p in [old_page, new_page].into_iter().flatten() {
                    self.mark_dirty(&p);
                }
                ch.touched.extend([old_parent, parent.to_string(), id.to_string()]);
                self.rewrite_incoming(incoming, ch);
                Ok(())
            }
        }
    }

    fn delete(&mut self, id: &str, ch: &mut Changes) -> Result<()> {
        let node = self.nodes.get(id).ok_or_else(|| anyhow!("Knoten nicht gefunden"))?;
        let parent = node.parent.clone().unwrap_or_default();
        match node.kind {
            Kind::Root => bail!("Die Wurzel kann nicht gelöscht werden."),
            Kind::Page => {
                if id == self.inbox {
                    bail!("Die Inbox kann nicht gelöscht werden.");
                }
                let path = node.page.as_ref().map(|p| p.path.clone()).unwrap_or_default();
                let file = self.page_file(&path);
                let dir = self.page_dir(&path);
                if file.exists() {
                    std::fs::remove_file(&file).with_context(|| format!("{} konnte nicht gelöscht werden", file.display()))?;
                }
                if dir.is_dir() {
                    std::fs::remove_dir_all(&dir).with_context(|| format!("{} konnte nicht gelöscht werden", dir.display()))?;
                }
                for p in self.subtree(id) {
                    if let Some(m) = self.nodes.get(&p).and_then(|n| n.page.as_ref()) {
                        self.pending_commit.insert(m.path.clone());
                    }
                }
                let removed = self.remove_subtree(id);
                ch.removed.extend(removed);
                ch.touched.insert(parent);
            }
            Kind::Item => {
                let page = self.page_of(id).map(|p| p.id.clone());
                let removed = self.remove_subtree(id);
                ch.removed.extend(removed);
                ch.touched.insert(parent);
                if let Some(p) = page {
                    self.mark_dirty(&p);
                }
            }
        }
        Ok(())
    }

    /// Lagert einen Knoten als Unterseite der umgebenden Seite aus. Kinder,
    /// Notiz und Felder wandern mit, Tags ins Frontmatter; der Knoten bleibt
    /// als Link auf die neue Seite stehen.
    pub fn item_to_page(&mut self, id: &str, ch: &mut Changes) -> Result<NodeId> {
        let n = self.nodes.get(id).ok_or_else(|| anyhow!("Knoten nicht gefunden"))?.clone();
        if n.kind != Kind::Item {
            bail!("Nur Einträge können als Seite ausgelagert werden.");
        }
        let host = self.page_of(id).map(|p| p.id.clone()).ok_or_else(|| anyhow!("Seite nicht gefunden"))?;
        let title = display_title(&n.text);
        let title = if title.trim().is_empty() { "Unbenannt".to_string() } else { title };
        let page = self.create_page(&host, &title, None, ch)?;
        // Kinder umhängen (vor eventuelle Unterseiten).
        let kids: Vec<NodeId> = n.children.iter().filter(|c| self.nodes.get(*c).is_some_and(|x| x.kind == Kind::Item)).cloned().collect();
        for (i, c) in kids.iter().enumerate() {
            if let Some(x) = self.nodes.get_mut(c) {
                x.parent = Some(page.clone());
            }
            self.nodes.get_mut(&page).expect("neue Seite").children.insert(i, c.clone());
        }
        let tags = inline::tags(&n.text);
        let mut fields = n.fields.clone();
        if !tags.is_empty() {
            fields.insert(0, Field { key: "tags".into(), value: tags.join(", ") });
        }
        {
            let p = self.nodes.get_mut(&page).expect("neue Seite");
            p.body = n.body.clone();
            p.fields = fields;
        }
        let link = inline::format_link(&self.link_target(&page), None, None);
        {
            let item = self.nodes.get_mut(id).expect("Knoten");
            item.children.retain(|c| !kids.contains(c));
            item.text = link;
            item.body.clear();
            item.fields.clear();
        }
        self.mark_dirty(&page);
        self.mark_dirty(&host);
        ch.touched.extend([id.to_string(), page.clone(), host]);
        ch.touched.extend(kids);
        Ok(page)
    }

    /// Ersetzt die Typdefinitionen und speichert sie.
    pub fn save_types(&mut self, types: TypesFile) -> Result<()> {
        types.save(&self.dir)?;
        self.types = TypesFile::load(&self.dir)?;
        self.types_error = None;
        self.pending_commit.insert(types::FILE.into());
        self.version += 1;
        Ok(())
    }

    pub fn reload_types(&mut self) {
        match TypesFile::load(&self.dir) {
            Ok(t) => {
                self.types = t;
                self.types_error = None;
            }
            Err(e) => self.types_error = Some(format!("{e:#}")),
        }
    }
}

/// Originaltext eines Links im Text.
fn l_text<'a>(text: &'a str, l: &inline::LinkRef) -> &'a str {
    let s = &text[l.range.clone()];
    s.strip_prefix('!').unwrap_or(s)
}

fn collect_ids(items: &[ParsedItem], out: &mut HashSet<String>) {
    for i in items {
        if let Some(id) = &i.id {
            out.insert(id.clone());
        }
        collect_ids(&i.children, out);
    }
}

/// Frontmatter aus Feldern; unveränderte Einträge behalten ihren Originaltext.
fn build_frontmatter(original: Option<&[FmEntry]>, fields: &[Field]) -> Option<Vec<FmEntry>> {
    let mut out: Vec<FmEntry> = Vec::new();
    let mut done: HashSet<String> = HashSet::new();
    let entry_for = |f: &Field, orig: Option<&FmEntry>| -> FmEntry {
        if let Some(o) = orig
            && o.value() == f.value
        {
            return o.clone();
        }
        let is_list = f.key == "tags" || f.key == "aliases" || orig.is_some_and(|o| o.values().len() > 1 || o.raw.trim_start().starts_with('['));
        if is_list {
            let vals: Vec<String> = f.value.split(',').map(|v| v.trim().trim_start_matches('#').to_string()).filter(|v| !v.is_empty()).collect();
            FmEntry::new_list(&f.key, &vals)
        } else {
            FmEntry::new(&f.key, &f.value)
        }
    };
    if let Some(orig) = original {
        for e in orig {
            if e.key.is_empty() {
                out.push(e.clone());
                continue;
            }
            if let Some(f) = fields.iter().find(|f| f.key == e.key) {
                out.push(entry_for(f, Some(e)));
                done.insert(e.key.clone());
            }
        }
    }
    for f in fields {
        if !done.contains(&f.key) {
            out.push(entry_for(f, None));
            done.insert(f.key.clone());
        }
    }
    (!out.is_empty()).then_some(out)
}

/// Erledigt ein Todo: Wiederkehrende Todos springen auf den nächsten Termin.
pub fn complete(n: &mut Node, now: NaiveDateTime) {
    let repeat = n.field("repeat").and_then(Repeat::parse);
    if let (Some(rep), Some(when)) = (repeat, n.when()) {
        let after = when.start.max(now.date());
        if let Some(next) = rep.next_after(&when, after) {
            let key = if n.field("date").is_some() { "date" } else { "due" };
            n.set_field(key, Some(when.shift_to(next).format()));
            n.task = Some(Task::Open);
            n.set_field("done", None);
            return;
        }
    }
    n.task = Some(Task::Done);
    n.set_field("done", Some(now.format("%Y-%m-%d %H:%M").to_string()));
}

/// Pfad ohne `\\?\`-Präfix (Windows).
pub fn dunce(p: &Path) -> PathBuf {
    let p = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\")
        && !rest.starts_with("UNC\\")
    {
        return PathBuf::from(rest);
    }
    p
}

#[cfg(test)]
mod tests;
