//! Inline-Syntax in Text und Notizen: Tags (`#a/b`), Links (`[[Seite#^id|Text]]`).
//! Code (Inline-Code und Codeblöcke) wird dabei ausgespart.

use std::ops::Range;

/// Ein Link `[[ziel#anker|text]]` bzw. `![[…]]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkRef {
    /// Byte-Bereich des gesamten Links im Text.
    pub range: Range<usize>,
    pub target: String,
    /// Anker ohne `#`, z. B. `^abc123` oder eine Überschrift.
    pub anchor: Option<String>,
    pub alias: Option<String>,
    pub embed: bool,
}

impl LinkRef {
    /// Schlüssel für die Zuordnung im Frontend: `ziel#anker` (ohne Text).
    pub fn key(&self) -> String {
        match &self.anchor {
            Some(a) => format!("{}#{}", self.target, a),
            None => self.target.clone(),
        }
    }

    /// Verweist der Anker auf einen Knoten (`^id`)?
    pub fn block_id(&self) -> Option<&str> {
        self.anchor.as_deref().and_then(|a| a.strip_prefix('^'))
    }
}

pub fn format_link(target: &str, anchor: Option<&str>, alias: Option<&str>) -> String {
    let mut s = String::from("[[");
    s.push_str(target);
    if let Some(a) = anchor {
        s.push('#');
        s.push_str(a);
    }
    if let Some(al) = alias.filter(|a| !a.is_empty()) {
        s.push('|');
        s.push_str(&al.replace(['[', ']', '|'], ""));
    }
    s.push_str("]]");
    s
}

/// Bereiche mit Code (Codeblöcke und Inline-Code), in denen nichts erkannt wird.
fn code_ranges(text: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    // Codeblöcke zeilenweise
    let mut offset = 0;
    let mut fence: Option<(char, usize, usize)> = None; // (Zeichen, Länge, Start)
    for line in text.split_inclusive('\n') {
        let t = line.trim_start();
        let c = t.chars().next().unwrap_or(' ');
        let n = if c == '`' || c == '~' { t.chars().take_while(|&x| x == c).count() } else { 0 };
        match fence {
            None if n >= 3 => fence = Some((c, n, offset)),
            Some((fc, fnn, start)) if c == fc && n >= fnn && t.trim_end().chars().count() == n => {
                out.push(start..offset + line.len());
                fence = None;
            }
            _ => {}
        }
        offset += line.len();
    }
    if let Some((_, _, start)) = fence {
        out.push(start..text.len());
    }
    // Inline-Code außerhalb von Blöcken
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some(r) = out.iter().find(|r| r.contains(&i)) {
            i = r.end;
            continue;
        }
        if bytes[i] == b'`' {
            let run = bytes[i..].iter().take_while(|&&b| b == b'`').count();
            let ticks = &text[i..i + run];
            if let Some(close) = text[i + run..].find(ticks) {
                let end = i + run + close + run;
                out.push(i..end);
                i = end;
                continue;
            }
            i += run;
            continue;
        }
        i += 1;
    }
    out
}

fn in_ranges(ranges: &[Range<usize>], pos: usize) -> bool {
    ranges.iter().any(|r| r.contains(&pos))
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// Tags mit Byte-Bereich (inklusive `#`), Schreibweise wie im Text.
pub fn tags_with_ranges(text: &str) -> Vec<(Range<usize>, String)> {
    let code = code_ranges(text);
    let links = link_ranges(text);
    let mut out = Vec::new();
    let mut prev: Option<char> = None;
    let mut iter = text.char_indices().peekable();
    while let Some((i, c)) = iter.next() {
        if c == '#'
            && prev.is_none_or(|p| p.is_whitespace() || matches!(p, '(' | ',' | ';' | '"' | '\''))
            && !in_ranges(&code, i)
            && !in_ranges(&links, i)
        {
            let start = i + 1;
            let mut end = start;
            while let Some(&(j, d)) = iter.peek() {
                if is_tag_char(d) {
                    end = j + d.len_utf8();
                    iter.next();
                } else {
                    break;
                }
            }
            let mut tag = &text[start..end];
            while tag.ends_with('/') || tag.ends_with('-') {
                tag = &tag[..tag.len() - 1];
            }
            let valid = !tag.is_empty() && !tag.chars().all(|c| c.is_ascii_digit() || c == '/' || c == '-' || c == '_') && !tag.starts_with('/');
            if valid {
                out.push((i..start + tag.len(), tag.to_string()));
            }
            prev = text[..end].chars().next_back();
            continue;
        }
        prev = Some(c);
    }
    out
}

/// Tags (klein geschrieben, ohne `#`, ohne Dubletten, in Reihenfolge).
pub fn tags(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (_, t) in tags_with_ranges(text) {
        let t = t.to_lowercase();
        if !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

fn link_ranges(text: &str) -> Vec<Range<usize>> {
    find_links(text, &[]).into_iter().map(|l| l.range).collect()
}

fn find_links(text: &str, code: &[Range<usize>]) -> Vec<LinkRef> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(off) = text[i..].find("[[") {
        let start = i + off;
        if in_ranges(code, start) {
            i = start + 2;
            continue;
        }
        let Some(close) = text[start + 2..].find("]]") else { break };
        let inner = &text[start + 2..start + 2 + close];
        if inner.contains('\n') || inner.contains("[[") || inner.trim().is_empty() {
            i = start + 2;
            continue;
        }
        let end = start + 2 + close + 2;
        let embed = start > 0 && text.as_bytes()[start - 1] == b'!';
        let (dest, alias) = match inner.split_once('|') {
            Some((d, a)) => (d, Some(a.trim().to_string())),
            None => (inner, None),
        };
        let (target, anchor) = match dest.split_once('#') {
            Some((t, a)) => (t.trim().to_string(), Some(a.trim().to_string())),
            None => (dest.trim().to_string(), None),
        };
        out.push(LinkRef { range: if embed { start - 1..end } else { start..end }, target, anchor, alias, embed });
        i = end;
    }
    out
}

/// Alle Links außerhalb von Code.
pub fn links(text: &str) -> Vec<LinkRef> {
    find_links(text, &code_ranges(text))
}

/// Ersetzt Links; `f` liefert den neuen Linktext oder `None` (unverändert).
pub fn rewrite_links(text: &str, mut f: impl FnMut(&LinkRef) -> Option<String>) -> String {
    let found = links(text);
    if found.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for l in &found {
        out.push_str(&text[last..l.range.start]);
        match f(l) {
            Some(new) => {
                if l.embed && !new.starts_with('!') {
                    out.push('!');
                }
                out.push_str(&new);
            }
            None => out.push_str(&text[l.range.clone()]),
        }
        last = l.range.end;
    }
    out.push_str(&text[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_tags() {
        assert_eq!(tags("Idee #projekte/sqonto/milestone1 und #Wichtig, #a-b."), vec!["projekte/sqonto/milestone1", "wichtig", "a-b"]);
        assert_eq!(tags("# Überschrift"), Vec::<String>::new());
        assert_eq!(tags("Nummer #1 und #2b"), vec!["2b"]);
        assert_eq!(tags("url https://x.de/#anker und a#b"), Vec::<String>::new());
        assert_eq!(tags("Umlaut #größe/über_alles"), vec!["größe/über_alles"]);
        assert_eq!(tags("(#klammer)"), vec!["klammer"]);
        assert_eq!(tags("#trailing/"), vec!["trailing"]);
    }

    #[test]
    fn tags_skip_code_and_links() {
        assert_eq!(tags("`#nicht` aber #doch"), vec!["doch"]);
        assert_eq!(tags("```c\n#include <x>\n```\n#tag"), vec!["tag"]);
        assert_eq!(tags("[[Seite#^abc123]] #echt"), vec!["echt"]);
        assert_eq!(tags("[[Seite|mit #tag]]"), Vec::<String>::new());
    }

    #[test]
    fn finds_links() {
        let l = links("Mit [[Anna Schmidt]] und [[Projekte/Sqonto#^k3j9a2|Kickoff]] sowie ![[bild.png]]");
        assert_eq!(l.len(), 3);
        assert_eq!(l[0].target, "Anna Schmidt");
        assert_eq!(l[1].target, "Projekte/Sqonto");
        assert_eq!(l[1].block_id(), Some("k3j9a2"));
        assert_eq!(l[1].alias.as_deref(), Some("Kickoff"));
        assert_eq!(l[1].key(), "Projekte/Sqonto#^k3j9a2");
        assert!(l[2].embed);
        assert!(links("`[[kein]]`").is_empty());
        assert!(links("[[]] [[ ]]").is_empty());
    }

    #[test]
    fn rewrites_links() {
        let s = rewrite_links("a [[Alt]] b [[Alt#^x|T]] c ![[Alt]]", |l| {
            (l.target == "Alt").then(|| format_link("Neu", l.anchor.as_deref(), l.alias.as_deref()))
        });
        assert_eq!(s, "a [[Neu]] b [[Neu#^x|T]] c ![[Neu]]");
    }
}
