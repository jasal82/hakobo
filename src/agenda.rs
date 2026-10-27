// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Agenda: Termine und fällige Todos in einem Zeitraum, plus Erinnerungen.

use chrono::{Duration, NaiveDate, NaiveDateTime};
use serde::Serialize;

use crate::dates::{Remind, Repeat, When};
use crate::settings::Settings;
use crate::vault::{Kind, Node, Task, Vault};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    /// Vorkommen (bei Wiederholungen verschoben).
    pub when: When,
    /// Kanonischer Wert des Vorkommens.
    pub value: String,
    pub human: String,
    /// `todo` oder `event`.
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<Task>,
    pub overdue: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat: Option<String>,
    pub text: String,
    pub page: String,
    pub page_id: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agenda {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub today: NaiveDate,
    /// Offene Todos mit Datum vor heute.
    pub overdue: Vec<Entry>,
    pub entries: Vec<Entry>,
}

fn entry(v: &Vault, n: &Node, when: When, today: NaiveDate, recurring: Option<&Repeat>) -> Entry {
    let page = v.page_of(&n.id);
    let overdue = n.task.is_some_and(|t| !t.is_closed()) && when.last_day() < today;
    Entry {
        id: n.id.clone(),
        value: when.format(),
        human: when.human_de(today),
        when,
        kind: if n.task.is_some() { "todo" } else { "event" },
        task: n.task,
        overdue,
        repeat: recurring.map(|r| r.human_de()),
        text: n.text.clone(),
        page: page.map(|p| p.text.clone()).unwrap_or_default(),
        page_id: page.map(|p| p.id.clone()).unwrap_or_default(),
        tags: v.tags_of(n),
    }
}

fn overlaps(w: &When, from: NaiveDate, to: NaiveDate) -> bool {
    w.start <= to && w.last_day() >= from
}

fn sort(v: &mut [Entry]) {
    v.sort_by(|a, b| {
        a.when
            .start
            .cmp(&b.when.start)
            .then_with(|| a.when.start_time.is_some().cmp(&b.when.start_time.is_some()))
            .then_with(|| a.when.start_time.cmp(&b.when.start_time))
            .then_with(|| a.task.is_some_and(|t| t.is_closed()).cmp(&b.task.is_some_and(|t| t.is_closed())))
            .then_with(|| a.text.to_lowercase().cmp(&b.text.to_lowercase()))
    });
}

/// Termine und Todos im Zeitraum `[from, to]`.
pub fn agenda(v: &Vault, from: NaiveDate, to: NaiveDate, today: NaiveDate) -> Agenda {
    let mut overdue = Vec::new();
    let mut entries = Vec::new();
    for n in v.nodes() {
        if n.kind == Kind::Root {
            continue;
        }
        let Some(when) = n.when() else { continue };
        let repeat = n.field("repeat").and_then(Repeat::parse);
        match n.task {
            Some(t) if t.is_closed() => {
                // Erledigte Todos am Tag der Erledigung (sonst am Fälligkeitstag).
                let day = n.field("done").and_then(When::parse).map(|d| d.start).unwrap_or(when.start);
                if day >= from && day <= to {
                    let w = if day == when.start { when } else { When { start: day, start_time: None, end_date: None, end_time: None } };
                    entries.push(entry(v, n, w, today, repeat.as_ref()));
                }
            }
            Some(_) => {
                let e = entry(v, n, when, today, repeat.as_ref());
                if e.overdue {
                    overdue.push(e);
                } else if overlaps(&when, from, to) {
                    entries.push(e);
                }
            }
            None => match &repeat {
                Some(r) => {
                    for occ in r.occurrences(&when, from, to) {
                        entries.push(entry(v, n, occ, today, Some(r)));
                    }
                }
                None => {
                    if overlaps(&when, from, to) {
                        entries.push(entry(v, n, when, today, None));
                    }
                }
            },
        }
    }
    sort(&mut overdue);
    sort(&mut entries);
    Agenda { from, to, today, overdue, entries }
}

/// Eine fällige Erinnerung.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// Eindeutig je Knoten, Vorkommen und Zeitpunkt (gegen doppeltes Auslösen).
    pub key: String,
    pub id: String,
    pub text: String,
    pub human: String,
    pub at: NaiveDateTime,
    pub todo: bool,
}

/// Erinnerungen mit Zeitpunkt in `(after, until]`.
pub fn reminders(v: &Vault, settings: &Settings, after: NaiveDateTime, until: NaiveDateTime) -> Vec<Reminder> {
    let all_day = settings.all_day_time();
    let today = until.date();
    let mut out = Vec::new();
    for n in v.nodes() {
        if n.kind == Kind::Root || n.task.is_some_and(|t| t.is_closed()) {
            continue;
        }
        let Some(when) = n.when() else { continue };
        let explicit: Vec<Remind> = n.field("remind").map(|r| Remind::parse_list(r, until)).unwrap_or_default();
        let defaults: Vec<Remind> = if !explicit.is_empty() {
            vec![]
        } else if when.is_all_day() {
            if settings.all_day_reminders { vec![Remind::Before(Duration::zero())] } else { vec![] }
        } else if n.task.is_some() {
            vec![Remind::Before(Duration::zero())]
        } else {
            settings.event_reminder_minutes.map(|m| vec![Remind::Before(Duration::minutes(m))]).unwrap_or_default()
        };
        let rules = if explicit.is_empty() { defaults } else { explicit };
        if rules.is_empty() {
            continue;
        }
        let occurrences = match (n.task, n.field("repeat").and_then(Repeat::parse)) {
            (None, Some(r)) => r.occurrences(&when, after.date() - Duration::days(1), until.date() + Duration::days(8)),
            _ => vec![when],
        };
        for occ in occurrences {
            for r in &rules {
                let at = r.instant(&occ, all_day);
                if at > after && at <= until {
                    out.push(Reminder {
                        key: format!("{}|{}|{}", n.id, occ.format(), at.format("%Y-%m-%d %H:%M")),
                        id: n.id.clone(),
                        text: crate::search::plain_text(&n.text),
                        human: occ.human_de(today),
                        at,
                        todo: n.task.is_some(),
                    });
                }
            }
        }
    }
    out.sort_by_key(|r| r.at);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn vault(text: &str) -> (tempfile::TempDir, Vault) {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("A.md"), text).unwrap();
        let v = Vault::open(tmp.path()).unwrap();
        (tmp, v)
    }

    #[test]
    fn collects_events_todos_and_overdue() {
        let (_t, v) = vault(
            "- Zahnarzt\n  date:: 2026-10-27 14:00\n- [ ] Bericht\n  date:: 2026-10-30\n- [ ] Alt\n  date:: 2026-10-20\n- [x] Fertig\n  date:: 2026-10-20\n  done:: 2026-10-26 09:00\n- Jour fixe\n  date:: 2026-10-05 09:00\n  repeat:: weekly\n- Später\n  date:: 2026-12-01\n",
        );
        let a = agenda(&v, d(2026, 10, 26), d(2026, 11, 1), d(2026, 10, 26));
        let texts: Vec<_> = a.entries.iter().map(|e| e.text.as_str()).collect();
        // Ganztägiges vor Einträgen mit Uhrzeit
        assert_eq!(texts, vec!["Fertig", "Jour fixe", "Zahnarzt", "Bericht"]);
        assert_eq!(a.overdue.len(), 1);
        assert_eq!(a.overdue[0].text, "Alt");
        assert_eq!(a.entries[1].when.start, d(2026, 10, 26));
        assert!(a.entries[1].repeat.is_some());
    }

    #[test]
    fn reminders_in_window() {
        let (_t, v) = vault("- Zahnarzt\n  date:: 2026-10-27 14:00\n- Call\n  date:: 2026-10-27 15:00\n  remind:: 1h, 5m\n- [ ] Abgabe\n  date:: 2026-10-27\n- [x] Erledigt\n  date:: 2026-10-27 13:55\n");
        let s = Settings::default();
        let at = |h, m| d(2026, 10, 27).and_hms_opt(h, m, 0).unwrap();
        let r = reminders(&v, &s, at(8, 0), at(16, 0));
        let got: Vec<_> = r.iter().map(|x| (x.text.as_str(), x.at.format("%H:%M").to_string())).collect();
        assert_eq!(got, vec![("Abgabe", "09:00".into()), ("Zahnarzt", "13:50".into()), ("Call", "14:00".into()), ("Call", "14:55".into())]);
        // Fenster ist links offen
        assert!(reminders(&v, &s, at(13, 50), at(13, 59)).is_empty());
    }
}
