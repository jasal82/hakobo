// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Agenda: Liste der nächsten Tage (Woche und Monat: WeekView, MonthView).

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, CircleAlert, Plus, Repeat } from 'lucide-react';
import { api, type CapturePreview } from '../lib/api';
import { addDays, dayLabel, isoDate, longDayLabel, parseIsoDate, startOfDay } from '../lib/dates';
import { store, useStore } from '../lib/store';
import type { Agenda, AgendaEntry, Node } from '../lib/types';
import { RichText, openTag } from '../components/RichText';
import { TaskBox } from '../components/outline/fields';
import { activateKeys, moveFocus } from '../components/ui';
import { hhmm, hiddenTags, nodeColor, pathOf, useReloadOnChange } from './parts/common';
import { isClosed } from './parts/calendar';
import { L } from '../i18n';

function readNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Speicher gesperrt */
  }
}

/** Zeitangabe eines Eintrags für die Liste. */
function timeLabel(e: AgendaEntry, today: Date): string {
  const w = e.when;
  const multi = w.endDate && w.endDate !== w.start;
  if (multi) {
    const end = parseIsoDate(w.endDate!);
    return `${L.views.agenda.until(end ? dayLabel(end, today) : w.endDate!)}${w.endTime ? ` ${hhmm(w.endTime)}` : ''}`;
  }
  if (w.startTime) return w.endTime ? `${hhmm(w.startTime)}–${hhmm(w.endTime)}` : hhmm(w.startTime);
  return e.kind === 'event' ? L.views.agenda.allDay : '';
}

// ---------------------------------------------------------------------------
// Schnelleingabe
// ---------------------------------------------------------------------------

function QuickAdd({ onAdded, placeholder }: { onAdded: () => void; placeholder: string }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      api.capturePreview(text, ac.signal).then(setPreview, () => undefined);
    }, 120);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [text]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.capture(text);
      store().toast(L.views.agenda.addedToInbox(`${r.node?.text ?? text}${r.summary.length ? ` · ${r.summary.join(' · ')}` : ''}`), 'success', {
        label: L.common.open,
        run: () => store().reveal(r.id),
      });
      setText('');
      onAdded();
    } catch (err) {
      store().toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="ag-quick" onSubmit={submit}>
      <Plus size={16} className="ag-quick-icon" />
      <input className="ag-quick-input" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} disabled={busy} />
      {preview && (preview.summary.length > 0 || preview.task) && (
        <div className="ag-quick-preview">
          {preview.task && <span className="chip">{L.views.agenda.todoChip}</span>}
          {preview.summary.map((s) => (
            <span className="chip is-soon" key={s}>
              {s}
            </span>
          ))}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

function EntryRow({ e, today, showDate }: { e: AgendaEntry; today: Date; showDate?: boolean }) {
  const node = useStore((s) => s.nodes[e.id]) as Node | undefined;
  const nodes = useStore((s) => s.nodes);
  const types = useStore((s) => s.types);
  const color = nodeColor(node, types);
  const extra = hiddenTags(node, e.tags);
  const path = node ? pathOf(nodes, e.id) : e.page;
  return (
    <div
      className={`ag-entry${isClosed(e) ? ' is-closed' : ''}${e.overdue ? ' is-overdue' : ''}`}
      role="button"
      tabIndex={0}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest('a, button')) return;
        store().reveal(e.id, { edit: true });
      }}
      onKeyDown={activateKeys(() => store().reveal(e.id, { edit: true }))}
    >
      <span className="ag-time">{showDate ? e.human : timeLabel(e, today)}</span>
      <span className="ag-mark">
        {e.kind === 'todo' && node ? <TaskBox node={node} /> : <span className="ag-dot" style={color ? { background: color } : undefined} />}
      </span>
      <span className="ag-main">
        <span className="ag-text">{node ? <RichText text={node.text} source={node} /> : <RichText text={e.text} />}</span>
        <span className="ag-meta">
          {e.repeat && (
            <span className="ag-repeat" title={L.views.agenda.repeat}>
              <Repeat size={12} /> {e.repeat}
            </span>
          )}
          {extra.map((t) => (
            <a key={t} className="tag" onClick={() => openTag(t)}>
              #{t}
            </a>
          ))}
          {path && <span className="ag-path">{path}</span>}
        </span>
      </span>
    </div>
  );
}

export function AgendaView() {
  const [days, setDays] = useState(() => readNum('hakobo-agenda-days', 14));
  const [showDone, setShowDone] = useState(() => {
    try {
      return localStorage.getItem('hakobo-agenda-done') === '1';
    } catch {
      return false;
    }
  });
  const [data, setData] = useState<Agenda | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = startOfDay();
    try {
      setData(await api.agenda(isoDate(today), isoDate(addDays(today, days - 1))));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);
  useReloadOnChange(() => void load());

  const today = startOfDay();
  const groups = useMemo(() => {
    if (!data) return [];
    const out: { date: Date; iso: string; entries: AgendaEntry[] }[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(today, i);
      out.push({ date: d, iso: isoDate(d), entries: [] });
    }
    const fromIso = out[0]?.iso ?? '';
    for (const e of data.entries) {
      if (!showDone && isClosed(e)) continue;
      const key = e.when.start < fromIso ? fromIso : e.when.start;
      out.find((g) => g.iso === key)?.entries.push(e);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, days, showDone, today.getTime()]);

  const total = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div
      className="view ag-view"
      onKeyDown={(ev) => {
        // ↑ ↓ zwischen den Einträgen.
        if ((ev.target as HTMLElement).matches('.ag-entry')) moveFocus(ev, ev.currentTarget, '.ag-entry');
      }}
    >
      <div className="view-inner">
        <div className="view-head">
          <h1>{L.common.agenda}</h1>
          <div className="tabs" role="tablist">
            {[7, 14, 30].map((n) => (
              <button
                key={n}
                className={days === n ? 'is-active' : ''}
                onClick={() => {
                  setDays(n);
                  writeLocal('hakobo-agenda-days', String(n));
                }}
              >
                {L.views.agenda.days(n)}
              </button>
            ))}
          </div>
          <label className="switch ag-done-toggle">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => {
                setShowDone(e.target.checked);
                writeLocal('hakobo-agenda-done', e.target.checked ? '1' : '0');
              }}
            />
            {L.views.agenda.showDone}
          </label>
        </div>

        <QuickAdd onAdded={() => void load()} placeholder={L.views.agenda.quickPlaceholder} />

        {error && (
          <div className="ag-error">
            <CircleAlert size={15} /> {error}
          </div>
        )}
        {!data && !error && (
          <div className="boot">
            <div className="spinner" />
          </div>
        )}

        {data && data.overdue.length > 0 && (
          <section className="ag-day is-overdue">
            <h2 className="ag-day-head">
              <CircleAlert size={15} /> {L.views.agenda.overdue} <span className="ag-count">{data.overdue.length}</span>
            </h2>
            {data.overdue.map((e) => (
              <EntryRow key={`${e.id}|${e.value}`} e={e} today={today} showDate />
            ))}
          </section>
        )}

        {data &&
          groups.map((g, i) => {
            if (!g.entries.length && i >= 7) return null;
            const diff = i;
            return (
              <section key={g.iso} className={`ag-day${diff === 0 ? ' is-today' : diff === 1 ? ' is-tomorrow' : ''}${g.date.getDay() === 0 || g.date.getDay() === 6 ? ' is-weekend' : ''}`}>
                <h2 className="ag-day-head">
                  {longDayLabel(g.date, today)}
                  {g.entries.length > 0 && <span className="ag-count">{g.entries.length}</span>}
                </h2>
                {g.entries.length ? g.entries.map((e) => <EntryRow key={`${e.id}|${e.value}`} e={e} today={today} />) : <div className="ag-nothing">{L.views.agenda.nothingPlanned}</div>}
              </section>
            );
          })}

        {data && total === 0 && data.overdue.length === 0 && (
          <div className="empty ag-empty">
            <CalendarClock size={28} />
            <h3>{L.views.agenda.emptyTitle}</h3>
            <p>
              {L.views.agenda.emptyBefore} <kbd>{L.views.agenda.emptyExamples[0]}</kbd>, <kbd>{L.views.agenda.emptyExamples[1]}</kbd>
              {L.views.agenda.emptyOr}
              <kbd>{L.views.agenda.emptyExamples[2]}</kbd>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
