// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Liest und schreibt Seiten im Outline-Format (siehe `docs/format.md`).
//!
//! Eine Seite besteht aus optionalem Frontmatter, einer freien Notiz und einer
//! Aufzählung von Knoten. Jeder Knoten hat eine Textzeile, Felder
//! (`schlüssel:: wert`), eine Notiz (Markdown) und Kinder. Gelesen wird
//! tolerant (Tabs, andere Einrückungen, Text zwischen Knoten), geschrieben
//! immer in derselben Normalform.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Task {
    Open,
    Doing,
    Done,
    Cancelled,
}

impl Task {
    fn marker(self) -> &'static str {
        match self {
            Task::Open => "[ ]",
            Task::Doing => "[/]",
            Task::Done => "[x]",
            Task::Cancelled => "[-]",
        }
    }

    pub fn is_closed(self) -> bool {
        matches!(self, Task::Done | Task::Cancelled)
    }
}

/// Ein Eintrag im Frontmatter. `raw` ist der Text nach `key:` (inklusive
/// eingerückter Folgezeilen), damit unveränderte Einträge exakt so
/// zurückgeschrieben werden, wie sie gelesen wurden.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FmEntry {
    pub key: String,
    pub raw: String,
}

impl FmEntry {
    /// Wert als Liste (YAML-Flussliste, Blockliste oder Einzelwert).
    pub fn values(&self) -> Vec<String> {
        yaml_values(&self.raw)
    }

    /// Wert als einzelne Zeichenkette (Listen mit `, ` verbunden).
    pub fn value(&self) -> String {
        self.values().join(", ")
    }

    pub fn new(key: &str, value: &str) -> Self {
        FmEntry { key: key.to_string(), raw: format!(" {}", yaml_scalar(value)) }
    }

    pub fn new_list(key: &str, values: &[String]) -> Self {
        let items: Vec<String> = values.iter().map(|v| yaml_scalar(v)).collect();
        FmEntry { key: key.to_string(), raw: format!(" [{}]", items.join(", ")) }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedItem {
    pub text: String,
    pub task: Option<Task>,
    pub id: Option<String>,
    pub fields: Vec<(String, String)>,
    pub body: String,
    pub children: Vec<ParsedItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedPage {
    /// `None`: kein Frontmatter-Block.
    pub frontmatter: Option<Vec<FmEntry>>,
    pub body: String,
    pub items: Vec<ParsedItem>,
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

struct Line<'a> {
    /// Einrückung in Spalten (Tab = bis zur nächsten Vierer-Spalte).
    col: usize,
    /// Zeile ohne führende Leerzeichen.
    rest: &'a str,
    raw: &'a str,
}

impl<'a> Line<'a> {
    fn new(raw: &'a str) -> Self {
        let mut col = 0;
        let mut idx = raw.len();
        for (i, c) in raw.char_indices() {
            match c {
                ' ' => col += 1,
                '\t' => col = (col / 4 + 1) * 4,
                _ => {
                    idx = i;
                    break;
                }
            }
        }
        Line { col, rest: &raw[idx..], raw }
    }

    fn blank(&self) -> bool {
        self.rest.trim().is_empty()
    }

    /// Aufzählungszeichen `- `, `* `, `+ ` (oder allein): Länge des Markers.
    fn bullet(&self) -> Option<usize> {
        let mut chars = self.rest.chars();
        let c = chars.next()?;
        if !matches!(c, '-' | '*' | '+') {
            return None;
        }
        match chars.next() {
            None => Some(1),
            Some(' ') | Some('\t') => Some(1),
            _ => None,
        }
    }
}

/// Entfernt höchstens `cols` Spalten Einrückung.
fn strip_indent(raw: &str, cols: usize) -> String {
    let mut col = 0;
    for (i, c) in raw.char_indices() {
        if col >= cols {
            return raw[i..].to_string();
        }
        match c {
            ' ' => col += 1,
            '\t' => {
                let next = (col / 4 + 1) * 4;
                if next > cols {
                    // Tab ragt über die Grenze: Überhang als Leerzeichen behalten.
                    return format!("{}{}", " ".repeat(next - cols), &raw[i + 1..]);
                }
                col = next;
            }
            _ => return raw[i..].to_string(),
        }
    }
    String::new()
}

/// Öffnender Code-Zaun: (Zeichen, Länge).
fn fence_open(rest: &str) -> Option<(char, usize)> {
    let c = rest.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = rest.chars().take_while(|&x| x == c).count();
    if n < 3 {
        return None;
    }
    // Bei Backticks darf die Info-Zeile keine weiteren Backticks enthalten.
    if c == '`' && rest[n..].contains('`') {
        return None;
    }
    Some((c, n))
}

fn fence_close(rest: &str, open: (char, usize)) -> bool {
    let t = rest.trim_end();
    let n = t.chars().take_while(|&x| x == open.0).count();
    n >= open.1 && t.chars().count() == n
}

/// Feldzeile `schlüssel:: wert`.
pub fn parse_field(rest: &str) -> Option<(String, String)> {
    let pos = rest.find("::")?;
    let key = &rest[..pos];
    if key.is_empty() || !key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return None;
    }
    let value = rest[pos + 2..].trim();
    Some((key.to_string(), value.to_string()))
}

/// Zerlegt die Textzeile eines Knotens (nach dem Aufzählungszeichen).
fn parse_title(s: &str) -> (Option<Task>, String, Option<String>) {
    let mut s = s.trim();
    let mut task = None;
    if s.len() >= 3 && s.starts_with('[') && s.as_bytes()[2] == b']' {
        let t = match s.as_bytes()[1] {
            b' ' => Some(Task::Open),
            b'x' | b'X' => Some(Task::Done),
            b'/' => Some(Task::Doing),
            b'-' => Some(Task::Cancelled),
            _ => None,
        };
        if t.is_some() && (s.len() == 3 || s[3..].starts_with([' ', '\t'])) {
            task = t;
            s = s[3..].trim_start();
        }
    }
    let mut id = None;
    if let Some(pos) = s.rfind('^') {
        let cand = &s[pos + 1..];
        let before_ok = pos == 0 || s[..pos].ends_with([' ', '\t']);
        if before_ok && !cand.is_empty() && cand.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            id = Some(cand.to_string());
            s = s[..pos].trim_end();
        }
    }
    (task, s.to_string(), id)
}

/// Hebt die Maskierung `\- ` einer Notizzeile auf (Gegenstück zu `escape_body_line`).
fn unescape_body_line(line: &str) -> String {
    let t = line.trim_start();
    let lead = &line[..line.len() - t.len()];
    if let Some(after) = t.strip_prefix('\\') {
        let l = Line::new(after);
        if l.col == 0 && l.bullet().is_some() {
            return format!("{lead}{after}");
        }
    }
    line.to_string()
}

struct Parser<'a> {
    lines: Vec<Line<'a>>,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek_nonblank(&self) -> Option<&Line<'a>> {
        self.lines[self.pos..].iter().find(|l| !l.blank())
    }

    fn skip_blank(&mut self) {
        while self.pos < self.lines.len() && self.lines[self.pos].blank() {
            self.pos += 1;
        }
    }

    /// Liest eine Liste von Geschwistern ab Spalte `level`.
    fn list(&mut self, level: usize) -> Vec<ParsedItem> {
        let mut items = Vec::new();
        while let Some(next) = self.peek_nonblank() {
            if next.col < level {
                break;
            }
            self.skip_blank();
            let line = &self.lines[self.pos];
            if line.bullet().is_some() {
                let col = line.col;
                items.push(self.item(col));
            } else if level == 0 {
                // Text in Spalte 0 zwischen Knoten wird zu eigenen Knoten.
                items.push(self.loose_block());
            } else {
                // Eingerückter Text nach Unterknoten gehört zur Notiz des
                // übergeordneten Knotens.
                break;
            }
        }
        items
    }

    /// Freier Textblock bis zur nächsten Leerzeile oder zum nächsten Knoten.
    fn loose_block(&mut self) -> ParsedItem {
        let base = self.lines[self.pos].col;
        let mut lines: Vec<String> = Vec::new();
        let mut fence: Option<(char, usize)> = None;
        while self.pos < self.lines.len() {
            let line = &self.lines[self.pos];
            if fence.is_none() {
                if line.blank() || (line.bullet().is_some() && !lines.is_empty()) {
                    break;
                }
                if let Some(f) = fence_open(line.rest) {
                    fence = Some(f);
                }
            } else if let Some(f) = fence
                && fence_close(line.rest, f)
            {
                fence = None;
            }
            lines.push(strip_indent(line.raw, base));
            self.pos += 1;
            if fence.is_none() && lines.len() > 1 && fence_open(lines[0].trim_start()).is_some() {
                // Codeblock abgeschlossen.
                break;
            }
        }
        if lines.first().is_some_and(|l| fence_open(l.trim_start()).is_some()) {
            ParsedItem { body: lines.join("\n"), ..Default::default() }
        } else {
            let text = lines.first().cloned().unwrap_or_default();
            ParsedItem { text: text.trim().to_string(), body: lines[1.min(lines.len())..].join("\n"), ..Default::default() }
        }
    }

    /// Liest einen Knoten, dessen Aufzählungszeichen in Spalte `col` steht.
    fn item(&mut self, col: usize) -> ParsedItem {
        let line = &self.lines[self.pos];
        let marker = line.bullet().unwrap_or(1);
        let after = line.rest[marker..].trim_start_matches([' ', '\t']);
        let (task, text, id) = parse_title(after);
        let content_col = col + marker + 1;
        self.pos += 1;

        let mut item = ParsedItem { text, task, id, ..Default::default() };
        let mut body: Vec<String> = Vec::new();
        let mut pending_blank = 0usize;
        let mut field_zone = true;
        let mut fence: Option<((char, usize), usize)> = None;
        // `- ```rust`: Der Knoten ist ein Codeblock (Text leer, Code in der Notiz).
        if let Some(f) = fence_open(after) {
            item = ParsedItem::default();
            body.push(after.trim_end().to_string());
            fence = Some((f, content_col));
            field_zone = false;
        }

        while self.pos < self.lines.len() {
            let line = &self.lines[self.pos];
            if let Some((f, fence_col)) = fence {
                // Im Codeblock: alles bis zum schließenden Zaun gehört zur Notiz,
                // solange es nicht weniger eingerückt ist als der Zaun selbst.
                if !line.blank() && line.col < fence_col.min(content_col) && line.col <= col {
                    fence = None;
                    continue;
                }
                for _ in 0..pending_blank {
                    body.push(String::new());
                }
                pending_blank = 0;
                body.push(strip_indent(line.raw, content_col));
                if fence_close(line.rest, f) {
                    fence = None;
                }
                self.pos += 1;
                continue;
            }
            if line.blank() {
                pending_blank += 1;
                field_zone = false;
                self.pos += 1;
                continue;
            }
            if line.col <= col {
                break;
            }
            if line.bullet().is_some() {
                let child_col = line.col;
                let children = self.list(child_col);
                item.children.extend(children);
                pending_blank = 0;
                field_zone = false;
                continue;
            }
            if field_zone
                && body.is_empty()
                && let Some((k, v)) = parse_field(line.rest)
            {
                item.fields.push((k, v));
                self.pos += 1;
                continue;
            }
            field_zone = false;
            if !body.is_empty() {
                for _ in 0..pending_blank {
                    body.push(String::new());
                }
            }
            pending_blank = 0;
            if let Some(f) = fence_open(line.rest) {
                fence = Some((f, line.col));
            }
            body.push(unescape_body_line(&strip_indent(line.raw, content_col)));
            self.pos += 1;
        }
        // Leerzeilen am Ende gehören nicht zur Notiz.
        item.body = body.join("\n");
        item
    }
}

pub fn parse_page(src: &str) -> ParsedPage {
    let src = src.strip_prefix('\u{feff}').unwrap_or(src);
    let src = src.replace("\r\n", "\n");
    let all: Vec<&str> = src.split('\n').collect();
    let mut start = 0;
    let mut frontmatter = None;
    if all.first().is_some_and(|l| l.trim_end() == "---")
        && let Some(end) = all.iter().skip(1).position(|l| matches!(l.trim_end(), "---" | "..."))
    {
        frontmatter = Some(parse_frontmatter(&all[1..end + 1]));
        start = end + 2;
    }
    let lines: Vec<Line> = all[start..].iter().map(|l| Line::new(l)).collect();

    // Notiz der Seite: alles vor dem ersten Knoten in Spalte 0.
    let mut body_end = lines.len();
    let mut fence = None;
    for (i, l) in lines.iter().enumerate() {
        match fence {
            Some(f) => {
                if fence_close(l.rest, f) {
                    fence = None;
                }
            }
            None => {
                if l.col == 0 && l.bullet().is_some() {
                    body_end = i;
                    break;
                }
                fence = fence_open(l.rest);
            }
        }
    }
    let body = lines[..body_end].iter().map(|l| l.raw).collect::<Vec<_>>().join("\n").trim_matches('\n').to_string();
    let mut parser = Parser { lines: lines.into_iter().skip(body_end).collect(), pos: 0 };
    let items = parser.list(0);
    ParsedPage { frontmatter, body: trim_trailing_ws_lines(&body), items }
}

fn trim_trailing_ws_lines(s: &str) -> String {
    s.trim_end().to_string()
}

fn parse_frontmatter(lines: &[&str]) -> Vec<FmEntry> {
    let mut entries: Vec<FmEntry> = Vec::new();
    for line in lines {
        let top = !line.starts_with([' ', '\t']) && !line.starts_with("- ") && !line.trim().is_empty();
        if top
            && !line.starts_with('#')
            && let Some(pos) = line.find(':')
        {
            let key = line[..pos].trim();
            if !key.is_empty() && !key.contains(' ') || key.starts_with('"') {
                entries.push(FmEntry { key: key.trim_matches('"').to_string(), raw: line[pos + 1..].to_string() });
                continue;
            }
        }
        match entries.last_mut() {
            Some(e) if !top || line.trim().is_empty() => {
                e.raw.push('\n');
                e.raw.push_str(line);
            }
            _ => entries.push(FmEntry { key: String::new(), raw: line.to_string() }),
        }
    }
    entries
}

/// Werte eines Frontmatter-Eintrags (vereinfachtes YAML).
fn yaml_values(raw: &str) -> Vec<String> {
    let first = raw.lines().next().unwrap_or("").trim();
    let unquote = |s: &str| -> String {
        let s = s.trim();
        if s.len() >= 2 && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\''))) {
            s[1..s.len() - 1].replace("\\\"", "\"").replace("''", "'")
        } else {
            s.to_string()
        }
    };
    if first.starts_with('[') && first.ends_with(']') {
        return split_flow(&first[1..first.len() - 1]).into_iter().map(|v| unquote(&v)).filter(|v| !v.is_empty()).collect();
    }
    if first.is_empty() {
        return raw
            .lines()
            .skip(1)
            .filter_map(|l| l.trim().strip_prefix("- ").or_else(|| (l.trim() == "-").then_some("")))
            .map(unquote)
            .filter(|v| !v.is_empty())
            .collect();
    }
    let joined: Vec<&str> = raw.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    vec![unquote(&joined.join(" "))]
}

fn split_flow(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in s.chars() {
        match quote {
            Some(q) if c == q => {
                quote = None;
                cur.push(c);
            }
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                cur.push(c);
            }
            None if c == ',' => out.push(std::mem::take(&mut cur).trim().to_string()),
            None => cur.push(c),
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

fn yaml_scalar(v: &str) -> String {
    let needs_quotes = v.is_empty()
        || v.starts_with([' ', '[', '{', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@', '`', '-', '?'])
        || v.ends_with(' ')
        || v.contains(": ")
        || v.contains(" #")
        || v.contains(',')
        || matches!(v.to_ascii_lowercase().as_str(), "true" | "false" | "null" | "yes" | "no" | "~");
    if needs_quotes { format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\"")) } else { v.to_string() }
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

/// Maskiert Notizzeilen, die beim Lesen sonst als Knoten erkannt würden.
fn escape_body_line(line: &str) -> String {
    let l = Line::new(line);
    if l.bullet().is_some() {
        let lead = &line[..line.len() - l.rest.len()];
        return format!("{lead}\\{}", l.rest);
    }
    line.to_string()
}

/// Ist der Knoten ein reiner Codeblock (leerer Text, Notiz beginnt mit Zaun)?
pub fn is_code_item(item: &ParsedItem) -> bool {
    let body = item.body.trim_start_matches('\n');
    item.text.trim().is_empty()
        && item.task.is_none()
        && item.id.is_none()
        && item.fields.is_empty()
        && body.lines().next().is_some_and(|l| !l.starts_with([' ', '\t']) && fence_open(l).is_some())
}

/// Schreibt Notizzeilen eingerückt; Aufzählungszeichen außerhalb von Code werden maskiert.
fn write_body_lines<'a>(out: &mut String, content: &str, lines: impl Iterator<Item = &'a str>, mut fence: Option<(char, usize)>) {
    for line in lines {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            out.push('\n');
            continue;
        }
        let rest = line.trim_start();
        let written = match fence {
            Some(f) => {
                if fence_close(rest, f) {
                    fence = None;
                }
                line.to_string()
            }
            None => {
                fence = fence_open(rest);
                if fence.is_some() { line.to_string() } else { escape_body_line(line) }
            }
        };
        out.push_str(content);
        out.push_str(&written);
        out.push('\n');
    }
}

pub fn write_item(out: &mut String, item: &ParsedItem, depth: usize) {
    let indent = "  ".repeat(depth);
    if is_code_item(item) {
        // `- ```rust` direkt am Aufzählungspunkt, der Code eingerückt darunter.
        let body = item.body.trim_matches('\n');
        let mut lines = body.split('\n');
        let first = lines.next().unwrap_or("").trim_end();
        out.push_str(&indent);
        out.push_str("- ");
        out.push_str(first);
        out.push('\n');
        write_body_lines(out, &format!("{indent}  "), lines, fence_open(first));
        for child in &item.children {
            write_item(out, child, depth + 1);
        }
        return;
    }
    out.push_str(&indent);
    out.push('-');
    if let Some(t) = item.task {
        out.push(' ');
        out.push_str(t.marker());
    }
    let text = item.text.replace(['\n', '\r'], " ");
    if !text.is_empty() {
        out.push(' ');
        out.push_str(&text);
    }
    if let Some(id) = &item.id {
        out.push_str(" ^");
        out.push_str(id);
    }
    out.push('\n');
    let content = format!("{indent}  ");
    for (k, v) in &item.fields {
        out.push_str(&content);
        out.push_str(k);
        out.push_str("::");
        if !v.is_empty() {
            out.push(' ');
            out.push_str(&v.replace(['\n', '\r'], " "));
        }
        out.push('\n');
    }
    let body = item.body.trim_matches('\n');
    if !body.is_empty() {
        // Sähe die erste Notizzeile wie ein Feld aus, trennt eine Leerzeile.
        let first = body.lines().next().unwrap_or("");
        if parse_field(first.trim_start()).is_some() {
            out.push('\n');
        }
        write_body_lines(out, &content, body.split('\n'), None);
    }
    for child in &item.children {
        write_item(out, child, depth + 1);
    }
}

pub fn write_page(page: &ParsedPage) -> String {
    let mut out = String::new();
    if let Some(fm) = &page.frontmatter {
        out.push_str("---\n");
        for e in fm {
            if e.key.is_empty() {
                out.push_str(&e.raw);
            } else {
                out.push_str(&e.key);
                out.push(':');
                out.push_str(&e.raw);
            }
            out.push('\n');
        }
        out.push_str("---\n");
    }
    let body = page.body.trim_matches('\n');
    if !body.is_empty() {
        if page.frontmatter.is_some() {
            out.push('\n');
        }
        out.push_str(body);
        out.push('\n');
    }
    if !page.items.is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        for item in &page.items {
            write_item(&mut out, item, 0);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(text: &str) -> ParsedItem {
        ParsedItem { text: text.into(), ..Default::default() }
    }

    #[test]
    fn simple_outline() {
        let p = parse_page("- A\n  - A1\n  - A2\n    - A2a\n- B\n");
        assert_eq!(p.items.len(), 2);
        assert_eq!(p.items[0].children.len(), 2);
        assert_eq!(p.items[0].children[1].children[0].text, "A2a");
        assert_eq!(write_page(&p), "- A\n  - A1\n  - A2\n    - A2a\n- B\n");
    }

    #[test]
    fn task_fields_body_id() {
        let src = "- [ ] Bericht #arbeit ^k3j9a2\n  date:: 2026-10-30\n  remind:: 1h\n  Notiz Zeile 1\n\n  Absatz 2\n  - Kind\n";
        let p = parse_page(src);
        let it = &p.items[0];
        assert_eq!(it.task, Some(Task::Open));
        assert_eq!(it.text, "Bericht #arbeit");
        assert_eq!(it.id.as_deref(), Some("k3j9a2"));
        assert_eq!(it.fields, vec![("date".into(), "2026-10-30".into()), ("remind".into(), "1h".into())]);
        assert_eq!(it.body, "Notiz Zeile 1\n\nAbsatz 2");
        assert_eq!(it.children[0].text, "Kind");
        assert_eq!(write_page(&p), src);
    }

    #[test]
    fn task_states() {
        let p = parse_page("- [x] a\n- [/] b\n- [-] c\n- [X] d\n- [ ]\n- [link](x)\n");
        let t: Vec<_> = p.items.iter().map(|i| i.task).collect();
        assert_eq!(t, vec![Some(Task::Done), Some(Task::Doing), Some(Task::Cancelled), Some(Task::Done), Some(Task::Open), None]);
        assert_eq!(p.items[5].text, "[link](x)");
        assert_eq!(p.items[4].text, "");
    }

    #[test]
    fn code_block_with_bullets_inside() {
        let src = "- Snippet\n  ```md\n  - kein Kind\n  # keine Überschrift\n  ```\n  - echtes Kind\n";
        let p = parse_page(src);
        let it = &p.items[0];
        assert_eq!(it.body, "```md\n- kein Kind\n# keine Überschrift\n```");
        assert_eq!(it.children.len(), 1);
        assert_eq!(write_page(&p), src);
    }

    #[test]
    fn code_block_with_blank_lines_and_deeper_indent() {
        let src = "- A\n  ```rust\n  fn main() {\n\n      let x = 1;\n  }\n  ```\n- B\n";
        let p = parse_page(src);
        assert_eq!(p.items[0].body, "```rust\nfn main() {\n\n    let x = 1;\n}\n```");
        assert_eq!(write_page(&p), src);
    }

    #[test]
    fn code_items_start_at_the_bullet() {
        let src = "- ```rust\n  fn main() {\n      let x = 1;\n\n      // - kein Kind\n  }\n  ```\n  - Kind\n- danach\n";
        let p = parse_page(src);
        let it = &p.items[0];
        assert_eq!(it.text, "");
        assert_eq!(it.body, "```rust\nfn main() {\n    let x = 1;\n\n    // - kein Kind\n}\n```");
        assert_eq!(it.children.len(), 1);
        assert_eq!(p.items[1].text, "danach");
        assert_eq!(write_page(&p), src);
    }

    #[test]
    fn empty_item_with_code_body_is_written_compactly() {
        let it = ParsedItem { body: "```\nint main() {\n  return 0;\n}\n```".into(), ..Default::default() };
        let out = write_page(&ParsedPage { items: vec![it.clone()], ..Default::default() });
        assert_eq!(out, "- ```\n  int main() {\n    return 0;\n  }\n  ```\n");
        assert_eq!(parse_page(&out).items[0], it);
        // Alte Form (leere Zeile, Code darunter) wird beim Schreiben kompakt.
        assert_eq!(write_page(&parse_page("-\n  ```c\n  x\n  ```\n")), "- ```c\n  x\n  ```\n");
        // Mit Text, Kästchen oder ID bleibt der Code in der Notiz.
        let titled = "- Titel\n  ```c\n  x\n  ```\n";
        assert_eq!(write_page(&parse_page(titled)), titled);
        let pinned = "- ^abcdef\n  ```c\n  x\n  ```\n";
        assert_eq!(write_page(&parse_page(pinned)), pinned);
    }

    #[test]
    fn inline_code_title_is_not_a_code_item() {
        let p = parse_page("- ```a``` b\n");
        assert_eq!(p.items[0].text, "```a``` b");
        assert_eq!(p.items[0].body, "");
    }

    #[test]
    fn body_bullets_are_escaped() {
        let mut it = item("A");
        it.body = "Liste:\n- eins\n- zwei\n  * drei".into();
        let page = ParsedPage { items: vec![it.clone()], ..Default::default() };
        let out = write_page(&page);
        assert_eq!(out, "- A\n  Liste:\n  \\- eins\n  \\- zwei\n    \\* drei\n");
        let back = parse_page(&out);
        assert_eq!(back.items[0].body, it.body);
        assert!(back.items[0].children.is_empty());
    }

    #[test]
    fn body_looking_like_field() {
        let mut it = item("A");
        it.body = "Hinweis:: kein Feld".into();
        let page = ParsedPage { items: vec![it.clone()], ..Default::default() };
        let back = parse_page(&write_page(&page));
        assert!(back.items[0].fields.is_empty());
        assert_eq!(back.items[0].body, "Hinweis:: kein Feld");
    }

    #[test]
    fn frontmatter_and_page_body() {
        let src = "---\ntags: [person, kunde]\nemail: anna@example.com\naliases:\n  - Anni\n---\n\nFreier Text.\n\nZweiter Absatz.\n\n- Erster Knoten\n";
        let p = parse_page(src);
        let fm = p.frontmatter.as_ref().unwrap();
        assert_eq!(fm[0].key, "tags");
        assert_eq!(fm[0].values(), vec!["person", "kunde"]);
        assert_eq!(fm[1].value(), "anna@example.com");
        assert_eq!(fm[2].values(), vec!["Anni"]);
        assert_eq!(p.body, "Freier Text.\n\nZweiter Absatz.");
        assert_eq!(p.items[0].text, "Erster Knoten");
        assert_eq!(write_page(&p), src);
    }

    #[test]
    fn tabs_and_four_spaces() {
        let p = parse_page("- A\n\t- B\n\t\tkey:: v\n\t\t- C\n- D\n    - E\n");
        assert_eq!(p.items[0].children[0].text, "B");
        assert_eq!(p.items[0].children[0].fields[0], ("key".into(), "v".into()));
        assert_eq!(p.items[0].children[0].children[0].text, "C");
        assert_eq!(p.items[1].children[0].text, "E");
    }

    #[test]
    fn loose_text_between_items() {
        let p = parse_page("# Titel\n\nEinleitung\n\n- A\n\nAbsatz dazwischen\nzweite Zeile\n\n## Abschnitt\n- B\n");
        assert_eq!(p.body, "# Titel\n\nEinleitung");
        let texts: Vec<_> = p.items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(texts, vec!["A", "Absatz dazwischen", "## Abschnitt", "B"]);
        assert_eq!(p.items[1].body, "zweite Zeile");
    }

    #[test]
    fn text_after_children_goes_to_parent_body() {
        let p = parse_page("- A\n  - Kind\n  Nachtrag\n- B\n");
        assert_eq!(p.items[0].children.len(), 1);
        assert_eq!(p.items[0].children[0].body, "");
        assert_eq!(p.items[0].body, "Nachtrag");
        assert_eq!(p.items[1].text, "B");
    }

    #[test]
    fn blank_lines_between_items_ignored() {
        let p = parse_page("- A\n\n- B\n\n\n  - B1\n");
        assert_eq!(p.items.len(), 2);
        assert_eq!(p.items[1].children[0].text, "B1");
        assert_eq!(p.items[0].body, "");
    }

    #[test]
    fn crlf_and_bom() {
        let p = parse_page("\u{feff}- A\r\n  - B\r\n");
        assert_eq!(p.items[0].children[0].text, "B");
    }

    #[test]
    fn id_only_after_space() {
        let (_, text, id) = parse_title("Formel x^2");
        assert_eq!(text, "Formel x^2");
        assert_eq!(id, None);
        let (_, text, id) = parse_title("^abc123");
        assert_eq!(text, "");
        assert_eq!(id.as_deref(), Some("abc123"));
    }

    #[test]
    fn horizontal_rule_and_bold_are_not_bullets() {
        let p = parse_page("Text\n\n---\n\n**fett**\n\n- A\n");
        assert_eq!(p.body, "Text\n\n---\n\n**fett**");
        assert_eq!(p.items.len(), 1);
    }

    #[test]
    fn empty_bullet() {
        let p = parse_page("-\n- B\n");
        assert_eq!(p.items.len(), 2);
        assert_eq!(write_page(&p), "-\n- B\n");
    }

    #[test]
    fn heading_items_and_obsidian_task_emoji_kept() {
        let src = "- ## Abschnitt\n  - [ ] Aufgabe 📅 2026-10-30\n";
        assert_eq!(write_page(&parse_page(src)), src);
    }

    #[test]
    fn frontmatter_writers() {
        assert_eq!(FmEntry::new("email", "a@b.de").raw, " a@b.de");
        assert_eq!(FmEntry::new("titel", "Ja: nein").raw, " \"Ja: nein\"");
        assert_eq!(FmEntry::new_list("tags", &["person".into(), "a/b".into()]).raw, " [person, a/b]");
        let e = FmEntry::new("x", "say \"hi\", ok");
        assert_eq!(e.value(), "say \"hi\", ok");
    }

    #[test]
    fn roundtrip_complex() {
        let src = "---\ntitle: X\n---\n\nSeitennotiz mit `code`.\n\n- [ ] Todo ^aaaaaa\n  date:: 2026-10-27 14:00-15:00\n  repeat:: weekly\n  Notiz\n  > Zitat\n\n  1. eins\n  2. zwei\n  - Kind ^bbbbbb\n    - Enkel\n      ```js\n      const a = 1;\n      ```\n- Zweiter\n";
        let p = parse_page(src);
        assert_eq!(write_page(&p), src);
    }
}
