// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Gemeinsames für Wochen- und Monatsansicht: Laden, Umschalter, neuer Termin.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { addDays, isoDate, parseIsoDate, startOfDay } from '../../lib/dates';
import { readableText } from '../../lib/links';
import { store, useStore, type Route } from '../../lib/store';
import type { Agenda, AgendaEntry, ParseResult } from '../../lib/types';
import { Popover, type Anchor } from '../../components/ui';
import { useReloadOnChange } from './common';
import { L } from '../../i18n';

export const isClosed = (e: AgendaEntry) => e.task === 'done' || e.task === 'cancelled';

export function mondayOf(d: Date): Date {
  const r = startOfDay(d);
  const wd = (r.getDay() + 6) % 7;
  return addDays(r, -wd);
}

/** ISO-Kalenderwoche der Woche, die mit `monday` beginnt. */
export function isoWeek(monday: Date): number {
  const d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3));
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** `2026-11` */
export function monthKey(d: Date): string {
  return isoDate(d).slice(0, 7);
}

/** Erster Tag des Monats aus `2026-11` (sonst `null`). */
export function parseMonthKey(s: string | undefined): Date | null {
  return s && /^\d{4}-\d{2}$/.test(s) ? parseIsoDate(`${s}-01`) : null;
}

/** Tooltip-Text eines Termins: wie angezeigt, ohne Link-Syntax. */
export function useTooltip(e: AgendaEntry): string {
  return useStore((s) => {
    const n = s.nodes[e.id];
    return n ? readableText(s.nodes, n, n.text) : e.text;
  });
}

/** Ganztägig oder über mehrere Tage (sonst ein Termin mit Uhrzeit an einem Tag). */
export function isAllDayish(e: AgendaEntry): boolean {
  return !e.when.startTime || (!!e.when.endDate && e.when.endDate !== e.when.start);
}

// ---------------------------------------------------------------------------
// Ansicht merken, Umschalter
// ---------------------------------------------------------------------------

export type CalendarMode = 'week' | 'month';

const MODE_KEY = 'hakobo-calendar';

export function rememberMode(m: CalendarMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* Speicher gesperrt */
  }
}

/** Kalender in der zuletzt genutzten Ansicht (Woche oder Monat). */
export function calendarRoute(): Route {
  let m: string | null = null;
  try {
    m = localStorage.getItem(MODE_KEY);
  } catch {
    /* Speicher gesperrt */
  }
  return m === 'month' ? { view: 'month' } : { view: 'week' };
}

/** Woche | Monat – jeweils um den Tag `day` herum. */
export function CalendarSwitch({ mode, day }: { mode: CalendarMode; day: Date }) {
  return (
    <div className="tabs" aria-label={L.views.calendar.switchLabel}>
      <button className={mode === 'week' ? 'is-active' : ''} aria-pressed={mode === 'week'} onClick={() => store().navigate({ view: 'week', start: isoDate(mondayOf(day)) })}>
        {L.common.week}
      </button>
      <button className={mode === 'month' ? 'is-active' : ''} aria-pressed={mode === 'month'} onClick={() => store().navigate({ view: 'month', month: monthKey(day) })}>
        {L.common.month}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------

/** Termine und Todos von `from` bis `to` (inkl. überfälliger Todos aus diesem Zeitraum). */
export function useAgenda(from: string, to: string) {
  const [data, setData] = useState<Agenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.agenda(from, to));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);
  useReloadOnChange(() => void load());
  const entries = data ? [...data.entries, ...data.overdue.filter((e) => e.when.start >= from && e.when.start <= to)] : [];
  return { entries, error, load };
}

// ---------------------------------------------------------------------------
// Neuer Termin
// ---------------------------------------------------------------------------

/** Vorbelegung: Tage `from`–`to` (ISO) und optional Uhrzeit bzw. Spanne („14:00“, „9-10:30“). */
export interface EventDraft {
  from: string;
  to: string;
  time: string;
}

/** Zeitangabe für `/termin` aus Von, Bis und Uhrzeit. */
export function composeWhen({ from, to, time }: EventDraft): string {
  const t = time.trim();
  if (to <= from) return t ? `${from} ${t}` : from;
  if (!t) return `${from} - ${to}`;
  // „14-16“ über mehrere Tage: Beginn am ersten, Ende am letzten Tag.
  const m = /^(.+?)\s*(?:-|–|\bbis\b|\bto\b)\s*(.+)$/i.exec(t);
  return m ? `${from} ${m[1]} - ${to} ${m[2]}` : `${from} ${t} - ${to}`;
}

/** `09:30` aus Minuten seit Mitternacht. */
export function clock(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, minutes));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function NewEventPopover({ anchor, draft, onClose, onCreated }: { anchor: Anchor; draft: EventDraft; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState(draft.from);
  const [to, setTo] = useState(draft.to);
  const [time, setTime] = useState(draft.time);
  const [when, setWhen] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const composed = composeWhen({ from, to: to < from ? from : to, time });
  // Eigene Datumsangaben im Text haben Vorrang (deutsche und englische Befehle).
  const ownDate = /(^|\s)\/(termin|datum|date|event|fällig|faellig|due|deadline|heute|morgen|today|tomorrow)/i.test(title);

  useEffect(() => {
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      api.parse('date', composed, ac.signal).then(setWhen, () => undefined);
    }, 60);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [composed]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      titleRef.current?.focus();
      return;
    }
    let value = when?.complete ? when.value : null;
    if (!ownDate && !value) {
      const r = await api.parse('date', composed);
      value = r?.complete ? r.value : null;
      if (!value) {
        store().toast(L.views.calendar.dateNotRecognized, 'error');
        return;
      }
    }
    setBusy(true);
    try {
      const r = await api.capture(ownDate ? title : `${title.trim()} /termin ${value}`);
      store().toast(L.views.calendar.eventCreated(r.node?.text ?? title), 'success', { label: L.common.open, run: () => store().reveal(r.id) });
      onCreated();
    } catch (err) {
      store().toast((err as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={340} className="field-pop ev-pop">
      {/* Klicks in Felder sollen fokussieren (das Popover verhindert das sonst). */}
      <form className="fp-body" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="fp-title">{L.views.calendar.newEvent}</div>
        <input ref={titleRef} className="input" autoFocus placeholder={L.views.calendar.titlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} aria-label={L.views.calendar.title} />
        <div className="ev-when">
          {/* Uhrzeit vor den Datumsfeldern: Tab läuft dort durch Tag, Monat und Jahr. */}
          <label className="ev-time">
            <span>{L.views.calendar.time}</span>
            <input className="input" value={time} placeholder={L.views.calendar.timePlaceholder} onChange={(e) => setTime(e.target.value)} disabled={busy} title={L.views.calendar.timeHint} />
          </label>
          <label>
            <span>{L.views.calendar.from}</span>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                // Bis rückt mit, damit die Dauer erhalten bleibt.
                const a = parseIsoDate(from);
                const b = parseIsoDate(to);
                const nv = parseIsoDate(v);
                if (a && b && nv) setTo(isoDate(addDays(nv, Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000)))));
                setFrom(v);
              }}
              disabled={busy}
            />
          </label>
          <label>
            <span>{L.views.calendar.to}</span>
            <input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} disabled={busy} />
          </label>
        </div>
        <div className={`fp-preview${ownDate || when?.complete ? ' is-ok' : ' is-bad'}`}>{ownDate ? L.views.calendar.dateFromText : when ? (when.complete ? when.human : `… ${when.human}`) : L.views.calendar.notRecognized}</div>
        <div className="fp-actions">
          <span className="fp-hint">{L.views.calendar.landsInInbox}</span>
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? <span className="spinner" /> : null} {L.views.calendar.create}
          </button>
        </div>
      </form>
    </Popover>
  );
}

/** Popover-Anker an einem Element. */
export function anchorOf(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom };
}

/** Tage zwischen zwei ISO-Daten (inklusive), aufsteigend. */
export function orderedRange(a: string, b: string): EventDraft {
  return a <= b ? { from: a, to: b, time: '' } : { from: b, to: a, time: '' };
}
