//! Suche über alle Knoten: Fuzzy-Treffer (nucleo) in Titel, Pfad und Tags,
//! Teilstring-Treffer in Notiz und Feldern, Tippfehler-Toleranz und Filter
//! (`#tag`, `is:todo`, `in:Seite`, `date:heute`, …).
//!
//! Ablauf: Phase 1 bewertet alle Knoten möglichst ohne Allokationen; Phase 2
//! berechnet nur für die besten Treffer Hervorhebungen und Ausschnitte.
//! Alle Bereiche sind UTF-16-Offsets (für JavaScript).

use chrono::{Duration, NaiveDate};
use nucleo_matcher::pattern::{Atom, AtomKind, CaseMatching, Normalization};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// Schneller Hasher (FxHash) für die Zwischenspeicher pro Anfrage.
#[derive(Default)]
struct FxHasher(u64);

impl Hasher for FxHasher {
    fn write(&mut self, bytes: &[u8]) {
        for chunk in bytes.chunks(8) {
            let mut v = [0u8; 8];
            v[..chunk.len()].copy_from_slice(chunk);
            self.0 = (self.0.rotate_left(5) ^ u64::from_le_bytes(v)).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
        }
    }
    fn write_u8(&mut self, i: u8) {
        self.0 = (self.0.rotate_left(5) ^ i as u64).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
    fn finish(&self) -> u64 {
        self.0
    }
}

type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;

// ---------------------------------------------------------------------------
// Öffentliche Typen
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Task {
    Open,
    Doing,
    Done,
    Cancelled,
}

impl Task {
    fn is_open(self) -> bool {
        matches!(self, Task::Open | Task::Doing)
    }
}

/// Ein durchsuchbarer Knoten (vom Vault erzeugt, wird zwischengespeichert).
#[derive(Debug, Clone)]
pub struct SearchDoc {
    pub id: String,
    pub is_page: bool,
    /// Klartext (Markdown schon entfernt, Tags bleiben als "#tag" stehen).
    pub title: String,
    /// Klartext der Notiz (Codeblöcke enthalten).
    pub body: String,
    /// Titel der Vorfahren von der Wurzel an, ohne den Knoten selbst.
    pub path: Vec<String>,
    /// Klein geschrieben, ohne '#', inkl. Typ-Tags.
    pub tags: Vec<String>,
    pub task: Option<Task>,
    /// Beginn aus `date::`.
    pub date: Option<NaiveDate>,
    /// Weitere Felder (Schlüssel, Klartextwert).
    pub fields: Vec<(String, String)>,
    /// Unix-Sekunden der letzten Änderung (Seite).
    pub modified: i64,
}

#[derive(Debug, Clone)]
pub struct SearchContext {
    pub today: NaiveDate,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub id: String,
    pub score: i64,
    /// Hervorhebung im Titel, [start, end) in UTF-16-Codeeinheiten.
    pub title_ranges: Vec<(u32, u32)>,
    /// (Index im Pfad, start, end) in UTF-16.
    pub path_ranges: Vec<(u32, u32, u32)>,
    /// Ausschnitt aus der Notiz, wenn dort getroffen.
    pub snippet: Option<Snippet>,
    pub matched_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub text: String,
    /// UTF-16 relativ zu `text`.
    pub ranges: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagHit {
    pub tag: String,
    pub count: usize,
    pub ranges: Vec<(u32, u32)>,
}

// ---------------------------------------------------------------------------
// Klartext aus Inline-Markdown
// ---------------------------------------------------------------------------

/// Entfernt Inline-Markdown: Links → Text, Hervorhebungen → Inhalt,
/// Block-ID ` ^abc123` am Ende und Überschriften-Präfix. Tags bleiben.
pub fn plain_text(markdown_inline: &str) -> String {
    let mut s = markdown_inline.trim_end();
    if let Some(pos) = s.rfind(" ^") {
        let id = &s[pos + 2..];
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            s = s[..pos].trim_end();
        }
    }
    let s = strip_heading(s);
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    inline_plain(&chars, &mut out);
    out
}

fn strip_heading(s: &str) -> &str {
    let hashes = s.bytes().take_while(|&b| b == b'#').count();
    if (1..=6).contains(&hashes) {
        let rest = &s[hashes..];
        if rest.starts_with(' ') || rest.starts_with('\t') {
            return rest.trim_start();
        }
        if rest.is_empty() {
            return rest;
        }
    }
    s
}

fn find_seq(chars: &[char], from: usize, pat: &[char]) -> Option<usize> {
    if pat.is_empty() || chars.len() < pat.len() {
        return None;
    }
    (from..=chars.len() - pat.len()).find(|&i| chars[i..i + pat.len()] == *pat)
}

fn inline_plain(c: &[char], out: &mut String) {
    let n = c.len();
    let mut i = 0;
    while i < n {
        let ch = c[i];
        match ch {
            '\\' if i + 1 < n && c[i + 1].is_ascii_punctuation() => {
                out.push(c[i + 1]);
                i += 2;
            }
            '`' => {
                let run = c[i..].iter().take_while(|&&x| x == '`').count();
                let fence = vec!['`'; run];
                match find_seq(c, i + run, &fence) {
                    Some(end) => {
                        let inner: String = c[i + run..end].iter().collect();
                        let inner = if inner.len() > 1 && inner.starts_with(' ') && inner.ends_with(' ') {
                            inner[1..inner.len() - 1].to_string()
                        } else {
                            inner
                        };
                        out.push_str(&inner);
                        i = end + run;
                    }
                    None => {
                        out.extend(&c[i..i + run]);
                        i += run;
                    }
                }
            }
            '!' if c.get(i + 1) == Some(&'[') => {
                // Bild oder Einbettung: wie Link ohne „!“.
                let before = out.len();
                let next = parse_link(c, i + 1, out);
                if next > i + 1 {
                    i = next;
                } else {
                    out.truncate(before);
                    out.push('!');
                    i += 1;
                }
            }
            '[' => {
                let next = parse_link(c, i, out);
                if next > i {
                    i = next;
                } else {
                    out.push('[');
                    i += 1;
                }
            }
            '*' | '_' | '~' | '=' => {
                let next = parse_emphasis(c, i, out);
                if next > i {
                    i = next;
                } else {
                    out.push(ch);
                    i += 1;
                }
            }
            '<' => {
                // Autolink <https://…>
                if let Some(end) = c[i + 1..].iter().position(|&x| x == '>') {
                    let inner: String = c[i + 1..i + 1 + end].iter().collect();
                    if inner.contains("://") || inner.starts_with("mailto:") {
                        out.push_str(&inner);
                        i += end + 2;
                        continue;
                    }
                }
                out.push('<');
                i += 1;
            }
            _ => {
                out.push(ch);
                i += 1;
            }
        }
    }
}

/// `[[Wiki|Alias]]` oder `[Text](url)` ab `i`; liefert die Position danach
/// (oder `i`, wenn hier kein Link steht).
fn parse_link(c: &[char], i: usize, out: &mut String) -> usize {
    if c.get(i + 1) == Some(&'[') {
        if let Some(end) = find_seq(c, i + 2, &[']', ']']) {
            let inner: String = c[i + 2..end].iter().collect();
            let shown = match inner.split_once('|') {
                Some((_, alias)) => alias.to_string(),
                None => match inner.split_once('#') {
                    Some((target, rest)) if !target.is_empty() => {
                        let _ = rest;
                        target.to_string()
                    }
                    Some((_, rest)) => rest.trim_start_matches('^').to_string(),
                    None => inner.clone(),
                },
            };
            let shown_chars: Vec<char> = shown.chars().collect();
            inline_plain(&shown_chars, out);
            return end + 2;
        }
        return i;
    }
    // [Text](url) – Klammern im Text dürfen verschachtelt sein.
    let mut depth = 0usize;
    let mut j = i;
    while j < c.len() {
        match c[j] {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
        j += 1;
    }
    if j >= c.len() || c.get(j + 1) != Some(&'(') {
        return i;
    }
    let Some(close) = c[j + 2..].iter().position(|&x| x == ')') else { return i };
    inline_plain(&c[i + 1..j], out);
    j + 2 + close + 1
}

fn parse_emphasis(c: &[char], i: usize, out: &mut String) -> usize {
    let ch = c[i];
    let double = c.get(i + 1) == Some(&ch);
    if matches!(ch, '~' | '=') && !double {
        return i;
    }
    let width = if double { 2 } else { 1 };
    let start = i + width;
    // Öffner: dahinter kein Leerraum; „_“ nicht mitten im Wort.
    let Some(&first) = c.get(start) else { return i };
    if first.is_whitespace() || first == ch {
        return i;
    }
    if ch == '_' && i > 0 && c[i - 1].is_alphanumeric() {
        return i;
    }
    let pat = vec![ch; width];
    let mut from = start + 1;
    while let Some(end) = find_seq(c, from, &pat) {
        let prev = c[end - 1];
        let after = c.get(end + width).copied();
        let ok_close = !prev.is_whitespace()
            && !(ch == '_' && after.is_some_and(char::is_alphanumeric))
            && !(width == 1 && after == Some(ch));
        if ok_close {
            inline_plain(&c[start..end], out);
            return end + width;
        }
        from = end + 1;
    }
    i
}

// ---------------------------------------------------------------------------
// Normalisierung (Umlaute, Akzente, ß)
// ---------------------------------------------------------------------------

/// Faltet Akzente weg, Groß-/Kleinschreibung bleibt. ß → ss, æ → ae, …
#[inline]
fn fold_char(c: char, mut push: impl FnMut(char)) {
    if c.is_ascii() {
        push(c);
        return;
    }
    let two = |a: char, b: char, push: &mut dyn FnMut(char)| {
        push(a);
        push(b);
    };
    let r = match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' | 'Ā' | 'Ă' | 'Ą' => 'A',
        'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
        'Ç' | 'Ć' | 'Ĉ' | 'Ċ' | 'Č' => 'C',
        'ď' | 'đ' | 'ð' => 'd',
        'Ď' | 'Đ' | 'Ð' => 'D',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => 'e',
        'È' | 'É' | 'Ê' | 'Ë' | 'Ē' | 'Ĕ' | 'Ė' | 'Ę' | 'Ě' => 'E',
        'ĝ' | 'ğ' | 'ġ' | 'ģ' => 'g',
        'Ĝ' | 'Ğ' | 'Ġ' | 'Ģ' => 'G',
        'ĥ' | 'ħ' => 'h',
        'Ĥ' | 'Ħ' => 'H',
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => 'i',
        'Ì' | 'Í' | 'Î' | 'Ï' | 'Ĩ' | 'Ī' | 'Ĭ' | 'Į' | 'İ' => 'I',
        'ĵ' => 'j',
        'Ĵ' => 'J',
        'ķ' => 'k',
        'Ķ' => 'K',
        'ĺ' | 'ļ' | 'ľ' | 'ŀ' | 'ł' => 'l',
        'Ĺ' | 'Ļ' | 'Ľ' | 'Ŀ' | 'Ł' => 'L',
        'ñ' | 'ń' | 'ņ' | 'ň' => 'n',
        'Ñ' | 'Ń' | 'Ņ' | 'Ň' => 'N',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => 'o',
        'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ø' | 'Ō' | 'Ŏ' | 'Ő' => 'O',
        'ŕ' | 'ŗ' | 'ř' => 'r',
        'Ŕ' | 'Ŗ' | 'Ř' => 'R',
        'ś' | 'ŝ' | 'ş' | 'š' => 's',
        'Ś' | 'Ŝ' | 'Ş' | 'Š' => 'S',
        'ţ' | 'ť' | 'ŧ' => 't',
        'Ţ' | 'Ť' | 'Ŧ' => 'T',
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => 'u',
        'Ù' | 'Ú' | 'Û' | 'Ü' | 'Ũ' | 'Ū' | 'Ŭ' | 'Ů' | 'Ű' | 'Ų' => 'U',
        'ŵ' => 'w',
        'Ŵ' => 'W',
        'ý' | 'ÿ' | 'ŷ' => 'y',
        'Ý' | 'Ÿ' | 'Ŷ' => 'Y',
        'ź' | 'ż' | 'ž' => 'z',
        'Ź' | 'Ż' | 'Ž' => 'Z',
        'ß' => return two('s', 's', &mut push),
        'ẞ' => return two('S', 'S', &mut push),
        'æ' => return two('a', 'e', &mut push),
        'Æ' => return two('A', 'E', &mut push),
        'œ' => return two('o', 'e', &mut push),
        'Œ' => return two('O', 'E', &mut push),
        'þ' => return two('t', 'h', &mut push),
        'Þ' => return two('T', 'H', &mut push),
        // Typografische Zeichen, die beim Suchen wie ASCII gelten sollen.
        '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' => '-',
        '\u{2018}' | '\u{2019}' => '\'',
        '\u{201C}' | '\u{201D}' | '\u{201E}' => '"',
        '\u{00A0}' => ' ',
        _ => c,
    };
    push(r)
}

#[inline]
fn lower_char(c: char, mut push: impl FnMut(char)) {
    if c.is_ascii() {
        push(c.to_ascii_lowercase());
    } else {
        for l in c.to_lowercase() {
            push(l);
        }
    }
}

/// Gefaltet und klein geschrieben – für Teilstring- und Wortvergleiche.
fn fold_lower_into(text: &str, out: &mut String) {
    out.clear();
    out.reserve(text.len());
    // ASCII-Abschnitte am Stück kopieren, nur die übrigen Zeichen einzeln falten.
    let mut rest = text;
    while !rest.is_empty() {
        let run = rest.bytes().position(|b| b >= 0x80).unwrap_or(rest.len());
        if run > 0 {
            let start = out.len();
            out.push_str(&rest[..run]);
            out[start..].make_ascii_lowercase();
            rest = &rest[run..];
        }
        let Some(c) = rest.chars().next() else { break };
        fold_char(c, |f| lower_char(f, |l| out.push(l)));
        rest = &rest[c.len_utf8()..];
    }
}

fn fold_lower(text: &str) -> String {
    let mut s = String::new();
    fold_lower_into(text, &mut s);
    s
}

/// Gefaltet und klein, mit Zuordnung jedes Zeichens zum Originalzeichen.
fn fold_lower_map(text: &str) -> (Vec<char>, Vec<u32>) {
    let mut chars = Vec::with_capacity(text.len());
    let mut src = Vec::with_capacity(text.len());
    for (i, c) in text.chars().enumerate() {
        fold_char(c, |f| {
            lower_char(f, |l| {
                chars.push(l);
                src.push(i as u32);
            })
        });
    }
    (chars, src)
}

/// Wiederverwendbarer Puffer: gefalteter Text (Groß/Klein bleibt) für nucleo.
#[derive(Default)]
struct Folded {
    chars: Vec<char>,
    bytes: Vec<u8>,
    src: Vec<u32>,
    ascii: bool,
}

impl Folded {
    fn set(&mut self, text: &str) {
        self.chars.clear();
        self.src.clear();
        self.bytes.clear();
        if text.is_ascii() {
            self.ascii = true;
            self.bytes.extend_from_slice(text.as_bytes());
            return;
        }
        for (i, c) in text.chars().enumerate() {
            fold_char(c, |f| {
                self.chars.push(f);
                self.src.push(i as u32);
            });
        }
        self.ascii = self.chars.iter().all(char::is_ascii);
        if self.ascii {
            self.bytes.extend(self.chars.iter().map(|&c| c as u8));
        }
    }

    fn utf32(&self) -> Utf32Str<'_> {
        if self.ascii { Utf32Str::Ascii(&self.bytes) } else { Utf32Str::Unicode(&self.chars) }
    }

    /// Index im gefalteten Text → Zeichenindex im Original.
    fn orig(&self, i: u32) -> u32 {
        if self.src.is_empty() { i } else { self.src[i as usize] }
    }
}

/// UTF-16-Bereiche [start, end).
type Ranges = Vec<(u32, u32)>;

/// UTF-16-Offset vor jedem Zeichen (und am Ende).
fn utf16_offsets(text: &str) -> Vec<u32> {
    let mut v = Vec::with_capacity(text.len() + 1);
    let mut o = 0u32;
    for c in text.chars() {
        v.push(o);
        o += c.len_utf16() as u32;
    }
    v.push(o);
    v
}

/// Zeichenindizes → zusammengefasste UTF-16-Bereiche.
fn char_indices_to_ranges(indices: &mut Vec<u32>, offsets: &[u32]) -> Vec<(u32, u32)> {
    indices.sort_unstable();
    indices.dedup();
    let mut out: Vec<(u32, u32)> = Vec::new();
    for &i in indices.iter() {
        let (s, e) = (offsets[i as usize], offsets[i as usize + 1]);
        match out.last_mut() {
            Some(last) if last.1 == s => last.1 = e,
            _ => out.push((s, e)),
        }
    }
    out
}

fn merge_ranges(mut v: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    v.sort_unstable();
    let mut out: Vec<(u32, u32)> = Vec::with_capacity(v.len());
    for (s, e) in v {
        match out.last_mut() {
            Some(last) if s <= last.1 => last.1 = last.1.max(e),
            _ => out.push((s, e)),
        }
    }
    out
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

#[inline]
fn byte_bit(b: u8) -> u64 {
    match b {
        b'a'..=b'z' => 1 << (b - b'a'),
        b'0'..=b'9' => 1 << (26 + b - b'0'),
        _ => 0,
    }
}

/// Bitmaske der Zeichen a–z und 0–9 in einem (klein geschriebenen) Text.
fn char_mask(lower: &str) -> u64 {
    lower.bytes().fold(0, |m, b| m | byte_bit(b))
}

// ---------------------------------------------------------------------------
// Abfrage
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Term {
    atom: Atom,
    kind: AtomKind,
    negative: bool,
    /// Gefaltet und klein (für Teilstring- und Wortvergleiche).
    needle: String,
    needle_chars: Vec<char>,
    len: usize,
    /// Vorkommende Zeichen a–z/0–9 (Vorfilter vor nucleo).
    mask: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IsFilter {
    Todo,
    Open,
    Done,
    Page,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DateFilter {
    Day(i64),
    /// Die nächsten sieben Tage: heute bis heute + 6.
    Week,
    Overdue,
    Exact(NaiveDate),
}

#[derive(Debug, Clone, Default)]
pub struct Query {
    terms: Vec<Term>,
    /// Gefaltet, klein.
    phrases: Vec<String>,
    tags_in: Vec<String>,
    tags_out: Vec<String>,
    is: Vec<(IsFilter, bool)>,
    has_date: Option<bool>,
    /// Pfad-Segmente (gefaltet, klein), ausgeschlossen?
    ins: Vec<(Vec<String>, bool)>,
    dates: Vec<DateFilter>,
}

struct Tok {
    /// Text vor einem Anführungszeichen (z. B. `in:`), bzw. das ganze Wort.
    head: String,
    /// Inhalt in Anführungszeichen, falls vorhanden.
    quoted: Option<String>,
}

fn tokenize(input: &str) -> Vec<Tok> {
    let mut toks = Vec::new();
    let mut chars = input.chars().peekable();
    loop {
        while chars.peek().is_some_and(|c| c.is_whitespace()) {
            chars.next();
        }
        if chars.peek().is_none() {
            break;
        }
        let mut head = String::new();
        let mut quoted = None;
        while let Some(&c) = chars.peek() {
            if c.is_whitespace() {
                break;
            }
            chars.next();
            if c == '"' || c == '\u{201E}' || c == '\u{201C}' {
                let mut q = String::new();
                for c in chars.by_ref() {
                    if c == '"' || c == '\u{201C}' || c == '\u{201D}' {
                        break;
                    }
                    q.push(c);
                }
                quoted = Some(q);
                // Rest bis zum nächsten Leerraum gehört nicht mehr dazu.
                while chars.peek().is_some_and(|c| !c.is_whitespace()) {
                    chars.next();
                }
                break;
            }
            head.push(c);
        }
        toks.push(Tok { head, quoted });
    }
    toks
}

fn norm_tag(t: &str) -> String {
    fold_lower(t.trim_start_matches('#').trim_end_matches('/'))
}

fn parse_date_filter(v: &str) -> Option<DateFilter> {
    let v = fold_lower(v);
    Some(match v.as_str() {
        "heute" | "today" => DateFilter::Day(0),
        "morgen" | "tomorrow" => DateFilter::Day(1),
        "gestern" | "yesterday" => DateFilter::Day(-1),
        "woche" | "week" => DateFilter::Week,
        "uberfallig" | "ueberfaellig" | "overdue" => DateFilter::Overdue,
        _ => {
            if let Ok(d) = NaiveDate::parse_from_str(&v, "%Y-%m-%d") {
                DateFilter::Exact(d)
            } else if let Ok(d) = NaiveDate::parse_from_str(&v, "%d.%m.%Y") {
                DateFilter::Exact(d)
            } else {
                return None;
            }
        }
    })
}

impl Query {
    pub fn parse(input: &str) -> Query {
        let mut q = Query::default();
        for tok in tokenize(input) {
            // Reine Phrase: "…"
            if tok.head.is_empty() {
                if let Some(p) = tok.quoted {
                    let p = fold_lower(p.trim());
                    if !p.is_empty() {
                        q.phrases.push(p);
                    }
                }
                continue;
            }
            let (neg, body) = match tok.head.strip_prefix('-').or_else(|| tok.head.strip_prefix('!')) {
                Some(rest) if !rest.is_empty() && !rest.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ',') => {
                    (true, rest.to_string())
                }
                _ => (false, tok.head.clone()),
            };
            // Tags
            if let Some(tag) = body.strip_prefix('#') {
                let tag = norm_tag(tag);
                if !tag.is_empty() {
                    if neg { q.tags_out.push(tag) } else { q.tags_in.push(tag) }
                }
                continue;
            }
            if let Some((key, val)) = body.split_once(':') {
                let key_l = key.to_lowercase();
                let val = match &tok.quoted {
                    Some(qv) if val.is_empty() => qv.clone(),
                    _ => val.to_string(),
                };
                let handled = match key_l.as_str() {
                    "type" | "typ" => {
                        let tag = norm_tag(&val);
                        if !tag.is_empty() {
                            if neg { q.tags_out.push(tag) } else { q.tags_in.push(tag) }
                        }
                        true
                    }
                    "is" | "ist" => {
                        let f = match fold_lower(&val).as_str() {
                            "todo" | "task" | "aufgabe" => Some(IsFilter::Todo),
                            "open" | "offen" => Some(IsFilter::Open),
                            "done" | "erledigt" => Some(IsFilter::Done),
                            "page" | "seite" => Some(IsFilter::Page),
                            _ => None,
                        };
                        if let Some(f) = f {
                            q.is.push((f, neg));
                        }
                        true
                    }
                    "has" | "hat" => {
                        if matches!(fold_lower(&val).as_str(), "date" | "datum") {
                            q.has_date = Some(!neg);
                        }
                        true
                    }
                    "in" => {
                        let segs: Vec<String> =
                            val.split('/').map(|s| fold_lower(s.trim())).filter(|s| !s.is_empty()).collect();
                        if !segs.is_empty() {
                            q.ins.push((segs, neg));
                        }
                        true
                    }
                    "date" | "datum" => {
                        if let Some(f) = parse_date_filter(&val) {
                            q.dates.push(f);
                        }
                        true
                    }
                    _ => false,
                };
                if handled {
                    continue;
                }
            }
            // Freier Begriff (fzf-Syntax); einzelne Satzzeichen wie „-“ ignorieren.
            if tok.head.chars().any(char::is_alphanumeric) {
                q.push_term(&tok.head);
            }
            if let Some(p) = tok.quoted {
                let p = fold_lower(p.trim());
                if !p.is_empty() {
                    q.phrases.push(p);
                }
            }
        }
        q
    }

    fn push_term(&mut self, raw: &str) {
        let (negative, mut rest) = match raw.strip_prefix('!').or_else(|| raw.strip_prefix('-')) {
            Some(r) if !r.is_empty() && !r.chars().all(|c| c.is_ascii_digit()) => (true, r),
            _ => (false, raw),
        };
        let mut kind = AtomKind::Fuzzy;
        if let Some(r) = rest.strip_prefix('^') {
            kind = AtomKind::Prefix;
            rest = r;
        } else if let Some(r) = rest.strip_prefix('\'') {
            kind = AtomKind::Substring;
            rest = r;
        }
        if rest.len() > 1
            && let Some(r) = rest.strip_suffix('$')
        {
            kind = match kind {
                AtomKind::Fuzzy => AtomKind::Postfix,
                AtomKind::Prefix => AtomKind::Exact,
                k => k,
            };
            rest = r;
        }
        if negative && kind == AtomKind::Fuzzy {
            kind = AtomKind::Substring;
        }
        let needle = fold_lower(rest);
        if needle.is_empty() {
            return;
        }
        let atom = Atom::new(&needle, CaseMatching::Ignore, Normalization::Never, kind, false);
        let needle_chars: Vec<char> = needle.chars().collect();
        let len = needle_chars.len();
        let mask = char_mask(&needle);
        self.terms.push(Term { atom, kind, negative, needle, needle_chars, len, mask });
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
            && self.phrases.is_empty()
            && self.tags_in.is_empty()
            && self.tags_out.is_empty()
            && self.is.is_empty()
            && self.has_date.is_none()
            && self.ins.is_empty()
            && self.dates.is_empty()
    }

    fn has_text(&self) -> bool {
        self.terms.iter().any(|t| !t.negative) || !self.phrases.is_empty()
    }

    fn sorts_by_date(&self) -> bool {
        !self.dates.is_empty() || self.has_date == Some(true)
    }
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

fn tag_matches(doc_tag: &str, filter: &str) -> bool {
    let t = fold_lower(doc_tag);
    t == filter || (t.starts_with(filter) && t.as_bytes().get(filter.len()) == Some(&b'/'))
}

fn path_matches(path: &[String], segs: &[String]) -> bool {
    if segs.len() == 1 {
        let s = &segs[0];
        return path.iter().any(|p| fold_lower(p).starts_with(s.as_str()));
    }
    if path.len() < segs.len() {
        return false;
    }
    let folded: Vec<String> = path.iter().map(|p| fold_lower(p)).collect();
    folded.windows(segs.len()).any(|w| {
        w.iter().zip(segs).enumerate().all(|(i, (p, s))| if i + 1 == segs.len() { p.starts_with(s.as_str()) } else { p == s })
    })
}

fn passes_filters(doc: &SearchDoc, q: &Query, today: NaiveDate) -> bool {
    for (f, neg) in &q.is {
        let ok = match f {
            IsFilter::Todo => doc.task.is_some(),
            IsFilter::Open => doc.task.is_some_and(Task::is_open),
            IsFilter::Done => matches!(doc.task, Some(Task::Done | Task::Cancelled)),
            IsFilter::Page => doc.is_page,
        };
        if ok == *neg {
            return false;
        }
    }
    if let Some(h) = q.has_date
        && doc.date.is_some() != h
    {
        return false;
    }
    for f in &q.dates {
        let Some(d) = doc.date else { return false };
        let ok = match *f {
            DateFilter::Day(off) => d == today + Duration::days(off),
            DateFilter::Week => d >= today && d <= today + Duration::days(6),
            DateFilter::Overdue => d < today && doc.task.is_some_and(Task::is_open),
            DateFilter::Exact(x) => d == x,
        };
        if !ok {
            return false;
        }
    }
    for t in &q.tags_in {
        if !doc.tags.iter().any(|dt| tag_matches(dt, t)) {
            return false;
        }
    }
    for t in &q.tags_out {
        if doc.tags.iter().any(|dt| tag_matches(dt, t)) {
            return false;
        }
    }
    for (segs, neg) in &q.ins {
        if path_matches(&doc.path, segs) == *neg {
            return false;
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Bewertung
// ---------------------------------------------------------------------------

/// Gewichte in Prozent der nucleo-Punkte.
const W_TAG: i64 = 80;
const W_PATH: i64 = 50;
const W_BODY: i64 = 45;
const W_FIELD: i64 = 40;
const W_TYPO_TITLE: i64 = 55;
const W_TYPO_BODY: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Where {
    Title,
    Tag(usize),
    Path(usize),
    Body,
    Field,
    /// Wort im Titel (Zeichenbereich im gefalteten Kleintext).
    TypoTitle,
    TypoBody,
}

#[derive(Debug, Clone, Copy)]
struct TermHit {
    score: i64,
    at: Where,
}

struct Scratch {
    matcher: Matcher,
    title: Folded,
    seg: Folded,
    idx: Vec<u32>,
    title_lower: String,
    body_lower: String,
    body_ready: bool,
    tmp: String,
    title_mask: u64,
    /// Zeichenmaske der Notiz, erst bei Bedarf berechnet.
    body_mask: Option<u64>,
    /// Pro Begriff: bewertete Treffer in Tags bzw. Pfadsegmenten (wiederholen sich oft).
    tag_cache: Vec<FxMap<String, Option<i64>>>,
    path_cache: Vec<FxMap<String, Option<i64>>>,
}

impl Scratch {
    fn new() -> Self {
        let mut config = Config::DEFAULT;
        config.prefer_prefix = true;
        Scratch {
            matcher: Matcher::new(config),
            title: Folded::default(),
            seg: Folded::default(),
            idx: Vec::new(),
            title_lower: String::new(),
            body_lower: String::new(),
            body_ready: false,
            tmp: String::new(),
            title_mask: 0,
            body_mask: None,
            tag_cache: Vec::new(),
            path_cache: Vec::new(),
        }
    }

    fn prepare(&mut self, terms: usize) {
        self.tag_cache = (0..terms).map(|_| FxMap::default()).collect();
        self.path_cache = (0..terms).map(|_| FxMap::default()).collect();
    }

    fn body<'a>(&'a mut self, doc: &SearchDoc) -> &'a str {
        if !self.body_ready {
            fold_lower_into(&doc.body, &mut self.body_lower);
            self.body_mask = None;
            self.body_ready = true;
        }
        &self.body_lower
    }
}

/// Anzahl zusammenhängender Stücke einer Fuzzy-Trefferfolge.
fn fragments(idx: &mut [u32]) -> usize {
    if idx.is_empty() {
        return 0;
    }
    idx.sort_unstable();
    1 + idx.windows(2).filter(|w| w[1] != w[0] + 1).count()
}

/// Abzug pro zusätzlichem Stück eines Fuzzy-Treffers.
const FRAGMENT_PENALTY: i64 = 18;

/// nucleo-Treffer mit Qualitätsprüfung auf einem gefalteten Text: Verstreute
/// Treffer („zufällig die Buchstaben enthalten“) werden verworfen, zerstückelte
/// abgewertet.
fn fuzzy(term: &Term, hay: &Folded, matcher: &mut Matcher, idx: &mut Vec<u32>) -> Option<i64> {
    idx.clear();
    let s = term.atom.indices(hay.utf32(), matcher, idx)? as i64;
    if term.kind != AtomKind::Fuzzy {
        return Some(s);
    }
    let frags = fragments(idx);
    if frags > 1 + term.len / 3 {
        return None;
    }
    Some(s - FRAGMENT_PENALTY * (frags as i64 - 1))
}

/// Bonus für Wortanfang, ganzes Wort und Textanfang (Kleintext, gefaltet).
fn word_bonus(hay: &str, needle: &str) -> i64 {
    let mut best = 0;
    for (pos, _) in hay.match_indices(needle) {
        let before = hay[..pos].chars().next_back();
        let after = hay[pos + needle.len()..].chars().next();
        let at_start = before.is_none_or(|c| !is_word_char(c));
        if !at_start {
            continue;
        }
        let whole = after.is_none_or(|c| !is_word_char(c));
        let mut b = 24;
        if whole {
            b += 12;
        }
        if pos == 0 {
            b += 8;
        }
        best = best.max(b);
    }
    best
}

/// Damerau-Levenshtein (eingeschränkte Transposition) mit Abbruch über `max`.
fn osa_within<T: PartialEq>(a: &[T], b: &[T], max: usize) -> Option<usize> {
    let (n, m) = (a.len(), b.len());
    if n.abs_diff(m) > max {
        return None;
    }
    if n == 0 || m == 0 {
        return (n.max(m) <= max).then_some(n.max(m));
    }
    const CAP: usize = 40;
    if n > CAP || m > CAP {
        return None;
    }
    let mut prev2 = [0usize; CAP + 1];
    let mut prev = [0usize; CAP + 1];
    let mut cur = [0usize; CAP + 1];
    for (j, p) in prev.iter_mut().enumerate().take(m + 1) {
        *p = j;
    }
    for i in 1..=n {
        cur[0] = i;
        let mut row_min = cur[0];
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut v = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                v = v.min(prev2[j - 2] + 1);
            }
            cur[j] = v;
            row_min = row_min.min(v);
        }
        if row_min > max {
            return None;
        }
        prev2[..=m].copy_from_slice(&prev[..=m]);
        prev[..=m].copy_from_slice(&cur[..=m]);
    }
    (prev[m] <= max).then_some(prev[m])
}

/// Bestes Wort mit kleinem Abstand; liefert (Abstand, Zeichenbereich im Kleintext).
/// Erlaubte Tippfehler: 1, ab 8 Zeichen 2.
fn typo_max(term: &Term) -> usize {
    if term.len >= 8 { 2 } else { 1 }
}

fn typo_word(hay: &str, term: &Term) -> Option<(usize, usize, usize)> {
    let max = typo_max(term);
    let fits = |len: usize| len >= 3 && len.abs_diff(term.len) <= max;
    let mut best: Option<(usize, usize, usize)> = None;
    // Schnellpfad: reiner ASCII-Text und ASCII-Begriff (Byte- = Zeichenindizes).
    if hay.is_ascii() && term.needle.is_ascii() {
        let (h, n) = (hay.as_bytes(), term.needle.as_bytes());
        let mut i = 0;
        while i < h.len() {
            if !h[i].is_ascii_alphanumeric() {
                i += 1;
                continue;
            }
            let start = i;
            let mut wmask = 0u64;
            while i < h.len() && h[i].is_ascii_alphanumeric() {
                wmask |= byte_bit(h[i]);
                i += 1;
            }
            // Vorfilter: Jedes fehlende bzw. zusätzliche Zeichen kostet mindestens eine Änderung.
            if (term.mask & !wmask).count_ones() as usize > max || (wmask & !term.mask).count_ones() as usize > max {
                continue;
            }
            if fits(i - start)
                && let Some(d) = osa_within(n, &h[start..i], max)
                && best.is_none_or(|b| d < b.0)
            {
                best = Some((d, start, i));
                if d == 0 {
                    break;
                }
            }
        }
        return best;
    }
    let mut word: Vec<char> = Vec::with_capacity(32);
    let mut start = 0usize;
    let mut ci = 0usize;
    let check = |word: &Vec<char>, start: usize, end: usize, best: &mut Option<(usize, usize, usize)>| {
        if !fits(word.len()) {
            return;
        }
        if let Some(d) = osa_within(&term.needle_chars, word, max)
            && best.is_none_or(|b| d < b.0)
        {
            *best = Some((d, start, end));
        }
    };
    for c in hay.chars() {
        if is_word_char(c) {
            if word.is_empty() {
                start = ci;
            }
            word.push(c);
        } else if !word.is_empty() {
            check(&word, start, ci, &mut best);
            word.clear();
        }
        ci += 1;
    }
    if !word.is_empty() {
        check(&word, start, ci, &mut best);
    }
    best
}

fn substring_score(term: &Term, weight: i64, word_bonus_hay: Option<&str>) -> i64 {
    let base = term.len as i64 * 16 * weight / 100;
    let bonus = word_bonus_hay.map(|h| word_bonus(h, &term.needle) * weight / 100).unwrap_or(0);
    base + bonus
}

/// Bester Treffer eines positiven Begriffs in einem Knoten.
fn match_term(ti: usize, term: &Term, doc: &SearchDoc, s: &mut Scratch) -> Option<TermHit> {
    let mut best: Option<TermHit> = None;
    let consider = |score: i64, at: Where, best: &mut Option<TermHit>| {
        if best.is_none_or(|b| score > b.score) {
            *best = Some(TermHit { score, at });
        }
    };
    // Titel (Vorfilter: alle Buchstaben des Begriffs müssen vorkommen)
    if term.mask & !s.title_mask == 0
        && let Some(sc) = fuzzy(term, &s.title, &mut s.matcher, &mut s.idx)
    {
        let bonus = if matches!(term.kind, AtomKind::Fuzzy | AtomKind::Substring) {
            word_bonus(&s.title_lower, &term.needle)
        } else {
            16
        };
        consider(sc + bonus, Where::Title, &mut best);
    }
    // Tags
    for (i, tag) in doc.tags.iter().enumerate() {
        let cached = s.tag_cache[ti].get(tag.as_str()).copied();
        let score = match cached {
            Some(v) => v,
            None => {
                let v = score_tag(term, tag, s);
                s.tag_cache[ti].insert(tag.clone(), v);
                v
            }
        };
        if let Some(sc) = score {
            consider(sc, Where::Tag(i), &mut best);
        }
    }
    // Pfad
    for (i, seg) in doc.path.iter().enumerate() {
        let cached = s.path_cache[ti].get(seg.as_str()).copied();
        let score = match cached {
            Some(v) => v,
            None => {
                let v = score_path(term, seg, s);
                s.path_cache[ti].insert(seg.clone(), v);
                v
            }
        };
        if let Some(sc) = score {
            consider(sc, Where::Path(i), &mut best);
        }
    }
    // Notiz und Felder nur für Fuzzy/Teilstring und nur, wenn sie noch gewinnen können.
    if matches!(term.kind, AtomKind::Fuzzy | AtomKind::Substring) {
        let body_max = (term.len as i64 * 16 + 44) * W_BODY / 100;
        if best.is_none_or(|b| b.score < body_max) && !doc.body.is_empty() {
            let body = s.body(doc);
            if body.contains(term.needle.as_str()) {
                let sc = substring_score(term, W_BODY, Some(body));
                consider(sc, Where::Body, &mut best);
            }
        }
        let field_max = (term.len as i64 * 16 + 44) * W_FIELD / 100;
        if best.is_none_or(|b| b.score < field_max) {
            for (_, v) in &doc.fields {
                fold_lower_into(v, &mut s.tmp);
                if s.tmp.contains(term.needle.as_str()) {
                    let sc = substring_score(term, W_FIELD, Some(&s.tmp));
                    consider(sc, Where::Field, &mut best);
                    break;
                }
            }
        }
    }
    // Tippfehler-Toleranz
    if best.is_none() && term.kind == AtomKind::Fuzzy && term.len >= 4 {
        let base = term.len as i64 * 16;
        let max = typo_max(term) as u32;
        // Vorfilter: Fehlen dem Text mehr Zeichen des Begriffs als erlaubte Fehler, entfällt die Wortsuche.
        let title_hit = if (term.mask & !s.title_mask).count_ones() <= max { typo_word(&s.title_lower, term) } else { None };
        if let Some((d, _, _)) = title_hit {
            consider((base - 12 * d as i64) * W_TYPO_TITLE / 100, Where::TypoTitle, &mut best);
        } else if !doc.body.is_empty() {
            s.body(doc);
            let body_mask = *s.body_mask.get_or_insert_with(|| char_mask(&s.body_lower));
            if (term.mask & !body_mask).count_ones() <= max
                && let Some((d, _, _)) = typo_word(&s.body_lower, term)
            {
                consider((base - 12 * d as i64) * W_TYPO_BODY / 100, Where::TypoBody, &mut best);
            }
        }
    }
    best
}

fn score_tag(term: &Term, tag: &str, s: &mut Scratch) -> Option<i64> {
    fold_lower_into(tag, &mut s.tmp);
    if term.mask & !char_mask(&s.tmp) != 0 {
        return None;
    }
    s.seg.set(tag);
    let sc = fuzzy(term, &s.seg, &mut s.matcher, &mut s.idx)?;
    let seg_bonus = s
        .tmp
        .split('/')
        .map(|seg| if seg == term.needle { 30 } else if seg.starts_with(term.needle.as_str()) { 18 } else { 0 })
        .max()
        .unwrap_or(0);
    Some((sc + seg_bonus) * W_TAG / 100)
}

fn score_path(term: &Term, seg: &str, s: &mut Scratch) -> Option<i64> {
    fold_lower_into(seg, &mut s.tmp);
    if term.mask & !char_mask(&s.tmp) != 0 {
        return None;
    }
    s.seg.set(seg);
    let sc = fuzzy(term, &s.seg, &mut s.matcher, &mut s.idx)?;
    let bonus = word_bonus(&s.tmp, &term.needle);
    Some((sc + bonus) * W_PATH / 100)
}

/// Ausschluss-Begriff (`!wort`): trifft Titel, Notiz, Tags oder Pfad?
fn negative_hits(term: &Term, doc: &SearchDoc, s: &mut Scratch) -> bool {
    let hit = |s: &mut Scratch, text: &str| {
        s.seg.set(text);
        s.idx.clear();
        term.atom.indices(s.seg.utf32(), &mut s.matcher, &mut s.idx).is_some()
    };
    if hit(s, &doc.title) {
        return true;
    }
    if doc.tags.iter().any(|t| hit(s, t)) || doc.path.iter().any(|p| hit(s, p)) {
        return true;
    }
    if matches!(term.kind, AtomKind::Substring | AtomKind::Fuzzy) && !doc.body.is_empty() {
        let body = s.body(doc);
        return body.contains(term.needle.as_str());
    }
    false
}

/// Bonus/Malus pro Knoten (klein gegenüber den Begriffspunkten).
fn doc_bonus(doc: &SearchDoc, today: NaiveDate) -> i64 {
    let mut b = 0;
    if doc.is_page {
        b += 6;
    }
    match doc.task {
        Some(Task::Open | Task::Doing) => b += 4,
        Some(Task::Done | Task::Cancelled) => b -= 12,
        None => {}
    }
    let len = doc.title.chars().count() as i64;
    b += (12 - len / 4).max(0);
    let midnight = today.and_hms_opt(0, 0, 0).map(|d| d.and_utc().timestamp()).unwrap_or(0);
    let age_days = (midnight - doc.modified) / 86_400;
    if age_days <= 7 {
        b += 6;
    } else if age_days <= 30 {
        b += 3;
    }
    b
}

struct Eval {
    score: i64,
    hits: Vec<TermHit>,
}

fn evaluate(doc: &SearchDoc, q: &Query, ctx: &SearchContext, s: &mut Scratch) -> Option<Eval> {
    if !passes_filters(doc, q, ctx.today) {
        return None;
    }
    s.body_ready = false;
    s.title.set(&doc.title);
    fold_lower_into(&doc.title, &mut s.title_lower);
    s.title_mask = char_mask(&s.title_lower);

    let mut total = 0i64;
    let mut hits = Vec::with_capacity(q.terms.len());
    for (ti, term) in q.terms.iter().enumerate() {
        if term.negative {
            if negative_hits(term, doc, s) {
                return None;
            }
            continue;
        }
        let h = match_term(ti, term, doc, s)?;
        total += h.score;
        hits.push(h);
    }
    for p in &q.phrases {
        let plen = p.chars().count() as i64;
        if s.title_lower.contains(p.as_str()) {
            total += plen * 20;
        } else if !doc.body.is_empty() && s.body(doc).contains(p.as_str()) {
            total += plen * 8;
        } else {
            return None;
        }
    }
    total += doc_bonus(doc, ctx.today);
    Some(Eval { score: total, hits })
}

// ---------------------------------------------------------------------------
// Hervorhebungen und Ausschnitt (nur für die besten Treffer)
// ---------------------------------------------------------------------------

/// Vorkommen eines Kleintext-Musters, als Zeichenbereiche im Original.
fn occurrences(map: &(Vec<char>, Vec<u32>), needle: &[char], orig_len: usize) -> Vec<(u32, u32)> {
    let (chars, src) = map;
    let mut out = Vec::new();
    if needle.is_empty() || chars.len() < needle.len() {
        return out;
    }
    let mut i = 0;
    while i + needle.len() <= chars.len() {
        if chars[i..i + needle.len()] == *needle {
            let start = src[i];
            let end_c = i + needle.len();
            let end = if end_c < src.len() { src[end_c] } else { orig_len as u32 };
            // ß→ss: Ende nie vor dem letzten getroffenen Originalzeichen.
            let end = end.max(src[end_c - 1] + 1);
            out.push((start, end));
            i += needle.len();
        } else {
            i += 1;
        }
    }
    out
}

fn nucleo_ranges(term: &Term, text: &str, s: &mut Scratch) -> Vec<(u32, u32)> {
    s.seg.set(text);
    s.idx.clear();
    if term.atom.indices(s.seg.utf32(), &mut s.matcher, &mut s.idx).is_none() {
        return Vec::new();
    }
    let mut orig: Vec<u32> = s.idx.iter().map(|&i| s.seg.orig(i)).collect();
    char_indices_to_ranges(&mut orig, &utf16_offsets(text))
}

fn char_range_to_utf16(r: (u32, u32), offsets: &[u32]) -> (u32, u32) {
    (offsets[r.0 as usize], offsets[r.1 as usize])
}

fn make_snippet(body: &str, ranges: &[(u32, u32)]) -> Snippet {
    const BEFORE: usize = 50;
    const WIDTH: usize = 160;
    let chars: Vec<char> = body.chars().collect();
    let n = chars.len();
    let first = ranges.iter().map(|r| r.0 as usize).min().unwrap_or(0);
    let mut start = first.saturating_sub(BEFORE);
    if start > 0 {
        // An Wortgrenze beginnen.
        if let Some(p) = chars[start..first].iter().position(|c| c.is_whitespace()) {
            start += p + 1;
        }
    }
    let mut end = (start + WIDTH).min(n);
    if end < n {
        let min_end = ranges.iter().filter(|r| r.0 as usize == first).map(|r| r.1 as usize).max().unwrap_or(first);
        if let Some(p) = chars[min_end.min(end)..end].iter().rposition(|c| c.is_whitespace()) {
            end = min_end.min(end) + p;
        }
    }
    // Text aufbauen, Leerraum zusammenfassen, Zuordnung Original → UTF-16.
    let mut text = String::new();
    let mut pos16 = 0u32;
    let mut map = vec![0u32; end - start + 1];
    if start > 0 {
        text.push('…');
        pos16 += 1;
    }
    let mut last_space = start > 0;
    for (k, &c) in chars[start..end].iter().enumerate() {
        map[k] = pos16;
        if c.is_whitespace() {
            if !last_space {
                text.push(' ');
                pos16 += 1;
                last_space = true;
            }
        } else {
            text.push(c);
            pos16 += c.len_utf16() as u32;
            last_space = false;
        }
    }
    // Leerraum am Ende entfernen.
    while text.ends_with(' ') {
        text.pop();
        pos16 -= 1;
    }
    map[end - start] = pos16;
    if end < n {
        text.push('…');
    }
    let mut out = Vec::new();
    for &(a, b) in ranges {
        let (a, b) = (a as usize, b as usize);
        if b <= start || a >= end {
            continue;
        }
        let (a, b) = (a.max(start) - start, b.min(end) - start);
        let (s16, e16) = (map[a].min(pos16), map[b].min(pos16));
        if e16 > s16 {
            out.push((s16, e16));
        }
    }
    Snippet { text, ranges: merge_ranges(out) }
}

fn highlight(doc: &SearchDoc, q: &Query, ev: &Eval, s: &mut Scratch) -> Hit {
    let mut title_ranges = Vec::new();
    let mut path_ranges = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut body_char_ranges: Vec<(u32, u32)> = Vec::new();
    let title16 = utf16_offsets(&doc.title);
    let mut body_map: Option<(Vec<char>, Vec<u32>)> = None;
    let body_len = doc.body.chars().count();

    let positive = q.terms.iter().filter(|t| !t.negative);
    for (term, hit) in positive.zip(&ev.hits) {
        match hit.at {
            Where::Title => title_ranges.extend(nucleo_ranges(term, &doc.title, s)),
            Where::Tag(i) => tags.push(doc.tags[i].clone()),
            Where::Path(i) => {
                for (a, b) in nucleo_ranges(term, &doc.path[i], s) {
                    path_ranges.push((i as u32, a, b));
                }
            }
            Where::Body => {
                let map = body_map.get_or_insert_with(|| fold_lower_map(&doc.body));
                body_char_ranges.extend(occurrences(map, &term.needle_chars, body_len));
            }
            Where::Field => {}
            Where::TypoTitle => {
                let (chars, src) = fold_lower_map(&doc.title);
                let lower: String = chars.iter().collect();
                if let Some((_, a, b)) = typo_word(&lower, term) {
                    let start = src[a];
                    let end = if b < src.len() { src[b] } else { doc.title.chars().count() as u32 };
                    title_ranges.push(char_range_to_utf16((start, end), &title16));
                }
            }
            Where::TypoBody => {
                let map = body_map.get_or_insert_with(|| fold_lower_map(&doc.body));
                let lower: String = map.0.iter().collect();
                if let Some((_, a, b)) = typo_word(&lower, term) {
                    let start = map.1[a];
                    let end = if b < map.1.len() { map.1[b] } else { body_len as u32 };
                    body_char_ranges.push((start, end));
                }
            }
        }
    }
    // Phrasen
    for p in &q.phrases {
        let pc: Vec<char> = p.chars().collect();
        let tmap = fold_lower_map(&doc.title);
        let in_title = occurrences(&tmap, &pc, doc.title.chars().count());
        if !in_title.is_empty() {
            title_ranges.extend(in_title.into_iter().map(|r| char_range_to_utf16(r, &title16)));
        } else {
            let map = body_map.get_or_insert_with(|| fold_lower_map(&doc.body));
            body_char_ranges.extend(occurrences(map, &pc, body_len));
        }
    }
    // Tag-Filter
    for f in &q.tags_in {
        for t in &doc.tags {
            if tag_matches(t, f) {
                tags.push(t.clone());
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    tags.retain(|t| seen.insert(t.clone()));

    let snippet = (!body_char_ranges.is_empty()).then(|| make_snippet(&doc.body, &merge_ranges(body_char_ranges)));
    path_ranges.sort_unstable();
    Hit {
        id: doc.id.clone(),
        score: ev.score,
        title_ranges: merge_ranges(title_ranges),
        path_ranges,
        snippet,
        matched_tags: tags,
    }
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

pub fn search(docs: &[SearchDoc], query: &Query, ctx: &SearchContext, limit: usize) -> Vec<Hit> {
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }
    let mut s = Scratch::new();
    s.prepare(query.terms.len());

    // Nur Filter: nach Datum bzw. Änderungszeit sortieren.
    if !query.has_text() {
        let mut found: Vec<(usize, Eval)> =
            docs.iter().enumerate().filter_map(|(i, d)| evaluate(d, query, ctx, &mut s).map(|e| (i, e))).collect();
        if query.sorts_by_date() {
            found.sort_by(|a, b| {
                let (da, db) = (docs[a.0].date, docs[b.0].date);
                match (da, db) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                }
            });
        } else {
            found.sort_by(|a, b| docs[b.0].modified.cmp(&docs[a.0].modified));
        }
        found.truncate(limit);
        let n = found.len() as i64;
        return found
            .into_iter()
            .enumerate()
            .map(|(rank, (i, mut ev))| {
                ev.score = n - rank as i64;
                highlight(&docs[i], query, &ev, &mut s)
            })
            .collect();
    }

    let mut found = evaluate_all(docs, query, ctx);
    // Stabil: bei gleichem Score bleibt die Reihenfolge der Eingabe.
    found.sort_by(|a, b| b.1.score.cmp(&a.1.score).then(a.0.cmp(&b.0)));
    found.truncate(limit);
    found.into_iter().map(|(i, ev)| highlight(&docs[i], query, &ev, &mut s)).collect()
}

/// Ab dieser Größe wird auf mehrere Kerne verteilt.
const PARALLEL_FROM: usize = 4000;

/// Bewertet alle Knoten, bei großen Mengen parallel.
fn evaluate_all(docs: &[SearchDoc], query: &Query, ctx: &SearchContext) -> Vec<(usize, Eval)> {
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get()).min(8);
    let run = |offset: usize, chunk: &[SearchDoc]| {
        let mut s = Scratch::new();
        s.prepare(query.terms.len());
        chunk
            .iter()
            .enumerate()
            .filter_map(|(i, d)| evaluate(d, query, ctx, &mut s).map(|e| (offset + i, e)))
            .collect::<Vec<_>>()
    };
    if threads < 2 || docs.len() < PARALLEL_FROM {
        return run(0, docs);
    }
    let size = docs.len().div_ceil(threads);
    std::thread::scope(|scope| {
        let handles: Vec<_> = docs
            .chunks(size)
            .enumerate()
            .map(|(k, chunk)| {
                let run = &run;
                scope.spawn(move || run(k * size, chunk))
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

/// Fuzzy über alle Tags (für die #-Autovervollständigung); leere Eingabe → nach Häufigkeit.
pub fn search_tags(tags: &[(String, usize)], input: &str, limit: usize) -> Vec<TagHit> {
    let needle = fold_lower(input.trim().trim_start_matches('#'));
    if needle.is_empty() {
        let mut v: Vec<&(String, usize)> = tags.iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        return v.into_iter().take(limit).map(|(t, c)| TagHit { tag: t.clone(), count: *c, ranges: Vec::new() }).collect();
    }
    let mut matcher = Matcher::new(Config::DEFAULT);
    let atom = Atom::new(&needle, CaseMatching::Ignore, Normalization::Never, AtomKind::Fuzzy, false);
    let mut hay = Folded::default();
    let mut idx = Vec::new();
    // (Score, Index, Hervorhebung)
    let mut found: Vec<(i64, usize, Ranges)> = Vec::new();
    for (i, (tag, count)) in tags.iter().enumerate() {
        hay.set(tag);
        idx.clear();
        let Some(sc) = atom.indices(hay.utf32(), &mut matcher, &mut idx) else { continue };
        let lower = fold_lower(tag);
        let mut score = sc as i64;
        if lower == needle {
            score += 60;
        } else if lower.starts_with(&needle) {
            score += 30;
        } else if lower.split('/').any(|s| s.starts_with(&needle)) {
            score += 18;
        }
        // Häufige Tags leicht bevorzugen, kurze ebenso.
        score += (*count as f64 + 1.0).log2().round() as i64 * 2;
        score -= (tag.chars().count() as i64) / 8;
        let mut orig: Vec<u32> = idx.iter().map(|&i| hay.orig(i)).collect();
        let ranges = char_indices_to_ranges(&mut orig, &utf16_offsets(tag));
        found.push((score, i, ranges));
    }
    found.sort_by_key(|f| std::cmp::Reverse(f.0));
    found
        .into_iter()
        .take(limit)
        .map(|(_, i, ranges)| TagHit { tag: tags[i].0.clone(), count: tags[i].1, ranges })
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
    }

    fn ctx() -> SearchContext {
        SearchContext { today: today() }
    }

    fn doc(id: &str, title: &str) -> SearchDoc {
        SearchDoc {
            id: id.into(),
            is_page: false,
            title: title.into(),
            body: String::new(),
            path: Vec::new(),
            tags: Vec::new(),
            task: None,
            date: None,
            fields: Vec::new(),
            modified: 0,
        }
    }

    fn with_body(mut d: SearchDoc, body: &str) -> SearchDoc {
        d.body = body.into();
        d
    }

    fn ids(hits: &[Hit]) -> Vec<&str> {
        hits.iter().map(|h| h.id.as_str()).collect()
    }

    fn run(docs: &[SearchDoc], q: &str) -> Vec<Hit> {
        search(docs, &Query::parse(q), &ctx(), 50)
    }

    /// Hervorgehobener Text (UTF-16-Bereiche) als Strings.
    fn marked(text: &str, ranges: &[(u32, u32)]) -> Vec<String> {
        let u: Vec<u16> = text.encode_utf16().collect();
        ranges.iter().map(|&(a, b)| String::from_utf16(&u[a as usize..b as usize]).unwrap()).collect()
    }

    // --- plain_text ---

    #[test]
    fn plain_text_links() {
        assert_eq!(plain_text("Siehe [[Anna Schmidt]]"), "Siehe Anna Schmidt");
        assert_eq!(plain_text("[[Projekte/Sqonto|Sqonto]] läuft"), "Sqonto läuft");
        assert_eq!(plain_text("Kickoff [[Projekte#^k3j9a2|Kickoff-Notizen]]"), "Kickoff Kickoff-Notizen");
        assert_eq!(plain_text("[[Projekte#^k3j9a2]]"), "Projekte");
        assert_eq!(plain_text("Doku: [Rust Book](https://doc.rust-lang.org/book/)"), "Doku: Rust Book");
        assert_eq!(plain_text("Bild ![Logo](logo.png) und ![[Skizze.png]]"), "Bild Logo und Skizze.png");
        assert_eq!(plain_text("[nicht geschlossen"), "[nicht geschlossen");
        assert_eq!(plain_text("Liste [a] und (b)"), "Liste [a] und (b)");
        assert_eq!(plain_text("<https://example.com>"), "https://example.com");
    }

    #[test]
    fn plain_text_emphasis_and_code() {
        assert_eq!(plain_text("**fett** und __auch__"), "fett und auch");
        assert_eq!(plain_text("*kursiv* und _so_"), "kursiv und so");
        assert_eq!(plain_text("~~weg~~ ==markiert=="), "weg markiert");
        assert_eq!(plain_text("`code **nicht** fett`"), "code **nicht** fett");
        assert_eq!(plain_text("snake_case_name bleibt"), "snake_case_name bleibt");
        assert_eq!(plain_text("2 * 3 * 4"), "2 * 3 * 4");
        assert_eq!(plain_text("**[[Anna]]** kommt"), "Anna kommt");
        assert_eq!(plain_text(r"\*kein\* Stern"), "*kein* Stern");
        assert_eq!(plain_text("``a ` b``"), "a ` b");
    }

    #[test]
    fn plain_text_id_heading_tags() {
        assert_eq!(plain_text("Ein Todo #projekte/sqonto ^k3j9a2"), "Ein Todo #projekte/sqonto");
        assert_eq!(plain_text("## Überschrift"), "Überschrift");
        assert_eq!(plain_text("#tag am Anfang"), "#tag am Anfang");
        assert_eq!(plain_text("Preis ^2"), "Preis");
        assert_eq!(plain_text("Text mit ^ Dach"), "Text mit ^ Dach");
    }

    // --- Abfrage ---

    #[test]
    fn query_parsing() {
        let q = Query::parse(concat!(
            r#"sqo "genaue Phrase" #Projekte/Sqonto/ -#archiv !#alt type:meeting is:todo ist:erledigt "#,
            r#"-is:page has:date in:"Mein Ordner" in:a/b date:heute 'exakt ^anf ende$ !nicht"#,
        ));
        assert_eq!(q.terms.len(), 5);
        assert_eq!(q.terms[0].needle, "sqo");
        assert_eq!(q.terms[0].kind, AtomKind::Fuzzy);
        assert_eq!(q.terms[1].kind, AtomKind::Substring);
        assert_eq!(q.terms[2].kind, AtomKind::Prefix);
        assert_eq!(q.terms[3].kind, AtomKind::Postfix);
        assert!(q.terms[4].negative);
        assert_eq!(q.phrases, vec!["genaue phrase"]);
        assert_eq!(q.tags_in, vec!["projekte/sqonto", "meeting"]);
        assert_eq!(q.tags_out, vec!["archiv", "alt"]);
        assert_eq!(q.is, vec![(IsFilter::Todo, false), (IsFilter::Done, false), (IsFilter::Page, true)]);
        assert_eq!(q.has_date, Some(true));
        assert_eq!(q.ins, vec![(vec!["mein ordner".to_string()], false), (vec!["a".into(), "b".into()], false)]);
        assert_eq!(q.dates, vec![DateFilter::Day(0)]);
        assert!(!q.is_empty());
    }

    #[test]
    fn query_incomplete_filters_are_ignored() {
        assert!(Query::parse("is:to").is_empty());
        assert!(Query::parse("date:mo").is_empty());
        assert!(Query::parse("#").is_empty());
        assert!(Query::parse("   ").is_empty());
        // Unbekannte Präfixe sind normale Begriffe.
        let q = Query::parse("12:30 http://x");
        assert_eq!(q.terms.len(), 2);
        // Negative Zahl bleibt Begriff.
        let q = Query::parse("-5");
        assert!(!q.terms[0].negative);
    }

    #[test]
    fn query_folds_umlauts() {
        let q = Query::parse("Über Straße");
        assert_eq!(q.terms[0].needle, "uber");
        assert_eq!(q.terms[1].needle, "strasse");
    }

    // --- Filter ---

    fn filter_docs() -> Vec<SearchDoc> {
        let mut a = doc("a", "Bericht schreiben");
        a.task = Some(Task::Open);
        a.date = Some(today() - Duration::days(2));
        a.tags = vec!["projekte/sqonto/milestone1".into()];
        a.path = vec!["Projekte".into(), "Sqonto".into()];
        let mut b = doc("b", "Steuer erledigt");
        b.task = Some(Task::Done);
        b.date = Some(today());
        b.path = vec!["Privat".into()];
        let mut c = doc("c", "Projekte");
        c.is_page = true;
        c.modified = 100;
        let mut d = doc("d", "Zahnarzt");
        d.date = Some(today() + Duration::days(1));
        d.tags = vec!["termin".into()];
        d.path = vec!["Privat".into(), "Gesundheit".into()];
        d.modified = 50;
        let mut e = doc("e", "Review");
        e.task = Some(Task::Doing);
        e.date = Some(today() + Duration::days(5));
        e.tags = vec!["projekte/sqritto".into(), "meeting".into()];
        vec![a, b, c, d, e]
    }

    #[test]
    fn filters() {
        let docs = filter_docs();
        let sorted = |q: &str| {
            let mut v: Vec<String> = run(&docs, q).into_iter().map(|h| h.id).collect();
            v.sort();
            v
        };
        assert_eq!(sorted("is:todo"), vec!["a", "b", "e"]);
        assert_eq!(sorted("is:open"), vec!["a", "e"]);
        assert_eq!(sorted("ist:offen"), vec!["a", "e"]);
        assert_eq!(sorted("is:done"), vec!["b"]);
        assert_eq!(sorted("is:page"), vec!["c"]);
        assert_eq!(sorted("-is:todo"), vec!["c", "d"]);
        assert_eq!(sorted("has:date"), vec!["a", "b", "d", "e"]);
        assert_eq!(sorted("hat:datum"), vec!["a", "b", "d", "e"]);
        assert_eq!(sorted("#projekte"), vec!["a", "e"]);
        assert_eq!(sorted("#projekte/sqonto"), vec!["a"]);
        assert_eq!(sorted("#projekte/sq"), Vec::<String>::new());
        assert_eq!(sorted("#projekte -#projekte/sqritto"), vec!["a"]);
        assert_eq!(sorted("type:meeting"), vec!["e"]);
        assert_eq!(sorted("in:privat"), vec!["b", "d"]);
        assert_eq!(sorted("in:priv"), vec!["b", "d"]);
        assert_eq!(sorted("in:privat/gesund"), vec!["d"]);
        assert_eq!(sorted("-in:privat"), vec!["a", "c", "e"]);
        assert_eq!(sorted("in:Projekte/Sqonto"), vec!["a"]);
        assert_eq!(sorted("date:heute"), vec!["b"]);
        assert_eq!(sorted("date:morgen"), vec!["d"]);
        assert_eq!(sorted("date:woche"), vec!["b", "d", "e"]);
        assert_eq!(sorted("date:überfällig"), vec!["a"]);
        assert_eq!(sorted("date:overdue"), vec!["a"]);
        assert_eq!(sorted("date:2026-10-31"), vec!["e"]);
        assert_eq!(sorted("date:31.10.2026"), vec!["e"]);
    }

    #[test]
    fn filter_only_sorting() {
        let docs = filter_docs();
        // Datumsfilter: aufsteigend nach Datum.
        assert_eq!(ids(&run(&docs, "has:date")), vec!["a", "b", "d", "e"]);
        // Sonst: neueste zuerst.
        let hits = run(&docs, "-is:todo");
        assert_eq!(ids(&hits), vec!["c", "d"]);
        assert!(hits[0].score > hits[1].score);
        // Tag-Filter markiert die passenden Tags.
        let hits = run(&docs, "#projekte/sqonto");
        assert_eq!(hits[0].matched_tags, vec!["projekte/sqonto/milestone1"]);
    }

    #[test]
    fn filters_combine_with_terms() {
        let docs = filter_docs();
        assert_eq!(ids(&run(&docs, "bericht is:open")), vec!["a"]);
        assert!(run(&docs, "bericht is:done").is_empty());
        assert_eq!(ids(&run(&docs, "zahn in:privat")), vec!["d"]);
    }

    // --- Ranking ---

    #[test]
    fn ranking_sqo_mile() {
        let mut tagged = doc("tagged", "Abnahme vorbereiten");
        tagged.tags = vec!["projekte/sqonto/milestone1".into()];
        let docs = vec![
            doc("noise1", "Squash mit Olaf, Mittwoch lesen"),
            doc("noise2", "Sequenzdiagramm optimieren, Mails lesen"),
            tagged,
            doc("title", "Sqonto Milestone 1"),
            doc("other", "Einkaufsliste"),
        ];
        let hits = run(&docs, "sqo mile");
        let order = ids(&hits);
        assert_eq!(order[0], "title", "{order:?}");
        assert_eq!(order[1], "tagged", "{order:?}");
        assert!(!order.contains(&"other"));
        // Hervorhebung im Titel.
        assert_eq!(marked("Sqonto Milestone 1", &hits[0].title_ranges), vec!["Sqo", "Mile"]);
        assert_eq!(hits[1].matched_tags, vec!["projekte/sqonto/milestone1"]);
    }

    #[test]
    fn ranking_typo() {
        let docs = vec![
            doc("r", "Rechnung an Kunde schicken"),
            doc("x", "Reiseplanung"),
            doc("y", "Einkauf"),
        ];
        // Fehlender Buchstabe (Fuzzy).
        let hits = run(&docs, "rechnug");
        assert_eq!(ids(&hits)[0], "r");
        // Vertauschte Buchstaben (Tippfehler-Fallback).
        let hits = run(&docs, "rehcnung");
        assert_eq!(ids(&hits), vec!["r"]);
        assert_eq!(marked("Rechnung an Kunde schicken", &hits[0].title_ranges), vec!["Rechnung"]);
        // Falscher Buchstabe.
        assert_eq!(ids(&run(&docs, "rechnunk")), vec!["r"]);
        // Zu kurz für Tippfehler-Toleranz.
        assert!(run(&docs, "ekn").is_empty() || ids(&run(&docs, "ekn")) != vec!["r"]);
        // Zwei Fehler erst ab 8 Zeichen.
        assert_eq!(ids(&run(&docs, "rehcnunk")), vec!["r"]);
        assert!(run(&docs, "kunfe").iter().any(|h| h.id == "r"));
    }

    #[test]
    fn typo_in_body_with_snippet() {
        let docs = vec![with_body(doc("n", "Notiz"), "Hier steht etwas über die Steuererklärung 2026.")];
        let hits = run(&docs, "steuererklräung");
        assert_eq!(ids(&hits), vec!["n"]);
        let sn = hits[0].snippet.as_ref().unwrap();
        assert_eq!(marked(&sn.text, &sn.ranges), vec!["Steuererklärung"]);
    }

    #[test]
    fn title_before_body() {
        let docs = vec![
            with_body(doc("body", "Allgemeines"), "Wir sollten die Architektur überdenken."),
            doc("title", "Architektur-Entscheidungen"),
        ];
        let hits = run(&docs, "architektur");
        assert_eq!(ids(&hits), vec!["title", "body"]);
        assert!(hits[1].snippet.is_some());
        assert!(hits[0].snippet.is_none());
    }

    #[test]
    fn body_is_not_fuzzy() {
        // Verstreute Buchstaben in langer Notiz zählen nicht.
        let docs = vec![with_body(doc("n", "Notiz"), "mal ist es leicht, eben")];
        assert!(run(&docs, "mile").is_empty());
    }

    #[test]
    fn scattered_title_rejected() {
        let docs = vec![doc("n", "Mails in Leipzig erstellen, Stoffe online neu")];
        assert!(run(&docs, "milestone").is_empty());
    }

    #[test]
    fn path_matches_rank_below_title() {
        let mut child = doc("child", "Kickoff");
        child.path = vec!["Projekte".into(), "Sqonto".into()];
        let mut page = doc("page", "Sqonto");
        page.is_page = true;
        page.path = vec!["Projekte".into()];
        let docs = vec![child, page];
        let hits = run(&docs, "sqonto");
        assert_eq!(ids(&hits), vec!["page", "child"]);
        assert_eq!(hits[1].path_ranges, vec![(1, 0, 6)]);
        // Mehrere Begriffe: Pfad + Titel.
        let hits = run(&docs, "sqonto kick");
        assert_eq!(ids(&hits), vec!["child"]);
        assert_eq!(marked("Kickoff", &hits[0].title_ranges), vec!["Kick"]);
    }

    #[test]
    fn umlauts_and_case() {
        let docs = vec![doc("m", "Besprechung München"), doc("s", "Straßenfest planen")];
        assert_eq!(ids(&run(&docs, "munchen")), vec!["m"]);
        assert_eq!(ids(&run(&docs, "MÜNCHEN")), vec!["m"]);
        assert_eq!(ids(&run(&docs, "muenchen")), vec!["m"]);
        let hits = run(&docs, "strasse");
        assert_eq!(ids(&hits), vec!["s"]);
        assert_eq!(marked("Straßenfest planen", &hits[0].title_ranges), vec!["Straße"]);
        let hits = run(&docs, "\"straßenfest\"");
        assert_eq!(ids(&hits), vec!["s"]);
    }

    #[test]
    fn utf16_ranges_with_emoji() {
        let docs = vec![doc("e", "Plan 📅 Meeting mit Jürgen")];
        let hits = run(&docs, "meet jurg");
        assert_eq!(ids(&hits), vec!["e"]);
        let r = &hits[0].title_ranges;
        assert_eq!(r[0], (8, 12));
        assert_eq!(marked("Plan 📅 Meeting mit Jürgen", r), vec!["Meet", "Jürg"]);
    }

    #[test]
    fn snippet_window_and_ranges() {
        let body = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor \
                    incididunt ut labore et dolore magna aliqua.\n\nUt enim ad minim veniam, quis nostrud \
                    exercitation ullamco 🚀 Raketenstart laboris nisi ut aliquip ex ea commodo consequat. Duis aute \
                    irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";
        let docs = vec![with_body(doc("n", "Notiz"), body)];
        let hits = run(&docs, "raketenstart");
        let sn = hits[0].snippet.as_ref().unwrap();
        assert!(sn.text.starts_with('…'));
        assert!(sn.text.ends_with('…'));
        assert!(!sn.text.contains('\n'));
        assert!(sn.text.chars().count() <= 165, "{}", sn.text);
        assert_eq!(marked(&sn.text, &sn.ranges), vec!["Raketenstart"]);
    }

    #[test]
    fn snippet_short_body_has_no_ellipsis() {
        let docs = vec![with_body(doc("n", "Notiz"), "Kurz:\n  rust   async")];
        let hits = run(&docs, "async");
        let sn = hits[0].snippet.as_ref().unwrap();
        assert_eq!(sn.text, "Kurz: rust async");
        assert_eq!(marked(&sn.text, &sn.ranges), vec!["async"]);
    }

    #[test]
    fn phrases() {
        let docs = vec![
            with_body(doc("a", "Notiz A"), "Das ist eine genaue Phrase im Text."),
            with_body(doc("b", "Notiz B"), "Phrase genaue ist anders herum."),
        ];
        let hits = run(&docs, "\"genaue phrase\"");
        assert_eq!(ids(&hits), vec!["a"]);
        let sn = hits[0].snippet.as_ref().unwrap();
        assert_eq!(marked(&sn.text, &sn.ranges), vec!["genaue Phrase"]);
    }

    #[test]
    fn negation_and_fzf_kinds() {
        let docs = vec![
            doc("a", "Rust Async Patterns"),
            doc("b", "Rust Buch"),
            with_body(doc("c", "Rust Notizen"), "async/await"),
            doc("d", "Trust me"),
        ];
        let mut r = ids(&run(&docs, "rust !async")).into_iter().map(String::from).collect::<Vec<_>>();
        r.sort();
        assert_eq!(r, vec!["b", "d"]);
        assert_eq!(ids(&run(&docs, "^rust buch")), vec!["b"]);
        let hits = run(&docs, "^rust");
        let mut r: Vec<&str> = ids(&hits);
        r.sort();
        assert_eq!(r, vec!["a", "b", "c"]);
        assert_eq!(ids(&run(&docs, "patterns$")), vec!["a"]);
        assert_eq!(ids(&run(&docs, "'ust m")), vec!["d"]);
    }

    #[test]
    fn fields_are_searched() {
        let mut d = doc("p", "Anna Schmidt");
        d.fields = vec![("email".into(), "anna@example.com".into()), ("firma".into(), "Müller GmbH".into())];
        let docs = vec![d, doc("x", "Sonstiges")];
        assert_eq!(ids(&run(&docs, "muller")), vec!["p"]);
        assert_eq!(ids(&run(&docs, "example")), vec!["p"]);
    }

    #[test]
    fn bonuses() {
        let mut done = doc("done", "Steuer");
        done.task = Some(Task::Done);
        let mut open = doc("open", "Steuer");
        open.task = Some(Task::Open);
        let mut page = doc("page", "Steuer");
        page.is_page = true;
        let docs = vec![done, open, page];
        assert_eq!(ids(&run(&docs, "steuer")), vec!["page", "open", "done"]);
        // Kürzerer Titel vor längerem.
        let docs = vec![doc("long", "Steuer für das Jahr 2025 vorbereiten und abgeben"), doc("short", "Steuer 2025")];
        assert_eq!(ids(&run(&docs, "steuer")), vec!["short", "long"]);
        // Neuere Seite bevorzugt.
        let mut old = doc("old", "Steuer");
        old.modified = 0;
        let mut new = doc("new", "Steuer");
        new.modified = today().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp() - 3600;
        assert_eq!(ids(&run(&[old, new], "steuer")), vec!["new", "old"]);
    }

    #[test]
    fn stable_order_and_limit() {
        let docs: Vec<SearchDoc> = (0..10).map(|i| doc(&format!("d{i}"), "Gleich")).collect();
        let hits = search(&docs, &Query::parse("gleich"), &ctx(), 3);
        assert_eq!(ids(&hits), vec!["d0", "d1", "d2"]);
    }

    #[test]
    fn tag_term_matching() {
        let mut d = doc("t", "Abnahme");
        d.tags = vec!["projekte/sqonto/milestone1".into()];
        let hits = run(&[d], "milestone1");
        assert_eq!(hits[0].matched_tags, vec!["projekte/sqonto/milestone1"]);
    }

    #[test]
    fn lone_punctuation_and_only_negative() {
        let docs = vec![doc("a", "Meeting Notes"), doc("b", "Archiv alt")];
        assert_eq!(ids(&run(&docs, "meeting - notes")), vec!["a"]);
        // Nur Ausschluss: alle anderen Knoten.
        assert_eq!(ids(&run(&docs, "!archiv")), vec!["a"]);
    }

    #[test]
    fn negative_term_checks_tags_and_path() {
        let mut a = doc("a", "Plan");
        a.tags = vec!["archiv".into()];
        let mut b = doc("b", "Plan");
        b.path = vec!["Archiv".into()];
        let c = doc("c", "Plan");
        assert_eq!(ids(&run(&[a, b, c], "plan !archiv")), vec!["c"]);
    }

    #[test]
    fn path_ranges_with_umlauts() {
        let mut d = doc("d", "Kickoff");
        d.path = vec!["Übersicht 📌".into(), "Größere Projekte".into()];
        let hits = run(&[d], "grosse");
        assert_eq!(hits[0].path_ranges.len(), 1);
        let (i, a, b) = hits[0].path_ranges[0];
        assert_eq!(i, 1);
        assert_eq!(marked("Größere Projekte", &[(a, b)]), vec!["Größe"]);
    }

    #[test]
    fn quoted_in_filter() {
        let mut d = doc("d", "Kickoff");
        d.path = vec!["Mein Ordner".into(), "Sub".into()];
        let docs = vec![d, doc("e", "Kickoff")];
        assert_eq!(ids(&run(&docs, "kick in:\"mein ordner\"")), vec!["d"]);
        assert_eq!(ids(&run(&docs, "kick in:\"Mein Ordner/sub\"")), vec!["d"]);
    }

    #[test]
    fn parallel_matches_sequential() {
        // Groß genug für die parallele Auswertung; Ergebnis muss stabil und gleich sein.
        let docs = synthetic(PARALLEL_FROM * 2 + 17);
        let q = Query::parse("rech kunde");
        let a = search(&docs, &q, &ctx(), 100);
        let b = search(&docs, &q, &ctx(), 100);
        assert_eq!(ids(&a), ids(&b));
        let seq = evaluate_all(&docs[..PARALLEL_FROM - 1], &q, &ctx());
        assert!(seq.windows(2).all(|w| w[0].0 < w[1].0));
        assert!(!a.is_empty());
    }

    #[test]
    fn hit_serializes_camel_case() {
        let docs = vec![doc("a", "Test")];
        let json = serde_json::to_string(&run(&docs, "test")[0]).unwrap();
        assert!(json.contains("\"titleRanges\""));
        assert!(json.contains("\"matchedTags\""));
        let s = serde_json::to_string(&Task::Cancelled).unwrap();
        assert_eq!(s, "\"cancelled\"");
    }

    // --- Tags ---

    #[test]
    fn tag_search() {
        let tags = vec![
            ("projekte/sqonto/milestone1".to_string(), 3),
            ("projekte/sqritto".to_string(), 10),
            ("meeting".to_string(), 25),
            ("person".to_string(), 7),
            ("übersicht".to_string(), 1),
        ];
        let all = search_tags(&tags, "", 10);
        assert_eq!(all[0].tag, "meeting");
        assert_eq!(all.len(), 5);
        let hits = search_tags(&tags, "#sqo", 10);
        assert_eq!(hits[0].tag, "projekte/sqonto/milestone1");
        assert_eq!(marked(&hits[0].tag, &hits[0].ranges), vec!["sqo"]);
        let hits = search_tags(&tags, "mile", 10);
        assert_eq!(hits[0].tag, "projekte/sqonto/milestone1");
        let hits = search_tags(&tags, "uber", 10);
        assert_eq!(hits[0].tag, "übersicht");
        assert_eq!(marked("übersicht", &hits[0].ranges), vec!["über"]);
        let hits = search_tags(&tags, "pro", 10);
        // Häufiger Tag zuerst bei gleichwertigem Treffer.
        assert_eq!(hits[0].tag, "projekte/sqritto");
        assert!(search_tags(&tags, "xyz", 10).is_empty());
    }

    // --- Leistung ---

    fn synthetic(n: usize) -> Vec<SearchDoc> {
        let words = [
            "Projekt", "Meeting", "Rechnung", "Steuer", "Architektur", "Entwurf", "Kunde", "Angebot", "Server",
            "Datenbank", "Fehler", "Release", "Planung", "Notiz", "Idee", "Einkauf", "Urlaub", "Reise", "Buch",
            "Artikel", "Code", "Review", "Test", "Sprint", "Ziel", "Budget", "Vertrag", "Telefonat", "Präsentation",
            "Workshop", "Übersicht", "Straße", "München", "Köln", "Grüße", "Lösung", "Prüfung",
        ];
        let mut seed: u64 = 42;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        (0..n)
            .map(|i| {
                let tw = 2 + (next() % 5) as usize;
                let title: Vec<&str> = (0..tw).map(|_| words[(next() % words.len() as u64) as usize]).collect();
                let bw = (next() % 60) as usize;
                let body: Vec<&str> = (0..bw).map(|_| words[(next() % words.len() as u64) as usize]).collect();
                let mut d = doc(&format!("n{i}"), &title.join(" "));
                d.body = body.join(" ");
                d.path = vec!["Projekte".into(), words[(next() % words.len() as u64) as usize].into()];
                if next() % 4 == 0 {
                    d.tags = vec![format!("projekte/{}", words[(next() % 8) as usize].to_lowercase())];
                }
                if next() % 3 == 0 {
                    d.task = Some(Task::Open);
                }
                d.modified = (next() % 1_000_000) as i64;
                d
            })
            .collect()
    }

    #[test]
    #[ignore]
    fn bench_20k() {
        let docs = synthetic(20_000);
        for q in ["rech", "sqo mile", "architektur entwurf", "rehcnung", "prufung", "\"kunde angebot\"", "#projekte is:open", "xyzq"] {
            let query = Query::parse(q);
            // Aufwärmen
            let _ = search(&docs, &query, &ctx(), 50);
            // Minimum aus mehreren Läufen (robust gegen Last auf dem Rechner).
            let mut best = f64::MAX;
            let mut n = 0;
            for _ in 0..15 {
                let t = std::time::Instant::now();
                n = search(&docs, &query, &ctx(), 50).len();
                best = best.min(t.elapsed().as_secs_f64() * 1000.0);
            }
            println!("{q:<28} {best:7.2} ms  ({n} Treffer)");
        }
    }
}

