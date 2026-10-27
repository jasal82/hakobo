// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Datum, Wiederholung und Erinnerung: kanonische Feldwerte (`date::`,
//! `repeat::`, `remind::`), natürlichsprachliche Eingabe auf Deutsch und
//! Englisch, Vorkommen von Serien und Zeitpunkte von Erinnerungen.
//!
//! Alle Funktionen sind rein: Der Bezugszeitpunkt („jetzt“) wird übergeben.

use chrono::{Datelike, Duration, Months, NaiveDate, NaiveDateTime, NaiveTime, Weekday};
use serde::Serialize;

/// Morgenzeit für absolute Erinnerungen ohne Uhrzeit („Erinnerung morgen“).
const DEFAULT_REMIND_TIME: (u32, u32) = (9, 0);

/// Höchstzahl an Wörtern, die für ein Präfix untersucht werden.
const MAX_PREFIX_TOKENS: usize = 16;

// ---------------------------------------------------------------------------
// When – Wert von `date::`
// ---------------------------------------------------------------------------

/// Wert des Felds `date::`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct When {
    pub start: NaiveDate,
    pub start_time: Option<NaiveTime>,
    pub end_date: Option<NaiveDate>,
    pub end_time: Option<NaiveTime>,
}

impl When {
    /// Kanonische Form und tolerante Varianten (ISO, deutsches Datum, `T`).
    pub fn parse(s: &str) -> Option<When> {
        let toks = lex(s);
        let (start, start_time, mut i) = strict_side(&toks, 0)?;
        let mut w = When { start, start_time, end_date: None, end_time: None };
        if i < toks.len() {
            if !(toks[i].kind == Kind::Dash || toks[i].is_word(&["bis", "to"])) {
                return None;
            }
            i += 1;
            if let Some((ed, et, k)) = strict_side(&toks, i) {
                w.end_date = Some(ed);
                w.end_time = et;
                i = k;
            } else if let Some(Kind::Colon(h, m)) = toks.get(i).map(|t| &t.kind) {
                w.end_time = Some(hm(*h, *m)?);
                i += 1;
            } else {
                return None;
            }
        }
        if i != toks.len() {
            return None;
        }
        w.normalized()
    }

    /// Kanonische Schreibweise, siehe `docs/format.md`.
    pub fn format(&self) -> String {
        let mut s = fmt_date(self.start);
        if let Some(t) = self.start_time {
            s.push(' ');
            s.push_str(&fmt_time(t));
        }
        match (self.end_date, self.end_time) {
            (Some(d), t) => {
                s.push_str(" - ");
                s.push_str(&fmt_date(d));
                if let Some(t) = t {
                    s.push(' ');
                    s.push_str(&fmt_time(t));
                }
            }
            (None, Some(t)) if self.start_time.is_some() => {
                s.push('-');
                s.push_str(&fmt_time(t));
            }
            _ => {}
        }
        s
    }

    pub fn is_all_day(&self) -> bool {
        self.start_time.is_none()
    }

    /// Beginn; 00:00 bei ganztägigen Einträgen.
    pub fn start_dt(&self) -> NaiveDateTime {
        self.start.and_time(self.start_time.unwrap_or(NaiveTime::MIN))
    }

    /// Ende (exklusiv); bei mehrtägigen Einträgen ohne Uhrzeit 00:00 des
    /// Folgetags. `None`, wenn kein Ende angegeben ist.
    pub fn end_dt(&self) -> Option<NaiveDateTime> {
        match (self.end_date, self.end_time) {
            (Some(d), Some(t)) => Some(d.and_time(t)),
            (None, Some(t)) => Some(self.start.and_time(t)),
            (Some(d), None) => d.succ_opt().map(|n| n.and_time(NaiveTime::MIN)),
            (None, None) => None,
        }
    }

    /// Letzter Tag, den der Eintrag berührt.
    pub fn last_day(&self) -> NaiveDate {
        self.end_date.unwrap_or(self.start)
    }

    /// Gleicher Eintrag an einem anderen Tag (Dauer und Uhrzeiten bleiben).
    pub fn shift_to(&self, new_start: NaiveDate) -> When {
        let delta = new_start - self.start;
        When {
            start: new_start,
            start_time: self.start_time,
            end_date: self.end_date.and_then(|d| d.checked_add_signed(delta)),
            end_time: self.end_time,
        }
    }

    /// Kurzform für die Oberfläche, z. B. „Heute 14:00“, „Fr 30.10.“,
    /// „Di 27.10. 14:00–15:30“, „Mo 26.10. – Mi 28.10.“.
    pub fn human_de(&self, today: NaiveDate) -> String {
        if let Some(end) = self.end_date {
            let mut s = date_abs_de(self.start, today.year());
            if let Some(t) = self.start_time {
                s.push(' ');
                s.push_str(&fmt_time(t));
            }
            s.push_str(" – ");
            s.push_str(&date_abs_de(end, today.year()));
            if let Some(t) = self.end_time {
                s.push(' ');
                s.push_str(&fmt_time(t));
            }
            return s;
        }
        let mut s = date_label_de(self.start, today);
        if let Some(t) = self.start_time {
            s.push(' ');
            s.push_str(&fmt_time(t));
            if let Some(e) = self.end_time {
                s.push('–');
                s.push_str(&fmt_time(e));
            }
        }
        s
    }

    /// Prüft und vereinheitlicht: Ende vor Beginn über Mitternacht, gleiches
    /// Enddatum entfällt, Ende ohne Beginnzeit ist ungültig.
    fn normalized(mut self) -> Option<When> {
        if self.start_time.is_none() && self.end_time.is_some() {
            return None;
        }
        if self.end_date == Some(self.start) {
            self.end_date = None;
        }
        match (self.end_date, self.start_time, self.end_time) {
            (None, Some(s), Some(e)) => {
                if e < s {
                    self.end_date = Some(self.start.succ_opt()?);
                } else if e == s {
                    self.end_time = None;
                }
            }
            (Some(ed), _, _) => {
                if ed < self.start {
                    return None;
                }
                if self.start_time.is_some() && self.end_time.is_some() && self.end_dt()? <= self.start_dt() {
                    return None;
                }
            }
            _ => {}
        }
        Some(self)
    }
}

/// Eine Seite der strengen Form: `Datum [T] [Uhrzeit]`.
fn strict_side(toks: &[Tok], i: usize) -> Option<(NaiveDate, Option<NaiveTime>, usize)> {
    let date = match toks.get(i)?.kind {
        Kind::Iso(y, m, d) => NaiveDate::from_ymd_opt(y, m, d)?,
        Kind::Dot3(d, m, y) => NaiveDate::from_ymd_opt(y, m, d)?,
        _ => return None,
    };
    let mut j = i + 1;
    let has_t = toks.get(j).is_some_and(|t| t.is_word(&["t"]));
    if has_t {
        j += 1;
    }
    if let Some(Kind::Colon(h, m)) = toks.get(j).map(|t| &t.kind) {
        return Some((date, Some(hm(*h, *m)?), j + 1));
    }
    if has_t {
        return None;
    }
    Some((date, None, j))
}

fn fmt_date(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn fmt_time(t: NaiveTime) -> String {
    t.format("%H:%M").to_string()
}

fn hm(h: u32, m: u32) -> Option<NaiveTime> {
    NaiveTime::from_hms_opt(h, m, 0)
}

const WD_DE: [&str; 7] = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WD_EN: [&str; 7] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

fn wd_de(w: Weekday) -> &'static str {
    WD_DE[w.num_days_from_monday() as usize]
}

fn wd_en(w: Weekday) -> &'static str {
    WD_EN[w.num_days_from_monday() as usize]
}

fn weekday_from_index(i: u32) -> Weekday {
    match i % 7 {
        0 => Weekday::Mon,
        1 => Weekday::Tue,
        2 => Weekday::Wed,
        3 => Weekday::Thu,
        4 => Weekday::Fri,
        5 => Weekday::Sat,
        _ => Weekday::Sun,
    }
}

/// „Fr 30.10.“ bzw. mit Jahr, wenn es vom laufenden abweicht.
fn date_abs_de(d: NaiveDate, year: i32) -> String {
    let mut s = format!("{} {}.{}.", wd_de(d.weekday()), d.day(), d.month());
    if d.year() != year {
        s.push_str(&d.year().to_string());
    }
    s
}

fn date_label_de(d: NaiveDate, today: NaiveDate) -> String {
    match (d - today).num_days() {
        0 => "Heute".into(),
        1 => "Morgen".into(),
        -1 => "Gestern".into(),
        _ => date_abs_de(d, today.year()),
    }
}

// ---------------------------------------------------------------------------
// Zerlegung in Wörter (Lexer)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Kind {
    /// Wort, klein geschrieben, Umlaute als ae/oe/ue, ß als ss.
    Word(String),
    /// Ganzzahl mit Anzahl der Ziffern.
    Int(u32, usize),
    /// „27.“
    IntDot(u32),
    /// „27.10“ oder „27.10.“ (mit Schlusspunkt)
    Dot2(u32, u32, bool),
    /// „27.10.2026“, „27.10.26“
    Dot3(u32, u32, i32),
    /// „14:00“
    Colon(u32, u32),
    /// „2026-10-27“
    Iso(i32, u32, u32),
    Dash,
    Comma,
    Other,
}

#[derive(Debug, Clone)]
struct Tok {
    kind: Kind,
    end: usize,
}

impl Tok {
    fn word(&self) -> Option<&str> {
        match &self.kind {
            Kind::Word(w) => Some(w),
            _ => None,
        }
    }

    fn is_word(&self, words: &[&str]) -> bool {
        self.word().is_some_and(|w| words.contains(&w))
    }
}

fn normalize_word(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars().flat_map(char::to_lowercase) {
        match c {
            'ä' => out.push_str("ae"),
            'ö' => out.push_str("oe"),
            'ü' => out.push_str("ue"),
            'ß' => out.push_str("ss"),
            '’' => out.push('\''),
            _ => out.push(c),
        }
    }
    out
}

fn digit_end(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    i
}

fn num(s: &str) -> u32 {
    s.parse().unwrap_or(u32::MAX)
}

fn lex(input: &str) -> Vec<Tok> {
    let b = input.as_bytes();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < input.len() {
        let Some(c) = input[i..].chars().next() else { break };
        let len = c.len_utf8();
        if c.is_whitespace() {
            i += len;
            continue;
        }
        let mut push = |kind: Kind, end: usize| toks.push(Tok { kind, end });
        if c.is_ascii_digit() {
            let e1 = digit_end(b, i);
            let n1 = &input[i..e1];
            // ISO-Datum 2026-10-27
            if n1.len() == 4 && b.get(e1) == Some(&b'-') {
                let e2 = digit_end(b, e1 + 1);
                if (1..=2).contains(&(e2 - e1 - 1)) && b.get(e2) == Some(&b'-') {
                    let e3 = digit_end(b, e2 + 1);
                    if (1..=2).contains(&(e3 - e2 - 1)) {
                        push(Kind::Iso(num(n1) as i32, num(&input[e1 + 1..e2]), num(&input[e2 + 1..e3])), e3);
                        i = e3;
                        continue;
                    }
                }
            }
            // Uhrzeit 14:00 (Sekunden werden überlesen)
            if n1.len() <= 2 && b.get(e1) == Some(&b':') {
                let e2 = digit_end(b, e1 + 1);
                if e2 - e1 - 1 == 2 {
                    let mut end = e2;
                    if b.get(e2) == Some(&b':') {
                        let e3 = digit_end(b, e2 + 1);
                        if e3 - e2 - 1 == 2 {
                            end = e3;
                        }
                    }
                    push(Kind::Colon(num(n1), num(&input[e1 + 1..e2])), end);
                    i = end;
                    continue;
                }
            }
            // 27.10.2026, 27.10., 27.10, 27.
            if n1.len() <= 2 && b.get(e1) == Some(&b'.') {
                let e2 = digit_end(b, e1 + 1);
                let l2 = e2 - e1 - 1;
                if (1..=2).contains(&l2) {
                    let n2 = num(&input[e1 + 1..e2]);
                    if b.get(e2) == Some(&b'.') {
                        let e3 = digit_end(b, e2 + 1);
                        let l3 = e3 - e2 - 1;
                        if l3 == 2 || l3 == 4 {
                            let y = num(&input[e2 + 1..e3]) as i32;
                            let y = if l3 == 2 { 2000 + y } else { y };
                            push(Kind::Dot3(num(n1), n2, y), e3);
                            i = e3;
                            continue;
                        }
                        if l3 == 0 {
                            push(Kind::Dot2(num(n1), n2, true), e2 + 1);
                            i = e2 + 1;
                            continue;
                        }
                    } else {
                        push(Kind::Dot2(num(n1), n2, false), e2);
                        i = e2;
                        continue;
                    }
                } else if l2 == 0 {
                    push(Kind::IntDot(num(n1)), e1 + 1);
                    i = e1 + 1;
                    continue;
                }
            }
            if n1.len() <= 6 {
                push(Kind::Int(num(n1), n1.len()), e1);
            } else {
                push(Kind::Other, e1);
            }
            i = e1;
            continue;
        }
        if c.is_alphabetic() || c == '\'' || c == '’' {
            let mut j = i;
            for (k, ch) in input[i..].char_indices() {
                if ch.is_alphabetic() || ch == '\'' || ch == '’' {
                    j = i + k + ch.len_utf8();
                } else {
                    break;
                }
            }
            let word = normalize_word(&input[i..j]);
            // Abkürzungspunkt („Fr.“, „Okt.“, „Std.“) gehört zum Wort.
            let mut end = j;
            if b.get(j) == Some(&b'.') && !b.get(j + 1).is_some_and(u8::is_ascii_digit) {
                end = j + 1;
            }
            push(Kind::Word(word), end);
            i = end;
            continue;
        }
        match c {
            ',' | ';' => push(Kind::Comma, i + len),
            '-' | '–' | '—' => push(Kind::Dash, i + len),
            '&' => push(Kind::Word("und".into()), i + len),
            _ => push(Kind::Other, i + len),
        }
        i += len;
    }
    toks
}

/// Darf nach diesem Byte geschnitten werden (Wortgrenze)?
fn cut_ok(input: &str, end: usize) -> bool {
    input[end..].chars().next().is_none_or(|c| !c.is_alphanumeric())
}

/// Längstes gültiges Präfix: probiert absteigend alle Schnittstellen.
fn longest_prefix<T>(input: &str, f: impl Fn(&[Tok]) -> Option<T>) -> Option<(T, usize)> {
    let toks = lex(input);
    let max = toks.len().min(MAX_PREFIX_TOKENS);
    for k in (1..=max).rev() {
        let last = &toks[k - 1];
        if matches!(last.kind, Kind::Comma | Kind::Dash | Kind::Other) || !cut_ok(input, last.end) {
            continue;
        }
        if let Some(v) = f(&toks[..k]) {
            return Some((v, last.end));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Wortlisten
// ---------------------------------------------------------------------------

fn weekday_word(w: &str) -> Option<Weekday> {
    Some(match w {
        "mo" | "mon" | "montag" | "monday" => Weekday::Mon,
        "di" | "tue" | "tues" | "dienstag" | "tuesday" => Weekday::Tue,
        "mi" | "wed" | "mittwoch" | "wednesday" => Weekday::Wed,
        "do" | "thu" | "thur" | "thurs" | "donnerstag" | "thursday" => Weekday::Thu,
        "fr" | "fri" | "freitag" | "friday" => Weekday::Fri,
        "sa" | "sat" | "samstag" | "sonnabend" | "saturday" => Weekday::Sat,
        "so" | "sun" | "sonntag" | "sunday" => Weekday::Sun,
        _ => return None,
    })
}

/// „montags“, „mondays“
fn weekday_plural(w: &str) -> Option<Weekday> {
    Some(match w {
        "montags" | "mondays" => Weekday::Mon,
        "dienstags" | "tuesdays" => Weekday::Tue,
        "mittwochs" | "wednesdays" => Weekday::Wed,
        "donnerstags" | "thursdays" => Weekday::Thu,
        "freitags" | "fridays" => Weekday::Fri,
        "samstags" | "sonnabends" | "saturdays" => Weekday::Sat,
        "sonntags" | "sundays" => Weekday::Sun,
        _ => return None,
    })
}

fn month_word(w: &str) -> Option<u32> {
    Some(match w {
        "januar" | "jan" | "january" | "jaenner" => 1,
        "februar" | "feb" | "february" | "feber" => 2,
        "maerz" | "marz" | "mrz" | "mar" | "march" => 3,
        "april" | "apr" => 4,
        "mai" | "may" => 5,
        "juni" | "jun" | "june" => 6,
        "juli" | "jul" | "july" => 7,
        "august" | "aug" => 8,
        "september" | "sep" | "sept" => 9,
        "oktober" | "okt" | "oct" | "october" => 10,
        "november" | "nov" => 11,
        "dezember" | "dez" | "dec" | "december" => 12,
        _ => return None,
    })
}

fn number_word(w: &str) -> Option<u32> {
    Some(match w {
        "ein" | "eine" | "einen" | "einem" | "einer" | "a" | "an" | "one" => 1,
        "zwei" | "zwo" | "two" => 2,
        "drei" | "three" => 3,
        "vier" | "four" => 4,
        "fuenf" | "five" => 5,
        "sechs" | "six" => 6,
        "sieben" | "seven" => 7,
        "acht" | "eight" => 8,
        "neun" | "nine" => 9,
        "zehn" | "ten" => 10,
        "elf" | "eleven" => 11,
        "zwoelf" | "twelve" => 12,
        _ => return None,
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Unit {
    Minute,
    Hour,
    Day,
    Week,
    Month,
    Year,
}

fn unit_word(w: &str) -> Option<Unit> {
    Some(match w {
        "m" | "min" | "mins" | "minute" | "minuten" | "minutes" => Unit::Minute,
        "h" | "std" | "stunde" | "stunden" | "hour" | "hours" | "hr" | "hrs" => Unit::Hour,
        "d" | "tag" | "tage" | "tagen" | "day" | "days" => Unit::Day,
        "w" | "woche" | "wochen" | "week" | "weeks" => Unit::Week,
        "monat" | "monate" | "monaten" | "month" | "months" => Unit::Month,
        "jahr" | "jahre" | "jahren" | "year" | "years" => Unit::Year,
        _ => None?,
    })
}

const RELATIVE_WORDS: &[&str] = &[
    "heute",
    "today",
    "morgen",
    "tomorrow",
    "uebermorgen",
    "gestern",
    "yesterday",
    "vorgestern",
    "naechste",
    "naechsten",
    "naechster",
    "naechstes",
    "next",
    "ende",
    "end",
];

// ---------------------------------------------------------------------------
// Natürlichsprachliche Datumseingabe
// ---------------------------------------------------------------------------

/// Natürlichsprachliche Eingabe (Deutsch + Englisch); die ganze Eingabe muss
/// ein Datum sein (Füllwörter wie „am“, „um“, „uhr“, „at“, „on“ erlaubt).
pub fn parse_natural(input: &str, now: NaiveDateTime) -> Option<When> {
    parse_tokens(&lex(input), now)
}

/// Längstes Präfix (auf Wortgrenze), das ein Datum ist; liefert das Datum und
/// die verbrauchten Bytes: „morgen 14 uhr Zahnarzt“ → „morgen 14 uhr“.
pub fn parse_natural_prefix(input: &str, now: NaiveDateTime) -> Option<(When, usize)> {
    longest_prefix(input, |t| parse_tokens(t, now))
}

/// Noch nicht aufgelöstes Datum (Wochentage und Daten ohne Jahr hängen vom
/// Bezugstag ab).
#[derive(Debug, Clone, Copy)]
enum DateSpec {
    Abs(NaiveDate),
    NoYear(u32, u32),
    DayOnly(u32),
    Wd(Weekday),
}

#[derive(Debug, Clone, Copy)]
struct TimeSpec {
    start: NaiveTime,
    end: Option<NaiveTime>,
    dur: Option<Duration>,
    /// Eindeutig eine Uhrzeit (mit Doppelpunkt, „uhr“, „um“ …); eine bloße
    /// Zahl gilt nur zusammen mit einem Datum.
    strong: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct Dt {
    date: Option<DateSpec>,
    time: Option<TimeSpec>,
}

struct Nl<'a> {
    t: &'a [Tok],
    today: NaiveDate,
}

fn parse_tokens(toks: &[Tok], now: NaiveDateTime) -> Option<When> {
    let last = toks.last()?;
    if matches!(last.kind, Kind::Comma | Kind::Dash | Kind::Other) {
        return None;
    }
    let p = Nl { t: toks, today: now.date() };
    let (dt1, mut i) = p.dt(0, false)?;
    let mut dt2 = None;
    if i < toks.len() && p.range_sep(i) {
        let (d, k) = p.dt(i + 1, true)?;
        dt2 = Some(d);
        i = k;
    }
    if i != toks.len() {
        return None;
    }
    build(dt1, dt2, now)
}

fn build(dt1: Dt, dt2: Option<Dt>, now: NaiveDateTime) -> Option<When> {
    let today = now.date();
    let start = match dt1.date {
        Some(spec) => resolve_start(spec, today)?,
        // Nur Uhrzeit: heute, oder morgen, wenn sie schon vorbei ist.
        None => {
            let t = dt1.time?;
            if t.start < now.time() { today.succ_opt()? } else { today }
        }
    };
    let mut w = When { start, start_time: None, end_date: None, end_time: None };
    if let Some(t) = dt1.time {
        w.start_time = Some(t.start);
        if let Some(e) = t.end {
            w.end_time = Some(e);
        } else if let Some(d) = t.dur {
            let end = w.start_dt().checked_add_signed(d)?;
            if end.date() != start {
                w.end_date = Some(end.date());
            }
            w.end_time = Some(end.time());
        }
    }
    if let Some(dt2) = dt2 {
        if w.end_time.is_some() || w.end_date.is_some() {
            return None;
        }
        if let Some(t2) = dt2.time
            && (t2.end.is_some() || t2.dur.is_some())
        {
            return None;
        }
        match (dt2.date, dt2.time) {
            (Some(spec), t2) => {
                // „14:00 – Mi“ ist unklar.
                dt1.date?;
                let ed = resolve_end(spec, start)?;
                if ed < start {
                    return None;
                }
                w.end_date = Some(ed);
                w.end_time = t2.map(|t| t.start);
            }
            (None, Some(t2)) => {
                w.start_time?;
                w.end_time = Some(t2.start);
            }
            (None, None) => return None,
        }
    }
    w.normalized()
}

fn add_days(d: NaiveDate, n: i64) -> Option<NaiveDate> {
    d.checked_add_signed(Duration::try_days(n)?)
}

fn add_months(d: NaiveDate, n: u32) -> Option<NaiveDate> {
    d.checked_add_months(Months::new(n))
}

/// Nächster Tag mit diesem Wochentag, frühestens morgen (1–7 Tage).
fn next_weekday_after(d: NaiveDate, wd: Weekday) -> Option<NaiveDate> {
    let cur = d.weekday().num_days_from_monday() as i64;
    let target = wd.num_days_from_monday() as i64;
    let mut diff = (target - cur).rem_euclid(7);
    if diff == 0 {
        diff = 7;
    }
    add_days(d, diff)
}

fn monday_of(d: NaiveDate) -> NaiveDate {
    add_days(d, -(d.weekday().num_days_from_monday() as i64)).unwrap_or(d)
}

fn last_of_month(y: i32, m: u32) -> Option<NaiveDate> {
    let first = NaiveDate::from_ymd_opt(y, m, 1)?;
    add_months(first, 1)?.pred_opt()
}

/// Erstes gültiges Datum (Jahr, Monat, Tag) ab diesem Jahr (29.2. springt ins
/// nächste Schaltjahr).
fn ymd_from(year: i32, m: u32, d: u32) -> Option<NaiveDate> {
    (0..8).find_map(|k| NaiveDate::from_ymd_opt(year + k, m, d))
}

fn resolve_start(spec: DateSpec, today: NaiveDate) -> Option<NaiveDate> {
    match spec {
        DateSpec::Abs(d) => Some(d),
        DateSpec::NoYear(d, m) => {
            let cand = ymd_from(today.year(), m, d)?;
            // Mehr als eine Woche vorbei → nächstes Jahr.
            if cand < add_days(today, -7)? { ymd_from(cand.year() + 1, m, d) } else { Some(cand) }
        }
        DateSpec::DayOnly(d) => first_day_on_or_after(today, d),
        DateSpec::Wd(wd) => next_weekday_after(today, wd),
    }
}

fn resolve_end(spec: DateSpec, start: NaiveDate) -> Option<NaiveDate> {
    match spec {
        DateSpec::Abs(d) => Some(d),
        DateSpec::NoYear(d, m) => {
            let cand = ymd_from(start.year(), m, d)?;
            if cand < start { ymd_from(cand.year() + 1, m, d) } else { Some(cand) }
        }
        DateSpec::DayOnly(d) => first_day_on_or_after(start, d),
        DateSpec::Wd(wd) => next_weekday_after(start, wd),
    }
}

/// Erster Tag `d` eines Monats ab `from` („am 3.“).
fn first_day_on_or_after(from: NaiveDate, d: u32) -> Option<NaiveDate> {
    let first = NaiveDate::from_ymd_opt(from.year(), from.month(), 1)?;
    (0..14).find_map(|k| {
        let m = add_months(first, k)?;
        NaiveDate::from_ymd_opt(m.year(), m.month(), d).filter(|c| *c >= from)
    })
}

impl Nl<'_> {
    fn tok(&self, i: usize) -> Option<&Tok> {
        self.t.get(i)
    }

    fn word(&self, i: usize) -> Option<&str> {
        self.t.get(i)?.word()
    }

    fn is(&self, i: usize, words: &[&str]) -> bool {
        self.t.get(i).is_some_and(|t| t.is_word(words))
    }

    fn range_sep(&self, i: usize) -> bool {
        self.tok(i).is_some_and(|t| t.kind == Kind::Dash) || self.is(i, &["bis", "to", "until", "till", "through", "thru"])
    }

    /// Datum und/oder Uhrzeit in beliebiger Reihenfolge.
    fn dt(&self, mut i: usize, ctx_date: bool) -> Option<(Dt, usize)> {
        let mut out = Dt::default();
        loop {
            let j = self.skip_fillers(i, true);
            if out.date.is_none()
                && let Some((d, k)) = self.date(j)
            {
                out.date = Some(d);
                i = k;
                continue;
            }
            if out.time.is_none()
                && let Some((t, k)) = self.time(j, out.date.is_some() || ctx_date)
            {
                out.time = Some(t);
                i = k;
                continue;
            }
            break;
        }
        // „morgen ganztägig“
        i = self.skip_fillers(i, false);
        if out.date.is_none() && out.time.is_none() {
            return None;
        }
        if let Some(t) = out.time
            && !t.strong
            && out.date.is_none()
            && !ctx_date
        {
            return None;
        }
        Some((out, i))
    }

    /// Überspringt „ganztägig“/„all day“ und (zwischen Teilen) Kommas.
    fn skip_fillers(&self, mut i: usize, commas: bool) -> usize {
        loop {
            match self.tok(i) {
                Some(t) if commas && t.kind == Kind::Comma => i += 1,
                Some(t) if t.is_word(&["ganztaegig", "ganztags", "ganztaegiger", "allday"]) => i += 1,
                Some(t) if t.is_word(&["all"]) && self.is(i + 1, &["day"]) => i += 2,
                _ => return i,
            }
        }
    }

    // --- Datum -------------------------------------------------------------

    fn date(&self, start: usize) -> Option<(DateSpec, usize)> {
        let mut i = start;
        // Einleitende Wörter; „bis“/„by“ nur ganz am Anfang („bis freitag“),
        // sonst trennen sie einen Zeitraum.
        while self.is(i, &["am", "on", "den", "the", "vom", "von", "from", "ab", "zum"])
            || (i == 0 && self.is(i, &["bis", "by", "until"]))
        {
            i += 1;
        }
        let today = self.today;
        let tok = self.tok(i)?;
        match &tok.kind {
            Kind::Iso(y, m, d) => Some((DateSpec::Abs(NaiveDate::from_ymd_opt(*y, *m, *d)?), i + 1)),
            Kind::Dot3(d, m, y) => Some((DateSpec::Abs(NaiveDate::from_ymd_opt(*y, *m, *d)?), i + 1)),
            Kind::Dot2(d, m, _) => {
                // „10.11 uhr“ ist eine Uhrzeit.
                if self.is(i + 1, &["uhr", "h"]) || !valid_day_month(*d, *m) {
                    return None;
                }
                Some((DateSpec::NoYear(*d, *m), i + 1))
            }
            Kind::IntDot(d) => {
                if let Some((spec, k)) = self.day_month_year(*d, i + 1) {
                    return Some((spec, k));
                }
                (1..=31).contains(d).then_some((DateSpec::DayOnly(*d), i + 1))
            }
            Kind::Int(d, len) if *len <= 2 => self.day_month_year(*d, i + 1),
            Kind::Word(w) => {
                let w = w.as_str();
                if let Some(wd) = weekday_word(w) {
                    return Some((DateSpec::Wd(wd), i + 1));
                }
                if let Some(m) = month_word(w) {
                    // „oct 27“, „october 27, 2026“, „okt 27.“
                    let d = match self.tok(i + 1)?.kind {
                        Kind::Int(d, len) if len <= 2 => d,
                        Kind::IntDot(d) => d,
                        _ => return None,
                    };
                    return self.with_year(d, m, i + 2);
                }
                let abs = |d: Option<NaiveDate>, k: usize| d.map(|d| (DateSpec::Abs(d), k));
                match w {
                    "heute" | "today" => abs(Some(today), i + 1),
                    "morgen" | "tomorrow" | "tmrw" => abs(add_days(today, 1), i + 1),
                    "uebermorgen" => abs(add_days(today, 2), i + 1),
                    "gestern" | "yesterday" => abs(add_days(today, -1), i + 1),
                    "vorgestern" => abs(add_days(today, -2), i + 1),
                    "in" => {
                        let (n, k) = self.number(i + 1)?;
                        let unit = unit_word(self.word(k)?)?;
                        let d = match unit {
                            Unit::Day => add_days(today, n as i64),
                            Unit::Week => add_days(today, 7 * n as i64),
                            Unit::Month => add_months(today, n),
                            Unit::Year => add_months(today, 12 * n),
                            _ => None,
                        };
                        abs(d, k + 1)
                    }
                    "naechste" | "naechsten" | "naechster" | "naechstes" | "next" | "kommende" | "kommenden"
                    | "kommender" | "kommendes" | "coming" | "this" | "diesen" | "diese" | "dieser" => {
                        let this = matches!(w, "this" | "diesen" | "diese" | "dieser");
                        let nw = self.word(i + 1)?;
                        if let Some(wd) = weekday_word(nw) {
                            return Some((DateSpec::Wd(wd), i + 2));
                        }
                        if matches!(nw, "wochenende" | "weekend") {
                            return abs(upcoming_saturday(today), i + 2);
                        }
                        if this {
                            return None;
                        }
                        let d = match nw {
                            "woche" | "week" => add_days(monday_of(today), 7),
                            "monat" | "month" => add_months(NaiveDate::from_ymd_opt(today.year(), today.month(), 1)?, 1),
                            "jahr" | "year" => NaiveDate::from_ymd_opt(today.year() + 1, 1, 1),
                            _ => None,
                        };
                        abs(d, i + 2)
                    }
                    "uebernaechste" | "uebernaechsten" | "uebernaechster" | "uebernaechstes" => {
                        let nw = self.word(i + 1)?;
                        if let Some(wd) = weekday_word(nw) {
                            return abs(add_days(next_weekday_after(today, wd)?, 7), i + 2);
                        }
                        match nw {
                            "woche" => abs(add_days(monday_of(today), 14), i + 2),
                            _ => None,
                        }
                    }
                    "ende" | "end" => {
                        let mut k = i + 1;
                        let mut n = 0;
                        while n < 2 && self.is(k, &["der", "des", "dieser", "diesen", "of", "the", "this"]) {
                            k += 1;
                            n += 1;
                        }
                        if let Some(Kind::Int(y, 4)) = self.tok(k).map(|t| &t.kind) {
                            return abs(NaiveDate::from_ymd_opt(*y as i32, 12, 31), k + 1);
                        }
                        let d = match self.word(k)? {
                            "woche" | "week" => end_of_week(today),
                            "monats" | "monat" | "month" => last_of_month(today.year(), today.month()),
                            "jahres" | "jahr" | "year" => NaiveDate::from_ymd_opt(today.year(), 12, 31),
                            _ => None,
                        };
                        abs(d, k + 1)
                    }
                    "monatsende" => abs(last_of_month(today.year(), today.month()), i + 1),
                    "jahresende" => abs(NaiveDate::from_ymd_opt(today.year(), 12, 31), i + 1),
                    "wochenende" | "weekend" => abs(upcoming_saturday(today), i + 1),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Tag, gefolgt von Monatsname und optional Jahr: „27. oktober 2026“.
    fn day_month_year(&self, d: u32, i: usize) -> Option<(DateSpec, usize)> {
        let m = month_word(self.word(i)?)?;
        self.with_year(d, m, i + 1)
    }

    /// Optionales Jahr (vierstellig, auch nach Komma) hinter Tag und Monat.
    fn with_year(&self, d: u32, m: u32, i: usize) -> Option<(DateSpec, usize)> {
        if !valid_day_month(d, m) {
            return None;
        }
        let mut k = i;
        if self.tok(k).is_some_and(|t| t.kind == Kind::Comma) {
            k += 1;
        }
        if let Some(Kind::Int(y, 4)) = self.tok(k).map(|t| &t.kind) {
            return Some((DateSpec::Abs(NaiveDate::from_ymd_opt(*y as i32, m, d)?), k + 1));
        }
        Some((DateSpec::NoYear(d, m), i))
    }

    /// Zahl als Ziffern oder Zahlwort.
    fn number(&self, i: usize) -> Option<(u32, usize)> {
        match &self.tok(i)?.kind {
            Kind::Int(n, _) => Some((*n, i + 1)),
            Kind::Word(w) => number_word(w).map(|n| (n, i + 1)),
            _ => None,
        }
    }

    /// Beginnt hier ein Datum? (für „9 am freitag“: „am“ ist dann kein AM)
    fn date_starts(&self, i: usize) -> bool {
        match self.tok(i).map(|t| &t.kind) {
            Some(Kind::Word(w)) => {
                weekday_word(w).is_some() || month_word(w).is_some() || RELATIVE_WORDS.contains(&w.as_str())
            }
            Some(Kind::Int(..) | Kind::IntDot(_) | Kind::Dot2(..) | Kind::Dot3(..) | Kind::Iso(..)) => true,
            _ => false,
        }
    }

    // --- Uhrzeit -----------------------------------------------------------

    fn time(&self, start: usize, ctx_date: bool) -> Option<(TimeSpec, usize)> {
        let mut i = start;
        let mut intro = false;
        if self.is(i, &["um", "at", "gegen", "ab", "von", "from"]) {
            intro = true;
            i += 1;
        }
        let (v, mut i) = self.time_value(i, intro || ctx_date)?;
        let mut ts = TimeSpec { start: hm(v.h, v.m)?, end: None, dur: None, strong: intro || v.strong };
        // Zeitspanne „14-15 uhr“, „14:00 – 15:30“, „2-4pm“
        if self.range_sep(i)
            && let Some((e, k)) = self.time_value(i + 1, true)
        {
            let mut sh = v.h;
            if e.pm && !v.ampm && sh < 12 && sh + 12 <= e.h {
                sh += 12;
            }
            if let (Some(s), Some(et)) = (hm(sh, v.m), hm(e.h, e.m)) {
                ts.start = s;
                ts.end = Some(et);
                ts.strong = ts.strong || e.strong;
                i = k;
            }
        } else if ts.end.is_none() {
            // Dauer „für 2h“, „for 90 min“, „2h“
            let mut k = i;
            let explicit = self.is(k, &["fuer", "for"]);
            if explicit {
                k += 1;
            }
            if let Some((d, k2)) = self.duration(k) {
                ts.dur = Some(d);
                i = k2;
            }
        }
        Some((ts, i))
    }

    /// Ein Uhrzeitwert mit Zusätzen („uhr“, „h“, „pm“).
    fn time_value(&self, i: usize, ctx: bool) -> Option<(TimeVal, usize)> {
        let tok = self.tok(i)?;
        let (mut h, mut m, mut strong, mut k) = match &tok.kind {
            Kind::Colon(h, m) => (*h, *m, true, i + 1),
            // „14.30“ – als Datum unmöglich oder durch Zusammenhang eine Uhrzeit
            Kind::Dot2(h, m, false) => {
                let date_like = valid_day_month(*h, *m);
                if date_like && !ctx && !self.is(i + 1, &["uhr", "h"]) {
                    return None;
                }
                (*h, *m, !date_like, i + 1)
            }
            Kind::Int(h, len) if *len <= 2 => (*h, 0, false, i + 1),
            Kind::Word(w) => match w.as_str() {
                "mittag" | "mittags" | "noon" => (12, 0, true, i + 1),
                "mitternacht" | "midnight" => (0, 0, true, i + 1),
                _ => return None,
            },
            _ => return None,
        };
        if h > 23 || m > 59 {
            return None;
        }
        let mut ampm = false;
        let mut pm = false;
        match self.word(k) {
            Some("uhr" | "oclock" | "o'clock") => {
                strong = true;
                k += 1;
                // „14 uhr 30“
                if let Some(Kind::Int(mm, 2)) = self.tok(k).map(|t| &t.kind)
                    && *mm < 60
                    && m == 0
                    && !self.word(k + 1).is_some_and(|w| unit_word(w).is_some())
                {
                    m = *mm;
                    k += 1;
                }
            }
            Some("h") if matches!(tok.kind, Kind::Int(..)) => {
                strong = true;
                k += 1;
                if let Some(Kind::Int(mm, 2)) = self.tok(k).map(|t| &t.kind)
                    && *mm < 60
                {
                    m = *mm;
                    k += 1;
                }
            }
            Some("pm" | "p") if h <= 12 => {
                strong = true;
                ampm = true;
                pm = true;
                if h < 12 {
                    h += 12;
                }
                k += 1;
            }
            Some("am" | "a") if h <= 12 && !self.date_starts(k + 1) => {
                strong = true;
                ampm = true;
                if h == 12 {
                    h = 0;
                }
                k += 1;
            }
            _ => {}
        }
        Some((TimeVal { h, m, strong, ampm, pm }, k))
    }

    /// Dauer aus Zahl-Einheit-Paaren: „2h“, „1h30m“, „90 min“, „eine stunde“.
    fn duration(&self, mut i: usize) -> Option<(Duration, usize)> {
        let mut total = Duration::zero();
        let mut any = false;
        loop {
            let (n, k) = match self.number(i) {
                Some(v) => v,
                None if self.is(i, &["halbe"]) && self.is(i + 1, &["stunde"]) => {
                    total += Duration::try_minutes(30)?;
                    i += 2;
                    any = true;
                    continue;
                }
                None => break,
            };
            let Some(unit) = self.word(k).and_then(unit_word) else { break };
            total += unit_duration(n, unit)?;
            i = k + 1;
            any = true;
        }
        any.then_some((total, i))
    }
}

#[derive(Debug, Clone, Copy)]
struct TimeVal {
    h: u32,
    m: u32,
    strong: bool,
    ampm: bool,
    pm: bool,
}

fn unit_duration(n: u32, unit: Unit) -> Option<Duration> {
    let n = n as i64;
    match unit {
        Unit::Minute => Duration::try_minutes(n),
        Unit::Hour => Duration::try_hours(n),
        Unit::Day => Duration::try_days(n),
        Unit::Week => Duration::try_weeks(n),
        Unit::Month | Unit::Year => None,
    }
}

fn valid_day_month(d: u32, m: u32) -> bool {
    (1..=31).contains(&d) && (1..=12).contains(&m) && (0..8).any(|k| NaiveDate::from_ymd_opt(2024 + k, m, d).is_some())
}

/// Freitag dieser Woche (am Wochenende: der nächste).
fn end_of_week(today: NaiveDate) -> Option<NaiveDate> {
    let wd = today.weekday().num_days_from_monday() as i64;
    if wd <= 4 { add_days(today, 4 - wd) } else { add_days(today, 11 - wd) }
}

/// Samstag dieses Wochenendes (am Wochenende: heute).
fn upcoming_saturday(today: NaiveDate) -> Option<NaiveDate> {
    let wd = today.weekday().num_days_from_monday() as i64;
    if wd >= 5 { Some(today) } else { add_days(today, 5 - wd) }
}

// ---------------------------------------------------------------------------
// Wiederholung – Wert von `repeat::`
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatUnit {
    Day,
    Week,
    Month,
    Year,
}

/// Wert des Felds `repeat::`. `workdays`: täglich Mo–Fr (Einheit Tag).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repeat {
    pub every: u32,
    pub unit: RepeatUnit,
    pub weekdays: Vec<Weekday>,
    pub workdays: bool,
    pub until: Option<NaiveDate>,
}

impl Repeat {
    fn new(every: u32, unit: RepeatUnit) -> Repeat {
        Repeat { every, unit, weekdays: Vec::new(), workdays: false, until: None }
    }

    /// Kanonische Form und tolerante deutsche/englische Varianten.
    pub fn parse(s: &str) -> Option<Repeat> {
        parse_repeat_tokens(&lex(s))
    }

    /// Längstes Präfix, das eine Wiederholung ist, mit verbrauchten Bytes.
    pub fn parse_prefix(s: &str) -> Option<(Repeat, usize)> {
        longest_prefix(s, parse_repeat_tokens)
    }

    /// Kanonisch: „weekly on mon,thu until 2026-12-31“.
    pub fn format(&self) -> String {
        let n = self.every;
        let mut s = if self.workdays {
            "weekdays".to_string()
        } else {
            let (one, many) = match self.unit {
                RepeatUnit::Day => ("daily", "days"),
                RepeatUnit::Week => ("weekly", "weeks"),
                RepeatUnit::Month => ("monthly", "months"),
                RepeatUnit::Year => ("yearly", "years"),
            };
            if n <= 1 { one.to_string() } else { format!("every {n} {many}") }
        };
        if self.unit == RepeatUnit::Week && !self.weekdays.is_empty() {
            let days: Vec<&str> = self.weekdays.iter().map(|w| wd_en(*w)).collect();
            s.push_str(" on ");
            s.push_str(&days.join(","));
        }
        if let Some(u) = self.until {
            s.push_str(" until ");
            s.push_str(&fmt_date(u));
        }
        s
    }

    /// Für die Oberfläche: „wöchentlich (Mo, Do)“, „alle 2 Wochen“.
    pub fn human_de(&self) -> String {
        let n = self.every;
        let mut s = if self.workdays {
            "werktags".to_string()
        } else {
            let (one, many) = match self.unit {
                RepeatUnit::Day => ("täglich", "Tage"),
                RepeatUnit::Week => ("wöchentlich", "Wochen"),
                RepeatUnit::Month => ("monatlich", "Monate"),
                RepeatUnit::Year => ("jährlich", "Jahre"),
            };
            if n <= 1 { one.to_string() } else { format!("alle {n} {many}") }
        };
        if self.unit == RepeatUnit::Week && !self.weekdays.is_empty() {
            let days: Vec<&str> = self.weekdays.iter().map(|w| wd_de(*w)).collect();
            s.push_str(&format!(" ({})", days.join(", ")));
        }
        if let Some(u) = self.until {
            s.push_str(&format!(" bis {}.{}.{}", u.day(), u.month(), u.year()));
        }
        s
    }

    /// Gehört dieser Tag (ab dem Anker) zur Serie? Der Anker selbst immer.
    fn matches(&self, anchor: NaiveDate, d: NaiveDate) -> bool {
        if d == anchor {
            return true;
        }
        if d < anchor {
            return false;
        }
        let every = self.every.max(1) as i64;
        match self.unit {
            RepeatUnit::Day if self.workdays => d.weekday().num_days_from_monday() < 5,
            RepeatUnit::Day => (d - anchor).num_days() % every == 0,
            RepeatUnit::Week if self.weekdays.is_empty() => (d - anchor).num_days() % (7 * every) == 0,
            RepeatUnit::Week => {
                let weeks = (monday_of(d) - monday_of(anchor)).num_days() / 7;
                self.weekdays.contains(&d.weekday()) && weeks % every == 0
            }
            // Monat und Jahr werden direkt berechnet (siehe `next_after`).
            RepeatUnit::Month | RepeatUnit::Year => false,
        }
    }

    /// Nächster Beginn strikt nach `after` (Anker = ursprüngliches Datum).
    /// `None`, wenn `until` überschritten ist.
    pub fn next_after(&self, anchor: &When, after: NaiveDate) -> Option<NaiveDate> {
        let a = anchor.start;
        let every = self.every.max(1);
        let cand = if after < a {
            a
        } else {
            match self.unit {
                RepeatUnit::Day if !self.workdays => step_days(a, after, every as i64)?,
                RepeatUnit::Week if self.weekdays.is_empty() => step_days(a, after, 7 * every as i64)?,
                RepeatUnit::Day | RepeatUnit::Week => {
                    let mut d = after.succ_opt()?;
                    let limit = 7 * every as usize + 8;
                    let mut found = None;
                    for _ in 0..limit {
                        if self.matches(a, d) {
                            found = Some(d);
                            break;
                        }
                        d = d.succ_opt()?;
                    }
                    found?
                }
                RepeatUnit::Month => step_months(a, after, every)?,
                RepeatUnit::Year => step_months(a, after, 12 * every)?,
            }
        };
        match self.until {
            Some(u) if cand > u => None,
            _ => Some(cand),
        }
    }

    /// Alle Vorkommen, deren Zeitraum den Bereich [from, to] berührt.
    pub fn occurrences(&self, anchor: &When, from: NaiveDate, to: NaiveDate) -> Vec<When> {
        let mut out = Vec::new();
        let span = (anchor.last_day() - anchor.start).num_days();
        let Some(lower) = add_days(from, -span) else { return out };
        let mut cur = match lower.pred_opt() {
            Some(p) => self.next_after(anchor, p),
            None => Some(anchor.start),
        };
        while let Some(s) = cur {
            if s > to || out.len() >= 10_000 {
                break;
            }
            out.push(anchor.shift_to(s));
            cur = self.next_after(anchor, s);
        }
        out
    }
}

/// Erster Tag `a + k·n` (k ≥ 1) nach `after` (≥ a).
fn step_days(a: NaiveDate, after: NaiveDate, n: i64) -> Option<NaiveDate> {
    let diff = (after - a).num_days();
    let k = diff / n + 1;
    add_days(a, k * n)
}

/// Erster Termin `a + k·n Monate` nach `after`; Monatsenden ohne Wandern
/// (31.1. → 28.2. → 31.3.).
fn step_months(a: NaiveDate, after: NaiveDate, n: u32) -> Option<NaiveDate> {
    let diff = (after.year() - a.year()) * 12 + after.month() as i32 - a.month() as i32;
    let first = (diff.max(0) as u32 / n).saturating_sub(1);
    for k in (first..).take(4) {
        let d = add_months(a, k.checked_mul(n)?)?;
        if d > after {
            return Some(d);
        }
    }
    None
}

fn parse_repeat_tokens(toks: &[Tok]) -> Option<Repeat> {
    let p = Nl { t: toks, today: NaiveDate::MIN };
    let (mut r, mut i) = p.repeat_base(0)?;
    // „weekly on mon,thu“, „wöchentlich am mo und do“
    if r.unit == RepeatUnit::Week
        && r.weekdays.is_empty()
        && p.is(i, &["on", "am", "an"])
        && let Some((days, k)) = p.weekday_list(i + 1, false)
    {
        r.weekdays = days;
        i = k;
    }
    // „until 2026-12-31“, „bis 31.12.2026“, „bis ende 2026“
    if p.is(i, &["until", "bis", "till", "through"]) {
        let mut k = i + 1;
        if p.is(k, &["zum", "einschliesslich", "inkl"]) {
            k += 1;
        }
        let (u, k) = p.date_with_year(k)?;
        r.until = Some(u);
        i = k;
    }
    if i != toks.len() || r.every == 0 || r.every > 999 {
        return None;
    }
    Some(r)
}

impl Nl<'_> {
    fn repeat_base(&self, i: usize) -> Option<(Repeat, usize)> {
        let w = self.word(i);
        let simple = |every, unit| Some((Repeat::new(every, unit), i + 1));
        match w {
            Some("daily" | "taeglich") => return simple(1, RepeatUnit::Day),
            Some("weekdays" | "werktags" | "workdays" | "werktaeglich") => {
                let mut r = Repeat::new(1, RepeatUnit::Day);
                r.workdays = true;
                return Some((r, i + 1));
            }
            Some("weekly" | "woechentlich") => return simple(1, RepeatUnit::Week),
            Some("biweekly" | "fortnightly" | "zweiwoechentlich" | "vierzehntaegig") => return simple(2, RepeatUnit::Week),
            Some("monthly" | "monatlich") => return simple(1, RepeatUnit::Month),
            Some("quarterly" | "quartalsweise" | "vierteljaehrlich") => return simple(3, RepeatUnit::Month),
            Some("yearly" | "annually" | "annual" | "jaehrlich") => return simple(1, RepeatUnit::Year),
            _ => {}
        }
        // „14-tägig“
        if let Some(Kind::Int(14, _)) = self.tok(i).map(|t| &t.kind)
            && self.tok(i + 1).is_some_and(|t| t.kind == Kind::Dash)
            && self.is(i + 2, &["taegig", "taegige", "taegiges"])
        {
            return Some((Repeat::new(2, RepeatUnit::Week), i + 3));
        }
        // „montags und donnerstags“, „mondays“
        if let Some((days, k)) = self.weekday_list(i, true) {
            let mut r = Repeat::new(1, RepeatUnit::Week);
            r.weekdays = days;
            return Some((r, k));
        }
        if !self.is(i, &["jeden", "jede", "jedes", "jeder", "every", "each", "alle", "an"]) {
            return None;
        }
        let j = i + 1;
        // „every other week“
        let (n, k) = if self.is(j, &["other"]) {
            (Some(2), j + 1)
        } else {
            match self.tok(j).map(|t| &t.kind) {
                Some(Kind::IntDot(n)) => (Some(*n), j + 1),
                Some(Kind::Int(..)) => {
                    let (n, k) = self.number(j)?;
                    (Some(n), k)
                }
                // „jeden zweiten …“ wird nicht unterstützt; Zahlwörter schon.
                Some(Kind::Word(w)) if number_word(w).is_some() && !matches!(w.as_str(), "a" | "an") => {
                    let next = self.word(j + 1);
                    if next.is_some_and(|nw| unit_word(nw).is_some() || is_workday_word(nw)) {
                        (number_word(w), j + 1)
                    } else {
                        (None, j)
                    }
                }
                _ => (None, j),
            }
        };
        if let Some(uw) = self.word(k) {
            if is_workday_word(uw) {
                if n.is_some_and(|n| n != 1) {
                    return None;
                }
                let mut r = Repeat::new(1, RepeatUnit::Day);
                r.workdays = true;
                return Some((r, k + 1));
            }
            if let Some(unit) = unit_word(uw) {
                let unit = match unit {
                    Unit::Day => RepeatUnit::Day,
                    Unit::Week => RepeatUnit::Week,
                    Unit::Month => RepeatUnit::Month,
                    Unit::Year => RepeatUnit::Year,
                    Unit::Minute | Unit::Hour => return None,
                };
                return Some((Repeat::new(n.unwrap_or(1), unit), k + 1));
            }
        }
        // „jeden montag“, „every mon and thu“, „alle 2 wochen“ schon oben
        if n.is_none()
            && let Some((days, k2)) = self.weekday_list(k, false)
        {
            let mut r = Repeat::new(1, RepeatUnit::Week);
            r.weekdays = days;
            return Some((r, k2));
        }
        None
    }

    /// Wochentagsliste „mo, do“, „montag und donnerstag“, „mo-fr“.
    fn weekday_list(&self, i: usize, plural: bool) -> Option<(Vec<Weekday>, usize)> {
        let get = |k: usize| -> Option<Weekday> {
            let w = self.word(k)?;
            if plural { weekday_plural(w) } else { weekday_word(w).or_else(|| weekday_plural(w)) }
        };
        let mut days = vec![get(i)?];
        let mut k = i + 1;
        loop {
            let sep_comma = self.tok(k).is_some_and(|t| t.kind == Kind::Comma) || self.is(k, &["und", "and"]);
            let sep_range = self.tok(k).is_some_and(|t| t.kind == Kind::Dash) || self.is(k, &["bis", "to"]);
            if !(sep_comma || sep_range) {
                break;
            }
            let Some(next) = get(k + 1) else { break };
            if sep_range {
                // Bereich einschließlich: „mo-fr“
                let (Some(&from), to) = (days.last(), next.num_days_from_monday()) else { break };
                let mut x = from.num_days_from_monday();
                while x != to {
                    x = (x + 1) % 7;
                    days.push(weekday_from_index(x));
                }
            } else {
                days.push(next);
            }
            k += 2;
        }
        days.sort_by_key(|w| w.num_days_from_monday());
        days.dedup();
        Some((days, k))
    }

    /// Absolutes Datum mit Jahr (für „until“): ISO, 31.12.2026, „ende 2026“,
    /// „31. dezember 2026“, „dec 31, 2026“.
    fn date_with_year(&self, i: usize) -> Option<(NaiveDate, usize)> {
        match &self.tok(i)?.kind {
            Kind::Iso(y, m, d) => Some((NaiveDate::from_ymd_opt(*y, *m, *d)?, i + 1)),
            Kind::Dot3(d, m, y) => Some((NaiveDate::from_ymd_opt(*y, *m, *d)?, i + 1)),
            Kind::Word(w) if matches!(w.as_str(), "ende" | "end") => {
                let mut k = i + 1;
                if self.is(k, &["of"]) {
                    k += 1;
                }
                match self.tok(k)?.kind {
                    Kind::Int(y, 4) => Some((NaiveDate::from_ymd_opt(y as i32, 12, 31)?, k + 1)),
                    _ => None,
                }
            }
            _ => match self.date(i)? {
                (DateSpec::Abs(d), k) => Some((d, k)),
                _ => None,
            },
        }
    }
}

fn is_workday_word(w: &str) -> bool {
    matches!(
        w,
        "werktag" | "werktage" | "werktagen" | "arbeitstag" | "arbeitstage" | "arbeitstagen" | "weekday" | "weekdays" | "workday" | "workdays"
    )
}

// ---------------------------------------------------------------------------
// Erinnerung – Wert von `remind::`
// ---------------------------------------------------------------------------

/// Erinnerung: relativ vor Beginn oder zu einem festen Zeitpunkt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Remind {
    Before(Duration),
    At(NaiveDateTime),
}

impl Remind {
    /// „15m“, „1 std“, „30 minuten vorher“, „beginn“, „2026-10-27 08:00“,
    /// „morgen 8 uhr“ (ohne Uhrzeit: 09:00).
    pub fn parse(s: &str, now: NaiveDateTime) -> Option<Remind> {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }
        let toks = lex(s);
        if let Some(d) = parse_before(&toks) {
            return Some(Remind::Before(d));
        }
        let w = When::parse(s).or_else(|| parse_natural(s, now))?;
        let (h, m) = DEFAULT_REMIND_TIME;
        let t = w.start_time.or_else(|| hm(h, m))?;
        Some(Remind::At(w.start.and_time(t)))
    }

    /// Mehrere, durch Komma getrennt; ungültige Teile entfallen.
    pub fn parse_list(s: &str, now: NaiveDateTime) -> Vec<Remind> {
        s.split([',', ';']).filter_map(|p| Remind::parse(p, now)).collect()
    }

    /// Kanonisch: „15m“, „1h30m“, „1d“, „0“, „2026-10-27 08:00“.
    pub fn format(&self) -> String {
        match self {
            Remind::At(dt) => dt.format("%Y-%m-%d %H:%M").to_string(),
            Remind::Before(d) => {
                let mins = d.num_minutes().abs();
                if mins == 0 {
                    return "0".into();
                }
                let (days, h, m) = (mins / 1440, (mins % 1440) / 60, mins % 60);
                let mut s = String::new();
                if days > 0 {
                    s.push_str(&format!("{days}d"));
                }
                if h > 0 {
                    s.push_str(&format!("{h}h"));
                }
                if m > 0 {
                    s.push_str(&format!("{m}m"));
                }
                s
            }
        }
    }

    pub fn format_list(list: &[Remind]) -> String {
        list.iter().map(Remind::format).collect::<Vec<_>>().join(", ")
    }

    /// Für die Oberfläche: „15 Min. vorher“, „1 Tag vorher“, „zu Beginn“.
    pub fn human_de(&self) -> String {
        match self {
            Remind::At(dt) => format!("{}.{}. {}", dt.day(), dt.month(), dt.format("%H:%M")),
            Remind::Before(d) => {
                let mins = d.num_minutes().abs();
                if mins == 0 {
                    return "zu Beginn".into();
                }
                let (days, h, m) = (mins / 1440, (mins % 1440) / 60, mins % 60);
                let mut parts = Vec::new();
                if days > 0 {
                    parts.push(if days == 1 { "1 Tag".to_string() } else { format!("{days} Tage") });
                }
                if h > 0 {
                    parts.push(format!("{h} Std."));
                }
                if m > 0 {
                    parts.push(format!("{m} Min."));
                }
                format!("{} vorher", parts.join(" "))
            }
        }
    }

    /// Zeitpunkt für ein Vorkommen; ganztägige Einträge rechnen ab
    /// `all_day_time`.
    pub fn instant(&self, occ: &When, all_day_time: NaiveTime) -> NaiveDateTime {
        match self {
            Remind::At(dt) => *dt,
            Remind::Before(d) => {
                let base = if occ.is_all_day() { occ.start.and_time(all_day_time) } else { occ.start_dt() };
                base.checked_sub_signed(*d).unwrap_or(base)
            }
        }
    }
}

/// Relative Erinnerung: Dauer, bloße Zahl (Minuten) oder „zu Beginn“.
fn parse_before(toks: &[Tok]) -> Option<Duration> {
    let p = Nl { t: toks, today: NaiveDate::MIN };
    let mut i = 0;
    if p.is(i, &["zu", "bei", "at", "on"]) && p.is(i + 1, &["beginn", "start", "time"]) {
        i += 1;
    }
    let d = if p.is(i, &["beginn", "start", "puenktlich", "sofort"]) {
        i += 1;
        Duration::zero()
    } else if let Some((d, k)) = p.duration(i) {
        i = k;
        d
    } else if let Some(Kind::Int(n, _)) = p.tok(i).map(|t| &t.kind) {
        // Bloße Zahl: Minuten
        i += 1;
        Duration::try_minutes(*n as i64)?
    } else {
        return None;
    };
    if p.is(i, &["vorher", "davor", "before", "frueher", "prior", "earlier", "zuvor"]) {
        i += 1;
    }
    (i == toks.len()).then_some(d)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn t(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    /// Montag, 26.10.2026, 10:00
    fn now() -> NaiveDateTime {
        d(2026, 10, 26).and_time(t(10, 0))
    }

    fn nl(s: &str) -> Option<String> {
        parse_natural(s, now()).map(|w| w.format())
    }

    fn check(s: &str, expected: &str) {
        assert_eq!(nl(s).as_deref(), Some(expected), "Eingabe: {s:?}");
    }

    fn none(s: &str) {
        assert_eq!(nl(s), None, "Eingabe: {s:?} sollte kein Datum sein");
    }

    // --- When: kanonische Form --------------------------------------------

    #[test]
    fn when_roundtrip_canonical() {
        for s in [
            "2026-10-27",
            "2026-10-27 14:00",
            "2026-10-27 14:00-15:30",
            "2026-10-27 - 2026-10-29",
            "2026-10-27 22:00 - 2026-10-28 02:00",
            "2026-10-27 14:00 - 2026-10-29",
            "2024-02-29",
        ] {
            let w = When::parse(s).unwrap_or_else(|| panic!("{s}"));
            assert_eq!(w.format(), s);
        }
    }

    #[test]
    fn when_parse_tolerant() {
        let p = |s: &str| When::parse(s).map(|w| w.format());
        assert_eq!(p("27.10.2026").as_deref(), Some("2026-10-27"));
        assert_eq!(p("27.10.2026 14:00").as_deref(), Some("2026-10-27 14:00"));
        assert_eq!(p("27.10.26 9:05").as_deref(), Some("2026-10-27 09:05"));
        assert_eq!(p("2026-10-27T14:00").as_deref(), Some("2026-10-27 14:00"));
        assert_eq!(p("2026-10-27T14:00:00").as_deref(), Some("2026-10-27 14:00"));
        assert_eq!(p("2026-10-27 14:00 - 15:30").as_deref(), Some("2026-10-27 14:00-15:30"));
        assert_eq!(p("2026-10-27 14:00 – 15:30").as_deref(), Some("2026-10-27 14:00-15:30"));
        assert_eq!(p("  2026-10-27  ").as_deref(), Some("2026-10-27"));
        assert_eq!(p("2026-10-27 bis 2026-10-29").as_deref(), Some("2026-10-27 - 2026-10-29"));
        // Über Mitternacht
        assert_eq!(p("2026-10-27 22:00-02:00").as_deref(), Some("2026-10-27 22:00 - 2026-10-28 02:00"));
        // Gleiches Enddatum entfällt
        assert_eq!(p("2026-10-27 - 2026-10-27").as_deref(), Some("2026-10-27"));
        assert_eq!(p("2026-10-27 14:00 - 2026-10-27 15:00").as_deref(), Some("2026-10-27 14:00-15:00"));
    }

    #[test]
    fn when_parse_invalid() {
        for s in [
            "",
            "foo",
            "2026-13-01",
            "2026-02-30",
            "2026-10-27 25:00",
            "2026-10-27 14:60",
            "2026-10-27 - 2026-10-20",
            "2026-10-27 extra",
            "2026-10-27T",
            "2026-10-27 - 15:00",
            "14:00",
        ] {
            assert_eq!(When::parse(s), None, "{s:?}");
        }
    }

    #[test]
    fn when_accessors() {
        let w = When::parse("2026-10-27 14:00-15:30").unwrap();
        assert!(!w.is_all_day());
        assert_eq!(w.start_dt(), d(2026, 10, 27).and_time(t(14, 0)));
        assert_eq!(w.end_dt(), Some(d(2026, 10, 27).and_time(t(15, 30))));
        assert_eq!(w.last_day(), d(2026, 10, 27));

        let all = When::parse("2026-10-27").unwrap();
        assert!(all.is_all_day());
        assert_eq!(all.start_dt(), d(2026, 10, 27).and_time(t(0, 0)));
        assert_eq!(all.end_dt(), None);

        let multi = When::parse("2026-10-27 - 2026-10-29").unwrap();
        assert_eq!(multi.last_day(), d(2026, 10, 29));
        assert_eq!(multi.end_dt(), Some(d(2026, 10, 30).and_time(t(0, 0))));

        let night = When::parse("2026-10-27 22:00-02:00").unwrap();
        assert_eq!(night.last_day(), d(2026, 10, 28));
        assert_eq!(night.end_dt(), Some(d(2026, 10, 28).and_time(t(2, 0))));
    }

    #[test]
    fn when_shift() {
        let w = When::parse("2026-10-27 22:00 - 2026-10-29 02:00").unwrap();
        assert_eq!(w.shift_to(d(2026, 11, 3)).format(), "2026-11-03 22:00 - 2026-11-05 02:00");
        let w = When::parse("2026-10-27 14:00-15:00").unwrap();
        assert_eq!(w.shift_to(d(2027, 1, 1)).format(), "2027-01-01 14:00-15:00");
    }

    #[test]
    fn when_human() {
        let today = d(2026, 10, 26);
        let h = |s: &str, today| When::parse(s).unwrap().human_de(today);
        assert_eq!(h("2026-10-26 14:00", today), "Heute 14:00");
        assert_eq!(h("2026-10-27", today), "Morgen");
        assert_eq!(h("2026-10-25", today), "Gestern");
        assert_eq!(h("2026-10-30", today), "Fr 30.10.");
        assert_eq!(h("2026-10-27 14:00-15:30", d(2026, 10, 20)), "Di 27.10. 14:00–15:30");
        assert_eq!(h("2027-01-03", today), "So 3.1.2027");
        assert_eq!(h("2026-10-26 - 2026-10-28", today), "Mo 26.10. – Mi 28.10.");
        assert_eq!(h("2026-10-27 22:00 - 2026-10-28 02:00", today), "Di 27.10. 22:00 – Mi 28.10. 02:00");
    }

    #[test]
    fn when_serializes_camel_case() {
        let w = When::parse("2026-10-27 14:00").unwrap();
        let j = serde_json::to_value(w).unwrap();
        assert_eq!(j["start"], "2026-10-27");
        assert_eq!(j["startTime"], "14:00:00");
        assert!(j["endDate"].is_null());
    }

    // --- Natürliche Sprache: relativ ---------------------------------------

    #[test]
    fn natural_relative() {
        check("heute", "2026-10-26");
        check("Heute", "2026-10-26");
        check("today", "2026-10-26");
        check("morgen", "2026-10-27");
        check("tomorrow", "2026-10-27");
        check("übermorgen", "2026-10-28");
        check("uebermorgen", "2026-10-28");
        check("Übermorgen", "2026-10-28");
        check("gestern", "2026-10-25");
        check("yesterday", "2026-10-25");
        check("vorgestern", "2026-10-24");
        check("in 3 tagen", "2026-10-29");
        check("in 3 days", "2026-10-29");
        check("in 2 wochen", "2026-11-09");
        check("in 2 weeks", "2026-11-09");
        check("in einer woche", "2026-11-02");
        check("in 1 monat", "2026-11-26");
        check("in a month", "2026-11-26");
        check("in einem Jahr", "2027-10-26");
        check("nächste woche", "2026-11-02");
        check("naechste Woche", "2026-11-02");
        check("next week", "2026-11-02");
        check("übernächste woche", "2026-11-09");
        check("ende der woche", "2026-10-30");
        check("end of week", "2026-10-30");
        check("end of the week", "2026-10-30");
        check("ende des monats", "2026-10-31");
        check("Monatsende", "2026-10-31");
        check("end of month", "2026-10-31");
        check("nächsten monat", "2026-11-01");
        check("next month", "2026-11-01");
        check("nächstes jahr", "2027-01-01");
        check("wochenende", "2026-10-31");
        check("ende 2026", "2026-12-31");
        check("bis freitag", "2026-10-30");
        check("by friday", "2026-10-30");
        check("bis 30.10.", "2026-10-30");
    }

    #[test]
    fn natural_weekdays() {
        // Heute ist Montag: „montag“ meint den nächsten Montag.
        check("montag", "2026-11-02");
        check("mo", "2026-11-02");
        check("Mo.", "2026-11-02");
        check("di", "2026-10-27");
        check("dienstag", "2026-10-27");
        check("mi", "2026-10-28");
        check("do", "2026-10-29");
        check("fr", "2026-10-30");
        check("Freitag", "2026-10-30");
        check("sa", "2026-10-31");
        check("so", "2026-11-01");
        check("sonntag", "2026-11-01");
        check("nächsten freitag", "2026-10-30");
        check("naechsten Freitag", "2026-10-30");
        check("am freitag", "2026-10-30");
        check("kommenden mittwoch", "2026-10-28");
        check("übernächsten freitag", "2026-11-06");
        check("monday", "2026-11-02");
        check("next monday", "2026-11-02");
        check("on friday", "2026-10-30");
        check("fri", "2026-10-30");
        check("Sunday", "2026-11-01");
    }

    #[test]
    fn natural_absolute() {
        check("27.10.", "2026-10-27");
        check("27.10", "2026-10-27");
        check("27.10.2026", "2026-10-27");
        check("27.10.26", "2026-10-27");
        check("2026-10-27", "2026-10-27");
        check("27. oktober", "2026-10-27");
        check("27. Okt", "2026-10-27");
        check("27. Okt.", "2026-10-27");
        check("27 oct", "2026-10-27");
        check("oct 27", "2026-10-27");
        check("october 27 2026", "2026-10-27");
        check("October 27, 2026", "2026-10-27");
        check("27. Oktober 2027", "2027-10-27");
        check("am 27.10.", "2026-10-27");
        check("1. März", "2027-03-01");
        // Höchstens eine Woche vorbei: dieses Jahr, sonst nächstes.
        check("20.10.", "2026-10-20");
        check("15.10.", "2027-10-15");
        check("1.1.", "2027-01-01");
        check("24.12.", "2026-12-24");
        // Schaltjahr: 29.2. springt ins nächste gültige Jahr.
        check("29.2.", "2028-02-29");
        // Nur Tag
        check("am 3.", "2026-11-03");
        check("am 28.", "2026-10-28");
        // „10.11“ ohne Zusammenhang ist ein Datum
        check("10.11", "2026-11-10");
    }

    #[test]
    fn natural_times() {
        check("14:00", "2026-10-26 14:00");
        check("9:00", "2026-10-27 09:00"); // heute vorbei → morgen
        check("um 9", "2026-10-27 09:00");
        check("um 14 uhr", "2026-10-26 14:00");
        check("14 uhr", "2026-10-26 14:00");
        check("14uhr", "2026-10-26 14:00");
        check("14 Uhr 30", "2026-10-26 14:30");
        check("14h", "2026-10-26 14:00");
        check("14h30", "2026-10-26 14:30");
        check("2pm", "2026-10-26 14:00");
        check("2:30 pm", "2026-10-26 14:30");
        check("11 am", "2026-10-26 11:00");
        check("12 am", "2026-10-27 00:00");
        check("mittag", "2026-10-26 12:00");
        check("noon", "2026-10-26 12:00");
        check("14.30", "2026-10-26 14:30");
        check("um 10.11", "2026-10-26 10:11");
        check("10.11 uhr", "2026-10-26 10:11");
        check("at 3pm", "2026-10-26 15:00");
    }

    #[test]
    fn natural_date_and_time() {
        check("morgen 14 uhr", "2026-10-27 14:00");
        check("morgen um 14 Uhr", "2026-10-27 14:00");
        check("morgen 9", "2026-10-27 09:00");
        check("morgen 14.30", "2026-10-27 14:30");
        check("morgen 10.11", "2026-10-27 10:11");
        check("fr 14:00", "2026-10-30 14:00");
        check("14:00 morgen", "2026-10-27 14:00");
        check("14 Uhr morgen", "2026-10-27 14:00");
        check("9 am freitag", "2026-10-30 09:00");
        check("um 9 am freitag", "2026-10-30 09:00");
        check("tomorrow at 2pm", "2026-10-27 14:00");
        check("next friday 3:30 pm", "2026-10-30 15:30");
        check("oct 27 2026 9am", "2026-10-27 09:00");
        check("27.10. 10:00", "2026-10-27 10:00");
        check("27.10.2026 10:00", "2026-10-27 10:00");
        check("am 27. oktober um 14 uhr", "2026-10-27 14:00");
        check("morgen, 14 uhr", "2026-10-27 14:00");
        check("morgen ganztägig", "2026-10-27");
        check("tomorrow all day", "2026-10-27");
        check("heute 18:00", "2026-10-26 18:00");
        check("heute 8:00", "2026-10-26 08:00");
    }

    #[test]
    fn natural_ranges() {
        check("morgen 14:00-15:30", "2026-10-27 14:00-15:30");
        check("morgen 14:00 – 15:30", "2026-10-27 14:00-15:30");
        check("fr 14-15 uhr", "2026-10-30 14:00-15:00");
        check("morgen 14 bis 16 uhr", "2026-10-27 14:00-16:00");
        check("morgen von 14 bis 16 uhr", "2026-10-27 14:00-16:00");
        check("14:00 – 15:00", "2026-10-26 14:00-15:00");
        check("von 14 bis 16 uhr", "2026-10-26 14:00-16:00");
        check("tomorrow 2-4pm", "2026-10-27 14:00-16:00");
        check("tomorrow 2pm to 4pm", "2026-10-27 14:00-16:00");
        check("27.10. 10:00-11:00", "2026-10-27 10:00-11:00");
        check("morgen 14:00 für 2h", "2026-10-27 14:00-16:00");
        check("morgen 14 uhr für 2 stunden", "2026-10-27 14:00-16:00");
        check("morgen 14:00 for 90 min", "2026-10-27 14:00-15:30");
        check("morgen 14:00 2h", "2026-10-27 14:00-16:00");
        check("morgen 14:00 1h30m", "2026-10-27 14:00-15:30");
        check("morgen 23:00 für 2h", "2026-10-27 23:00 - 2026-10-28 01:00");
        check("morgen 22:00-02:00", "2026-10-27 22:00 - 2026-10-28 02:00");
        check("27.10. - 29.10.", "2026-10-27 - 2026-10-29");
        check("27.10. bis 29.10.", "2026-10-27 - 2026-10-29");
        check("vom 27.10. bis 29.10.", "2026-10-27 - 2026-10-29");
        check("mo bis mi", "2026-11-02 - 2026-11-04");
        check("fr - mo", "2026-10-30 - 2026-11-02");
        check("heute bis freitag", "2026-10-26 - 2026-10-30");
        check("28.12. - 2.1.", "2026-12-28 - 2027-01-02");
        check("27.10. 22:00 - 28.10. 02:00", "2026-10-27 22:00 - 2026-10-28 02:00");
        check("mo 9:00 - mi 17:00", "2026-11-02 09:00 - 2026-11-04 17:00");
        check("2026-10-27 - 2026-10-29", "2026-10-27 - 2026-10-29");
    }

    #[test]
    fn natural_rejects() {
        none("");
        none("   ");
        none("9");
        none("14");
        none("monat");
        none("woche");
        none("mit Anna");
        none("Bericht");
        none("Bericht schreiben");
        none("am");
        none("um");
        none("in");
        none("in 3");
        none("morgen um");
        none("morgen Zahnarzt");
        none("32.10.");
        none("30.02.2026");
        none("25:00");
        none("morgen,");
        none("27.10. -");
        none("so ein Mist");
        none("2 tage");
        none("this week");
        none("14:00 bis freitag");
        none("bis");
    }

    #[test]
    fn natural_prefix() {
        let p = |s: &str| parse_natural_prefix(s, now()).map(|(w, n)| (w.format(), s[..n].to_string()));
        assert_eq!(p("morgen 14 uhr Zahnarzt"), Some(("2026-10-27 14:00".into(), "morgen 14 uhr".into())));
        assert_eq!(p("fr Bericht"), Some(("2026-10-30".into(), "fr".into())));
        assert_eq!(p("Bericht"), None);
        assert_eq!(p("mit Anna"), None);
        assert_eq!(p("monat"), None);
        assert_eq!(p("so ein Mist"), Some(("2026-11-01".into(), "so".into())));
        assert_eq!(p("morgen, Zahnarzt"), Some(("2026-10-27".into(), "morgen".into())));
        assert_eq!(
            p("27.10. 10:00-11:00 Meeting mit Anna"),
            Some(("2026-10-27 10:00-11:00".into(), "27.10. 10:00-11:00".into()))
        );
        assert_eq!(p("übermorgen Zahnarzt"), Some(("2026-10-28".into(), "übermorgen".into())));
        assert_eq!(p("morgen um Zahnarzt"), Some(("2026-10-27".into(), "morgen".into())));
        assert_eq!(p("freitag 14-15 uhr Review #team"), Some(("2026-10-30 14:00-15:00".into(), "freitag 14-15 uhr".into())));
        assert_eq!(p("in 3 tagen nachfragen"), Some(("2026-10-29".into(), "in 3 tagen".into())));
        assert_eq!(p("morgen 9 Uhr: Standup"), Some(("2026-10-27 09:00".into(), "morgen 9 Uhr".into())));
        // Keine Teilwörter: „14uhrfoo“ ist kein Schnitt
        assert_eq!(p("14uhrfoo"), None);
        assert_eq!(p(""), None);
    }

    // --- Wiederholung ------------------------------------------------------

    fn rep(s: &str) -> Option<String> {
        Repeat::parse(s).map(|r| r.format())
    }

    #[test]
    fn repeat_roundtrip_canonical() {
        for s in [
            "daily",
            "weekdays",
            "weekly",
            "every 2 weeks",
            "weekly on mon,thu",
            "every 2 weeks on fri",
            "monthly",
            "yearly",
            "every 3 days",
            "every 2 months",
            "every 2 years",
            "weekly until 2026-12-31",
            "weekly on mon,thu until 2026-12-31",
            "daily until 2027-01-31",
        ] {
            assert_eq!(rep(s).as_deref(), Some(s), "{s}");
        }
    }

    #[test]
    fn repeat_german() {
        let cases = [
            ("täglich", "daily"),
            ("Täglich", "daily"),
            ("jeden tag", "daily"),
            ("werktags", "weekdays"),
            ("an werktagen", "weekdays"),
            ("jeden Werktag", "weekdays"),
            ("wöchentlich", "weekly"),
            ("woechentlich", "weekly"),
            ("jede woche", "weekly"),
            ("alle 2 wochen", "every 2 weeks"),
            ("alle zwei wochen", "every 2 weeks"),
            ("jede 2. woche", "every 2 weeks"),
            ("14-tägig", "every 2 weeks"),
            ("jeden montag", "weekly on mon"),
            ("jeden mo und do", "weekly on mon,thu"),
            ("jeden montag und donnerstag", "weekly on mon,thu"),
            ("jeden do, mo", "weekly on mon,thu"),
            ("montags", "weekly on mon"),
            ("montags und donnerstags", "weekly on mon,thu"),
            ("jeden mo-fr", "weekly on mon,tue,wed,thu,fri"),
            ("wöchentlich am mo und do", "weekly on mon,thu"),
            ("monatlich", "monthly"),
            ("jeden monat", "monthly"),
            ("alle 3 monate", "every 3 months"),
            ("vierteljährlich", "every 3 months"),
            ("jährlich", "yearly"),
            ("jedes jahr", "yearly"),
            ("alle 3 tage", "every 3 days"),
            ("wöchentlich bis 31.12.2026", "weekly until 2026-12-31"),
            ("jeden montag bis 31.12.2026", "weekly on mon until 2026-12-31"),
            ("täglich bis ende 2026", "daily until 2026-12-31"),
            ("monatlich bis zum 2027-06-30", "monthly until 2027-06-30"),
            ("wöchentlich bis 31. dezember 2026", "weekly until 2026-12-31"),
        ];
        for (input, expected) in cases {
            assert_eq!(rep(input).as_deref(), Some(expected), "{input}");
        }
    }

    #[test]
    fn repeat_english() {
        let cases = [
            ("daily", "daily"),
            ("every day", "daily"),
            ("weekdays", "weekdays"),
            ("every weekday", "weekdays"),
            ("weekly", "weekly"),
            ("every week", "weekly"),
            ("every 2 weeks", "every 2 weeks"),
            ("every two weeks", "every 2 weeks"),
            ("every other week", "every 2 weeks"),
            ("biweekly", "every 2 weeks"),
            ("every monday", "weekly on mon"),
            ("every mon and thu", "weekly on mon,thu"),
            ("every monday, thursday", "weekly on mon,thu"),
            ("mondays", "weekly on mon"),
            ("mondays and thursdays", "weekly on mon,thu"),
            ("monthly", "monthly"),
            ("every month", "monthly"),
            ("yearly", "yearly"),
            ("annually", "yearly"),
            ("every year", "yearly"),
            ("every 3 days", "every 3 days"),
            ("weekly until 2026-12-31", "weekly until 2026-12-31"),
            ("every friday until dec 31, 2026", "weekly on fri until 2026-12-31"),
        ];
        for (input, expected) in cases {
            assert_eq!(rep(input).as_deref(), Some(expected), "{input}");
        }
    }

    #[test]
    fn repeat_invalid() {
        for s in ["", "irgendwann", "every", "alle", "alle 0 tage", "jeden", "weekly until", "weekly until 31.12.", "every 2 hours", "montag"] {
            assert_eq!(rep(s), None, "{s:?}");
        }
    }

    #[test]
    fn repeat_prefix() {
        let p = |s: &str| Repeat::parse_prefix(s).map(|(r, n)| (r.format(), s[..n].to_string()));
        assert_eq!(p("wöchentlich Teammeeting"), Some(("weekly".into(), "wöchentlich".into())));
        assert_eq!(p("jeden mo und do Sport"), Some(("weekly on mon,thu".into(), "jeden mo und do".into())));
        assert_eq!(p("alle 2 wochen bis 31.12.2026 Review"), Some(("every 2 weeks until 2026-12-31".into(), "alle 2 wochen bis 31.12.2026".into())));
        assert_eq!(p("Teammeeting"), None);
    }

    #[test]
    fn repeat_human() {
        let h = |s: &str| Repeat::parse(s).unwrap().human_de();
        assert_eq!(h("daily"), "täglich");
        assert_eq!(h("weekdays"), "werktags");
        assert_eq!(h("weekly"), "wöchentlich");
        assert_eq!(h("every 2 weeks"), "alle 2 Wochen");
        assert_eq!(h("weekly on mon,thu"), "wöchentlich (Mo, Do)");
        assert_eq!(h("monthly"), "monatlich");
        assert_eq!(h("yearly"), "jährlich");
        assert_eq!(h("every 3 days"), "alle 3 Tage");
        assert_eq!(h("weekly until 2026-12-31"), "wöchentlich bis 31.12.2026");
    }

    fn anchor(s: &str) -> When {
        When::parse(s).unwrap()
    }

    #[test]
    fn repeat_monthly_end_of_month() {
        let r = Repeat::parse("monthly").unwrap();
        let a = anchor("2026-01-31");
        assert_eq!(r.next_after(&a, d(2026, 1, 31)), Some(d(2026, 2, 28)));
        assert_eq!(r.next_after(&a, d(2026, 2, 28)), Some(d(2026, 3, 31)));
        assert_eq!(r.next_after(&a, d(2026, 3, 31)), Some(d(2026, 4, 30)));
        assert_eq!(r.next_after(&a, d(2026, 12, 31)), Some(d(2027, 1, 31)));
        let occ: Vec<String> = r.occurrences(&a, d(2026, 1, 1), d(2026, 6, 30)).iter().map(|w| w.format()).collect();
        assert_eq!(occ, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
        // Schaltjahr
        let a = anchor("2028-01-31");
        assert_eq!(r.next_after(&a, d(2028, 1, 31)), Some(d(2028, 2, 29)));
        // Vor dem Anker: der Anker selbst
        assert_eq!(r.next_after(&a, d(2027, 5, 5)), Some(d(2028, 1, 31)));
    }

    #[test]
    fn repeat_yearly_leap_day() {
        let r = Repeat::parse("yearly").unwrap();
        let a = anchor("2024-02-29");
        assert_eq!(r.next_after(&a, d(2024, 2, 29)), Some(d(2025, 2, 28)));
        assert_eq!(r.next_after(&a, d(2025, 2, 28)), Some(d(2026, 2, 28)));
        assert_eq!(r.next_after(&a, d(2027, 3, 1)), Some(d(2028, 2, 29)));
        let r2 = Repeat::parse("every 2 years").unwrap();
        assert_eq!(r2.next_after(&a, d(2024, 3, 1)), Some(d(2026, 2, 28)));
    }

    #[test]
    fn repeat_weekly_days() {
        let r = Repeat::parse("weekly on mon,thu").unwrap();
        let a = anchor("2026-10-26 09:00");
        let occ: Vec<String> = r.occurrences(&a, d(2026, 10, 26), d(2026, 11, 8)).iter().map(|w| w.format()).collect();
        assert_eq!(occ, ["2026-10-26 09:00", "2026-10-29 09:00", "2026-11-02 09:00", "2026-11-05 09:00"]);

        let r = Repeat::parse("every 2 weeks on fri").unwrap();
        let a = anchor("2026-10-30");
        assert_eq!(r.next_after(&a, d(2026, 10, 30)), Some(d(2026, 11, 13)));
        assert_eq!(r.next_after(&a, d(2026, 11, 13)), Some(d(2026, 11, 27)));
        // Anker an einem anderen Wochentag: zählt selbst, dann die Liste.
        let r = Repeat::parse("weekly on fri").unwrap();
        let a = anchor("2026-10-27");
        let occ: Vec<NaiveDate> = r.occurrences(&a, d(2026, 10, 1), d(2026, 11, 10)).iter().map(|w| w.start).collect();
        assert_eq!(occ, [d(2026, 10, 27), d(2026, 10, 30), d(2026, 11, 6)]);
    }

    #[test]
    fn repeat_simple_steps() {
        let a = anchor("2026-10-26");
        let r = Repeat::parse("every 3 days").unwrap();
        assert_eq!(r.next_after(&a, d(2026, 10, 27)), Some(d(2026, 10, 29)));
        assert_eq!(r.next_after(&a, d(2026, 10, 29)), Some(d(2026, 11, 1)));
        let r = Repeat::parse("weekly").unwrap();
        let occ: Vec<NaiveDate> = r.occurrences(&a, d(2026, 10, 1), d(2026, 11, 10)).iter().map(|w| w.start).collect();
        assert_eq!(occ, [d(2026, 10, 26), d(2026, 11, 2), d(2026, 11, 9)]);
        let r = Repeat::parse("weekdays").unwrap();
        let fri = anchor("2026-10-30");
        assert_eq!(r.next_after(&fri, d(2026, 10, 30)), Some(d(2026, 11, 2)));
        // Anker am Samstag zählt trotzdem
        let sat = anchor("2026-10-31");
        let occ: Vec<NaiveDate> = r.occurrences(&sat, d(2026, 10, 31), d(2026, 11, 3)).iter().map(|w| w.start).collect();
        assert_eq!(occ, [d(2026, 10, 31), d(2026, 11, 2), d(2026, 11, 3)]);
    }

    #[test]
    fn repeat_until() {
        let r = Repeat::parse("daily until 2026-10-28").unwrap();
        let a = anchor("2026-10-26");
        let occ: Vec<NaiveDate> = r.occurrences(&a, d(2026, 10, 1), d(2026, 10, 31)).iter().map(|w| w.start).collect();
        assert_eq!(occ, [d(2026, 10, 26), d(2026, 10, 27), d(2026, 10, 28)]);
        assert_eq!(r.next_after(&a, d(2026, 10, 28)), None);
    }

    #[test]
    fn repeat_multi_day_overlap() {
        let r = Repeat::parse("weekly").unwrap();
        let a = anchor("2026-10-26 - 2026-10-28");
        let occ: Vec<String> = r.occurrences(&a, d(2026, 10, 27), d(2026, 11, 2)).iter().map(|w| w.format()).collect();
        assert_eq!(occ, ["2026-10-26 - 2026-10-28", "2026-11-02 - 2026-11-04"]);
        // Über Mitternacht berührt der Termin den Folgetag
        let a = anchor("2026-10-26 22:00-02:00");
        let occ = r.occurrences(&a, d(2026, 11, 3), d(2026, 11, 3));
        assert_eq!(occ.len(), 1);
        assert_eq!(occ[0].start, d(2026, 11, 2));
    }

    #[test]
    fn repeat_occurrences_empty_and_far() {
        let r = Repeat::parse("daily").unwrap();
        let a = anchor("2026-10-26");
        assert!(r.occurrences(&a, d(2026, 10, 1), d(2026, 10, 25)).is_empty());
        let occ = r.occurrences(&a, d(2030, 1, 1), d(2030, 1, 3));
        assert_eq!(occ.len(), 3);
        assert_eq!(occ[0].start, d(2030, 1, 1));
    }

    // --- Erinnerung --------------------------------------------------------

    fn rem(s: &str) -> Option<String> {
        Remind::parse(s, now()).map(|r| r.format())
    }

    #[test]
    fn remind_parse() {
        let cases = [
            ("15m", "15m"),
            ("15 min", "15m"),
            ("15min", "15m"),
            ("15 Min.", "15m"),
            ("1h", "1h"),
            ("1 std", "1h"),
            ("1 Std.", "1h"),
            ("2 stunden", "2h"),
            ("1d", "1d"),
            ("1 tag", "1d"),
            ("2 Tage vorher", "2d"),
            ("1h30m", "1h30m"),
            ("1 std 30 min", "1h30m"),
            ("90 minuten", "1h30m"),
            ("1d2h", "1d2h"),
            ("1w", "7d"),
            ("eine stunde vorher", "1h"),
            ("halbe stunde", "30m"),
            ("0", "0"),
            ("beginn", "0"),
            ("zu Beginn", "0"),
            ("start", "0"),
            ("30 minuten vorher", "30m"),
            ("15 minutes before", "15m"),
            ("an hour before", "1h"),
            ("10", "10m"),
            ("2026-10-27 08:00", "2026-10-27 08:00"),
            ("27.10.2026 08:00", "2026-10-27 08:00"),
            ("morgen 8 uhr", "2026-10-27 08:00"),
            ("morgen", "2026-10-27 09:00"),
            ("fr 7:30", "2026-10-30 07:30"),
        ];
        for (input, expected) in cases {
            assert_eq!(rem(input).as_deref(), Some(expected), "{input}");
        }
        for s in ["", "bald", "irgendwann", "15 äpfel"] {
            assert_eq!(rem(s), None, "{s:?}");
        }
    }

    #[test]
    fn remind_list() {
        let l = Remind::parse_list("15m, 1h; 2026-10-27 08:00, quatsch", now());
        assert_eq!(l.len(), 3);
        assert_eq!(Remind::format_list(&l), "15m, 1h, 2026-10-27 08:00");
        assert!(Remind::parse_list("", now()).is_empty());
    }

    #[test]
    fn remind_roundtrip() {
        for s in ["15m", "1h", "1d", "1h30m", "0", "2026-10-27 08:00", "1d2h", "2d", "45m"] {
            assert_eq!(rem(s).as_deref(), Some(s), "{s}");
        }
    }

    #[test]
    fn remind_human() {
        let h = |s: &str| Remind::parse(s, now()).unwrap().human_de();
        assert_eq!(h("15m"), "15 Min. vorher");
        assert_eq!(h("1h"), "1 Std. vorher");
        assert_eq!(h("1h30m"), "1 Std. 30 Min. vorher");
        assert_eq!(h("1d"), "1 Tag vorher");
        assert_eq!(h("2d"), "2 Tage vorher");
        assert_eq!(h("0"), "zu Beginn");
        assert_eq!(h("2026-10-27 08:00"), "27.10. 08:00");
    }

    #[test]
    fn remind_instant() {
        let morning = t(9, 0);
        let timed = anchor("2026-10-27 14:00");
        let all_day = anchor("2026-10-27");
        let r = |s: &str| Remind::parse(s, now()).unwrap();
        assert_eq!(r("15m").instant(&timed, morning), d(2026, 10, 27).and_time(t(13, 45)));
        assert_eq!(r("0").instant(&timed, morning), d(2026, 10, 27).and_time(t(14, 0)));
        assert_eq!(r("1d").instant(&all_day, morning), d(2026, 10, 26).and_time(t(9, 0)));
        assert_eq!(r("0").instant(&all_day, morning), d(2026, 10, 27).and_time(t(9, 0)));
        assert_eq!(r("2026-10-27 08:00").instant(&timed, morning), d(2026, 10, 27).and_time(t(8, 0)));
        // Für ein späteres Vorkommen
        let later = timed.shift_to(d(2026, 11, 3));
        assert_eq!(r("1h").instant(&later, morning), d(2026, 11, 3).and_time(t(13, 0)));
    }

    #[test]
    fn lexer_offsets_are_byte_based() {
        let toks = lex("Übermorgen 14:00");
        assert_eq!(toks.len(), 2);
        assert_eq!(toks[0].end, "Übermorgen".len());
        assert_eq!(toks[0].word(), Some("uebermorgen"));
        assert_eq!(toks[1].kind, Kind::Colon(14, 0));
    }
}
