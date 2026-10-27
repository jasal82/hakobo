// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Schnellerfassung: Text mit Slash-Befehlen in einen Knoten verwandeln.
//!
//! `Zahnarzt /morgen 14 uhr /erinnerung 1h` → Termin morgen 14:00 mit
//! Erinnerung, `[] Bericht /fällig fr #arbeit` → Todo, fällig Freitag.
//! Dieselben Befehle versteht der Editor (über `parse_command`).

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::dates::{Remind, Repeat, When, parse_natural_prefix};
use crate::vault::{Field, Task};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandKind {
    Todo,
    Due,
    Date,
    Repeat,
    Remind,
}

/// Ergebnis eines einzelnen Befehls (ohne `/`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub kind: CommandKind,
    /// Feldname (`date`, `repeat`, `remind`) bzw. leer bei `todo`.
    pub field: &'static str,
    /// Kanonischer Feldwert.
    pub value: String,
    /// Lesbare Beschreibung, z. B. „Fällig: Fr 30.10.“.
    pub human: String,
    /// Verbrauchte Bytes (Befehl und Argument).
    pub consumed: usize,
    /// Bei Wiederholungen: Startdatum (erstes Vorkommen ab heute, mit
    /// Uhrzeit, falls angegeben) – gilt, wenn der Knoten noch kein Datum hat.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

const TODO: &[&str] = &["todo", "aufgabe", "task"];
const DUE: &[&str] = &["fällig", "faellig", "due", "deadline", "bis"];
const DATE: &[&str] = &["termin", "datum", "date", "am", "um", "event", "wann", "zeit"];
const REPEAT: &[&str] = &["wdh", "wiederholung", "wiederholen", "repeat", "rpt"];
const REPEAT_WORDS: &[&str] = &[
    "jeden", "jede", "jedes", "alle", "every", "täglich", "taeglich", "wöchentlich", "woechentlich", "monatlich", "jährlich", "jaehrlich", "werktags", "daily",
    "weekly", "monthly", "yearly", "annually", "weekdays", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags", "sonntags", "14-tägig",
    "vierteljährlich", "quarterly",
];
const REMIND: &[&str] = &["erinnerung", "erinnere", "erinnern", "remind", "reminder", "alarm", "wecker"];

/// Länge des ersten Wortes.
fn first_word(s: &str) -> (&str, usize) {
    let end = s.find(char::is_whitespace).unwrap_or(s.len());
    (&s[..end], end)
}

/// Leerraum nach dem Befehlswort überspringen.
fn skip_ws(s: &str, from: usize) -> usize {
    from + s[from..].len() - s[from..].trim_start().len()
}

fn due_human(w: &When, now: NaiveDateTime) -> String {
    format!("Fällig: {}", w.human_de(now.date()))
}

fn date_human(w: &When, now: NaiveDateTime) -> String {
    format!("Termin: {}", w.human_de(now.date()))
}

/// Versteht einen Befehl wie `fällig fr`, `termin morgen 14-15 uhr`,
/// `morgen`, `wdh wöchentlich`, `jeden montag`, `erinnerung 15m`, `todo`.
pub fn parse_command(input: &str, now: NaiveDateTime) -> Option<CommandResult> {
    let (word, wlen) = first_word(input);
    let w = word.to_lowercase();
    let w = w.as_str();
    let arg_start = skip_ws(input, wlen);
    let arg = &input[arg_start..];
    if TODO.contains(&w) {
        return Some(CommandResult { kind: CommandKind::Todo, field: "", value: String::new(), human: "Todo".into(), consumed: wlen, date: None });
    }
    if DUE.contains(&w) {
        let (when, n) = parse_natural_prefix(arg, now)?;
        return Some(CommandResult { kind: CommandKind::Due, field: "date", value: when.format(), human: due_human(&when, now), consumed: arg_start + n, date: None });
    }
    if DATE.contains(&w) {
        // „am freitag“, „um 14 uhr“: Das Befehlswort gehört zum Datum.
        let (when, n, start) = match parse_natural_prefix(input, now) {
            Some((wh, n)) if matches!(w, "am" | "um") => (wh, n, 0),
            _ => {
                let (wh, n) = parse_natural_prefix(arg, now)?;
                (wh, n, arg_start)
            }
        };
        return Some(CommandResult { kind: CommandKind::Date, field: "date", value: when.format(), human: date_human(&when, now), consumed: start + n, date: None });
    }
    if REPEAT.contains(&w) {
        let (rep, n) = Repeat::parse_prefix(arg)?;
        return Some(repeat_result(input, rep, arg_start + n, now));
    }
    if REPEAT_WORDS.contains(&w) {
        let (rep, n) = Repeat::parse_prefix(input)?;
        return Some(repeat_result(input, rep, n, now));
    }
    if REMIND.contains(&w) {
        // Längstes Präfix, das eine Erinnerung ist (wortweise).
        let mut best: Option<(Remind, usize)> = None;
        let mut end = 0;
        for (i, c) in arg.char_indices().chain(std::iter::once((arg.len(), ' '))) {
            if c.is_whitespace() && i > end {
                end = i;
                let part = &arg[..end];
                if let Some(r) = Remind::parse(part, now) {
                    best = Some((r, end));
                }
            }
        }
        let (r, n) = best?;
        return Some(CommandResult { kind: CommandKind::Remind, field: "remind", value: r.format(), human: format!("Erinnerung: {}", r.human_de()), consumed: arg_start + n, date: None });
    }
    // Ohne Befehlswort: direkt ein Datum (`/morgen`, `/fr 14 uhr`, `/27.10.`).
    let (when, n) = parse_natural_prefix(input, now)?;
    Some(CommandResult { kind: CommandKind::Date, field: "date", value: when.format(), human: date_human(&when, now), consumed: n, date: None })
}

/// Wiederholung plus Startdatum: erstes passendes Vorkommen ab heute; eine
/// direkt folgende Uhrzeit („jeden montag 9 uhr“) gehört dazu.
fn repeat_result(input: &str, rep: Repeat, mut consumed: usize, now: NaiveDateTime) -> CommandResult {
    let today = now.date();
    let rest = &input[consumed..];
    let ws = skip_ws(rest, 0);
    let mut time = None;
    if ws > 0 || rest.is_empty() {
        let tomorrow = today.succ_opt().unwrap_or(today);
        if let Some((w, n)) = parse_natural_prefix(&rest[ws..], now)
            && w.start_time.is_some()
            && (w.start == today || w.start == tomorrow)
            && w.end_date.is_none()
        {
            time = Some(w);
            consumed += ws + n;
        }
    }
    let yesterday = today.pred_opt().unwrap_or(today);
    let first = if rep.weekdays.is_empty() && !rep.workdays {
        today
    } else {
        let anchor = When { start: yesterday, start_time: None, end_date: None, end_time: None };
        rep.next_after(&anchor, yesterday).unwrap_or(today)
    };
    let start = When { start: first, start_time: time.and_then(|t| t.start_time), end_date: None, end_time: time.and_then(|t| t.end_time) };
    let mut human = format!("Wiederholung: {}", rep.human_de());
    if let Some(t) = start.start_time {
        human.push_str(&format!(", {}", t.format("%H:%M")));
    }
    CommandResult { kind: CommandKind::Repeat, field: "repeat", value: rep.format(), human, consumed, date: Some(start.format()) }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Captured {
    pub text: String,
    pub body: String,
    pub task: Option<Task>,
    pub fields: Vec<Field>,
    /// Lesbare Zusammenfassung der erkannten Befehle.
    pub summary: Vec<String>,
}

fn set(fields: &mut Vec<Field>, key: &str, value: String) {
    match fields.iter_mut().find(|f| f.key == key) {
        Some(f) => f.value = value,
        None => fields.push(Field { key: key.to_string(), value }),
    }
}

/// Erfasster Text → Knoten. Erste Zeile = Text, weitere Zeilen = Notiz.
pub fn parse(input: &str, now: NaiveDateTime) -> Captured {
    let input = input.replace("\r\n", "\n");
    let (first, rest) = input.split_once('\n').unwrap_or((&input, ""));
    let mut c = Captured { body: rest.trim_matches('\n').to_string(), ..Default::default() };
    let mut line = first.trim();

    // Todo-Markierungen am Anfang
    for prefix in ["- [ ] ", "[ ] ", "[] ", "- [] "] {
        if let Some(r) = line.strip_prefix(prefix) {
            c.task = Some(Task::Open);
            line = r.trim_start();
        }
    }
    let lower = line.to_lowercase();
    for prefix in ["todo:", "todo "] {
        if lower.starts_with(prefix) {
            c.task = Some(Task::Open);
            line = line[prefix.len()..].trim_start();
            break;
        }
    }

    let mut out = String::new();
    let mut rest = line;
    let mut kept_due = false;
    let mut repeat_start: Option<String> = None;
    while let Some(pos) = find_slash(rest) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 1..];
        match parse_command(after, now) {
            Some(cmd) => {
                match cmd.kind {
                    CommandKind::Todo => c.task = Some(Task::Open),
                    CommandKind::Due => {
                        c.task.get_or_insert(Task::Open);
                        set(&mut c.fields, "date", cmd.value.clone());
                        kept_due = true;
                    }
                    CommandKind::Date => set(&mut c.fields, "date", cmd.value.clone()),
                    CommandKind::Repeat => {
                        set(&mut c.fields, "repeat", cmd.value.clone());
                        repeat_start = cmd.date.clone();
                    }
                    CommandKind::Remind => set(&mut c.fields, "remind", cmd.value.clone()),
                }
                c.summary.push(cmd.human.clone());
                rest = &after[cmd.consumed..];
            }
            None => {
                out.push('/');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    c.text = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Some(d) = repeat_start
        && !c.fields.iter().any(|f| f.key == "date")
    {
        c.fields.insert(0, Field { key: "date".into(), value: d });
    }
    // Zusammenfassung: Bei Todos heißt das Datum „Fällig“.
    if c.task.is_some() && !kept_due {
        for s in c.summary.iter_mut() {
            if let Some(r) = s.strip_prefix("Termin: ") {
                *s = format!("Fällig: {r}");
            }
        }
    }
    c
}

/// Position eines `/` am Wortanfang.
fn find_slash(s: &str) -> Option<usize> {
    let mut prev_ws = true;
    for (i, ch) in s.char_indices() {
        if ch == '/' && prev_ws {
            return Some(i);
        }
        prev_ws = ch.is_whitespace();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn now() -> NaiveDateTime {
        // Montag, 26.10.2026, 10:00
        NaiveDate::from_ymd_opt(2026, 10, 26).unwrap().and_hms_opt(10, 0, 0).unwrap()
    }

    fn field<'a>(c: &'a Captured, k: &str) -> Option<&'a str> {
        c.fields.iter().find(|f| f.key == k).map(|f| f.value.as_str())
    }

    #[test]
    fn plain_text() {
        let c = parse("Idee für die Notes-App", now());
        assert_eq!(c.text, "Idee für die Notes-App");
        assert!(c.fields.is_empty());
        assert_eq!(c.task, None);
    }

    #[test]
    fn event_with_time_and_reminder() {
        let c = parse("Zahnarzt /morgen 14 uhr /erinnerung 1h", now());
        assert_eq!(c.text, "Zahnarzt");
        assert_eq!(field(&c, "date"), Some("2026-10-27 14:00"));
        assert_eq!(field(&c, "remind"), Some("1h"));
        assert_eq!(c.task, None);
        assert_eq!(c.summary.len(), 2);
    }

    #[test]
    fn todo_with_due_and_tags() {
        let c = parse("[] Bericht schreiben /fällig fr #arbeit", now());
        assert_eq!(c.task, Some(Task::Open));
        assert_eq!(c.text, "Bericht schreiben #arbeit");
        assert_eq!(field(&c, "date"), Some("2026-10-30"));
        assert!(c.summary[0].starts_with("Fällig"));
        let c = parse("Steuer /due 31.12. /todo", now());
        assert_eq!(c.task, Some(Task::Open));
        assert_eq!(field(&c, "date"), Some("2026-12-31"));
    }

    #[test]
    fn date_in_the_middle_keeps_text() {
        let c = parse("Meeting /termin do 10-11 uhr mit [[Anna]]", now());
        assert_eq!(c.text, "Meeting mit [[Anna]]");
        assert_eq!(field(&c, "date"), Some("2026-10-29 10:00-11:00"));
    }

    #[test]
    fn repeat_words() {
        let c = parse("Müll rausbringen /jeden montag /todo", now());
        assert_eq!(field(&c, "repeat"), Some("weekly on mon"));
        assert_eq!(field(&c, "date"), Some("2026-10-26"));
        assert_eq!(c.task, Some(Task::Open));
        let c = parse("Jour fixe /jeden mittwoch 9 uhr", now());
        assert_eq!(c.text, "Jour fixe");
        assert_eq!(field(&c, "date"), Some("2026-10-28 09:00"));
        let c = parse("Standup /werktags 9:30-9:45", now());
        assert_eq!(field(&c, "date"), Some("2026-10-26 09:30-09:45"));
        let c = parse("Review /termin 30.10. 10 uhr /wdh alle 2 wochen", now());
        assert_eq!(field(&c, "date"), Some("2026-10-30 10:00"));
        assert_eq!(field(&c, "repeat"), Some("every 2 weeks"));
        let c = parse("Backup /wdh monatlich", now());
        assert_eq!(field(&c, "repeat"), Some("monthly"));
    }

    #[test]
    fn unknown_slash_and_urls_stay() {
        let c = parse("Pfad /usr/bin und https://x.de/a", now());
        assert_eq!(c.text, "Pfad /usr/bin und https://x.de/a");
        assert!(c.fields.is_empty());
    }

    #[test]
    fn multiline_body() {
        let c = parse("Titel /heute\nZeile 1\nZeile 2\n", now());
        assert_eq!(c.text, "Titel");
        assert_eq!(c.body, "Zeile 1\nZeile 2");
        assert_eq!(field(&c, "date"), Some("2026-10-26"));
    }

    #[test]
    fn command_preview() {
        let r = parse_command("termin morgen 14-15 uhr", now()).unwrap();
        assert_eq!(r.kind, CommandKind::Date);
        assert_eq!(r.value, "2026-10-27 14:00-15:00");
        assert_eq!(r.consumed, "termin morgen 14-15 uhr".len());
        let r = parse_command("am freitag", now()).unwrap();
        assert_eq!(r.value, "2026-10-30");
        let r = parse_command("erinnerung 15 min Rest", now()).unwrap();
        assert_eq!(r.value, "15m");
        assert_eq!(r.consumed, "erinnerung 15 min".len());
        assert!(parse_command("bericht", now()).is_none());
        assert_eq!(parse_command("todo", now()).unwrap().kind, CommandKind::Todo);
    }
}
