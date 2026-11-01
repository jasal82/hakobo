// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Wochenansicht: Zeitraster, ganztägige und mehrtägige Termine; neue Termine
// per Ziehen (Tage oder Uhrzeit), Doppelklick oder Tastatur.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, Repeat } from 'lucide-react';
import { addDays, isoDate, longDayLabel, parseIsoDate, startOfDay } from '../lib/dates';
import { store, useStore } from '../lib/store';
import type { AgendaEntry, Node } from '../lib/types';
import { RichText } from '../components/RichText';
import { TaskBox } from '../components/outline/fields';
import { activateKeys, moveFocus, type Anchor } from '../components/ui';
import { hhmm, minutesOf, nodeColor } from './parts/common';
import { anchorOf, CalendarSwitch, clock, isAllDayish, isClosed, isoWeek, mondayOf, NewEventPopover, orderedRange, rememberMode, useAgenda, useTooltip, type EventDraft } from './parts/calendar';

const HOUR = 44;
const DAY_MIN = 24 * 60;
const SLOT = 30;

interface Placed {
  e: AgendaEntry;
  start: number;
  end: number;
  col: number;
  cols: number;
}

/** Überlappende Termine eines Tages nebeneinander anordnen. */
function layoutDay(entries: AgendaEntry[]): Placed[] {
  const items = entries
    .map((e) => {
      const start = minutesOf(e.when.startTime);
      let end = e.when.endTime && !e.when.endDate ? minutesOf(e.when.endTime) : start + 30;
      if (end <= start) end = Math.min(start + 30, DAY_MIN);
      return { e, start, end: Math.max(end, start + 20), col: 0, cols: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let columns: number[] = [];
  const close = () => {
    for (const p of cluster) p.cols = columns.length;
    out.push(...cluster);
    cluster = [];
    columns = [];
  };
  for (const it of items) {
    if (it.start >= clusterEnd && cluster.length) close();
    let col = columns.findIndex((end) => end <= it.start);
    if (col < 0) {
      col = columns.length;
      columns.push(it.end);
    } else {
      columns[col] = it.end;
    }
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) close();
  return out;
}

function WeekEvent({ p }: { p: Placed }) {
  const node = useStore((s) => s.nodes[p.e.id]) as Node | undefined;
  const tooltip = useTooltip(p.e);
  const types = useStore((s) => s.types);
  const color = nodeColor(node, types) ?? 'var(--accent)';
  const short = p.end - p.start <= 35;
  return (
    <div
      className={`wk-event${isClosed(p.e) ? ' is-closed' : ''}${p.e.overdue ? ' is-overdue' : ''}${short ? ' is-short' : ''}`}
      style={{
        top: (p.start / 60) * HOUR,
        height: Math.max(((p.end - p.start) / 60) * HOUR - 2, 18),
        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
        width: `calc(${100 / p.cols}% - 4px)`,
        ['--ev-color' as string]: color,
      }}
      title={`${hhmm(p.e.when.startTime)}${p.e.when.endTime ? `–${hhmm(p.e.when.endTime)}` : ''} ${tooltip}`}
      role="button"
      tabIndex={0}
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => {
        ev.stopPropagation();
        if ((ev.target as HTMLElement).closest('a, button')) return;
        store().reveal(p.e.id, { edit: true });
      }}
      onKeyDown={activateKeys(() => store().reveal(p.e.id, { edit: true }))}
      onDoubleClick={(ev) => ev.stopPropagation()}
    >
      <span className="wk-event-time">
        {hhmm(p.e.when.startTime)}
        {p.e.repeat && <Repeat size={10} />}
      </span>
      <span className="wk-event-text">
        {p.e.kind === 'todo' && node && <TaskBox node={node} size={12} />}
        {node ? <RichText text={node.text} source={node} /> : <RichText text={p.e.text} />}
      </span>
    </div>
  );
}

function AllDayChip({ e }: { e: AgendaEntry }) {
  const node = useStore((s) => s.nodes[e.id]) as Node | undefined;
  const tooltip = useTooltip(e);
  const types = useStore((s) => s.types);
  const color = nodeColor(node, types);
  return (
    <div
      className={`wk-allday-item${isClosed(e) ? ' is-closed' : ''}${e.overdue ? ' is-overdue' : ''}${e.kind === 'todo' ? ' is-todo' : ''}`}
      style={color ? { ['--ev-color' as string]: color } : undefined}
      title={tooltip}
      role="button"
      tabIndex={0}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest('a, button')) return;
        store().reveal(e.id, { edit: true });
      }}
      onKeyDown={activateKeys(() => store().reveal(e.id, { edit: true }))}
    >
      {e.kind === 'todo' && node && <TaskBox node={node} size={12} />}
      {e.when.startTime && <span className="wk-allday-time">{hhmm(e.when.startTime)}</span>}
      <span className="wk-allday-text">{node ? <RichText text={node.text} source={node} /> : <RichText text={e.text} />}</span>
    </div>
  );
}

/** Auswahl im Raster: Tage (Spalten) oder eine Uhrzeit-Spanne an einem Tag. */
type Selection = { kind: 'days'; a: number; b: number } | { kind: 'time'; col: number; a: number; b: number };

export function WeekView({ start }: { start?: string }) {
  const today = startOfDay();
  const monday = useMemo(() => mondayOf((start && parseIsoDate(start)) || new Date()), [start]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const fromIso = isoDate(days[0]);
  const toIso = isoDate(days[6]);
  const { entries: all, error, load } = useAgenda(fromIso, toIso);
  const [create, setCreate] = useState<{ anchor: Anchor; draft: EventDraft; sel: Selection } | null>(null);
  // Auswahl während des Ziehens bzw. per Umschalt+Pfeiltasten in den Tagesköpfen
  const [sel, setSel] = useState<Selection | null>(null);
  const [now, setNow] = useState(() => new Date());
  const scroller = useRef<HTMLDivElement>(null);
  const alldayRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  useEffect(() => rememberMode('week'), []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR - 6;
  }, [monday]);

  const timed = all.filter((e) => !isAllDayish(e));
  // Ganztägige und mehrtägige: Spalten (1–7) und Länge
  const allDayPlaced = all
    .filter(isAllDayish)
    .map((e) => {
      const s = e.when.start < fromIso ? fromIso : e.when.start;
      const endIso = e.when.endDate ?? e.when.start;
      const en = endIso > toIso ? toIso : endIso;
      const startCol = days.findIndex((d) => isoDate(d) === s);
      const endCol = days.findIndex((d) => isoDate(d) === en);
      return { e, col: Math.max(0, startCol), span: Math.max(1, (endCol < 0 ? 6 : endCol) - Math.max(0, startCol) + 1) };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span);

  const go = (offset: number | null) => {
    if (offset === null) store().navigate({ view: 'week' });
    else store().navigate({ view: 'week', start: isoDate(addDays(monday, offset)) });
  };

  const kw = isoWeek(monday);
  const monthLabel = useMemo(() => {
    const f = (d: Date) => d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const a = f(days[0]);
    const b = f(days[6]);
    return a === b ? a : `${days[0].toLocaleDateString('de-DE', { month: 'long' })} – ${b}`;
  }, [days]);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const thisWeek = days.some((d) => isoDate(d) === isoDate(today));

  // ---- Neue Termine -------------------------------------------------------

  const openDays = (a: number, b: number, anchor: Anchor) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    setSel(null);
    setCreate({ anchor, draft: orderedRange(isoDate(days[lo]), isoDate(days[hi])), sel: { kind: 'days', a: lo, b: hi } });
  };

  const openTime = (col: number, a: number, b: number | null, anchor: Anchor) => {
    setSel(null);
    setCreate({ anchor, draft: { from: isoDate(days[col]), to: isoDate(days[col]), time: b === null ? clock(a) : `${clock(a)}-${clock(b)}` }, sel: { kind: 'time', col, a, b: b ?? a + SLOT } });
  };

  /** Spalte (0–6) unter der Mausposition. */
  const colAt = (x: number) => {
    const r = alldayRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(6, Math.floor(((x - r.left) / r.width) * 7)));
  };

  /** Ziehen über Tagesköpfe oder die Ganztags-Zeile: ein- oder mehrtägiger Termin. */
  const dragDays = (ev: MouseEvent) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('.wk-allday-item')) return;
    ev.preventDefault();
    const a = colAt(ev.clientX);
    let b = a;
    setSel({ kind: 'days', a, b });
    const move = (e: globalThis.MouseEvent) => {
      const c = colAt(e.clientX);
      if (c !== b) {
        b = c;
        setSel({ kind: 'days', a, b });
      }
    };
    const up = (e: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      openDays(a, b, { left: e.clientX, top: e.clientY, bottom: e.clientY + 4 });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Ziehen im Zeitraster: Termin mit Beginn und Ende (in halben Stunden). */
  const dragTime = (ev: MouseEvent<HTMLDivElement>, col: number) => {
    if (ev.button !== 0 || ev.target !== ev.currentTarget) return;
    ev.preventDefault();
    const el = ev.currentTarget;
    const minAt = (y: number) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(DAY_MIN, ((y - r.top) / r.height) * DAY_MIN));
    };
    const a0 = Math.min(DAY_MIN - SLOT, Math.floor(minAt(ev.clientY) / SLOT) * SLOT);
    const y0 = ev.clientY;
    let range = { a: a0, b: a0 + SLOT };
    let moved = false;
    const move = (e: globalThis.MouseEvent) => {
      if (!moved && Math.abs(e.clientY - y0) < 4) return;
      moved = true;
      const m = minAt(e.clientY);
      range = m >= a0 ? { a: a0, b: Math.max(a0 + SLOT, Math.ceil(m / SLOT) * SLOT) } : { a: Math.floor(m / SLOT) * SLOT, b: a0 + SLOT };
      setSel({ kind: 'time', col, ...range });
    };
    const up = (e: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      // Einfacher Klick legt nichts an (dafür Doppelklick).
      if (moved) openTime(col, range.a, range.b, { left: e.clientX, top: e.clientY, bottom: e.clientY + 4 });
      else setSel(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Tastatur in den Tagesköpfen: Umschalt+← → wählt mehrere Tage, Bild↑/↓ blättert. */
  const headKeys = (ev: KeyboardEvent<HTMLButtonElement>, col: number) => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (ev.key === 'PageUp' || ev.key === 'PageDown') {
      ev.preventDefault();
      go(ev.key === 'PageUp' ? -7 : 7);
    } else if (ev.key === 'Escape' && sel) {
      ev.preventDefault();
      setSel(null);
    } else if (ev.shiftKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      ev.preventDefault();
      const next = Math.max(0, Math.min(6, col + (ev.key === 'ArrowLeft' ? -1 : 1)));
      setSel((s) => ({ kind: 'days', a: s?.kind === 'days' ? s.a : col, b: next }));
      headRef.current?.querySelectorAll<HTMLElement>('.wk-col-head')[next]?.focus();
    } else if (ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End') {
      setSel(null);
    }
  };

  // Markierung: laufende Auswahl, sonst die des offenen „Neuer Termin“.
  const shown = sel ?? create?.sel ?? null;
  const dayLo = shown?.kind === 'days' ? Math.min(shown.a, shown.b) : -1;
  const dayHi = shown?.kind === 'days' ? Math.max(shown.a, shown.b) : -1;

  return (
    <div
      className="wk-view"
      onKeyDown={(ev) => {
        // ↑ ↓ zwischen den Terminen, ← → zwischen den Tagesköpfen.
        const t = ev.target as HTMLElement;
        if (t.matches('.wk-event, .wk-allday-item')) moveFocus(ev, ev.currentTarget, '.wk-allday-item, .wk-event');
        else if (t.matches('.wk-col-head')) moveFocus(ev, ev.currentTarget, '.wk-col-head', { horizontal: true });
      }}
    >
      <div className="wk-head">
        <h1>{monthLabel}</h1>
        <span className="wk-kw">KW {kw}</span>
        <span className="spacer" />
        <CalendarSwitch mode="week" day={thisWeek ? today : monday} />
        <div className="wk-nav">
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => go(-7)} aria-label="Vorige Woche" title="Vorige Woche (Bild↑)">
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-sm" onClick={() => go(null)} disabled={thisWeek}>
            Heute
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => go(7)} aria-label="Nächste Woche" title="Nächste Woche (Bild↓)">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {error && (
        <div className="ag-error">
          <CircleAlert size={15} /> {error}
        </div>
      )}

      <div className="wk-grid-head" ref={headRef}>
        <div className="wk-gutter" />
        {days.map((d, i) => {
          const isToday = isoDate(d) === isoDate(today);
          return (
            <button
              key={isoDate(d)}
              className={`wk-col-head${isToday ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : ''}${i >= dayLo && i <= dayHi ? ' is-selected' : ''}`}
              title={`Neuer Termin am ${longDayLabel(d)} (ziehen: mehrere Tage)`}
              onMouseDown={dragDays}
              onClick={(ev) => {
                // Mit der Maus übernimmt das Ziehen; hier nur Enter und Leertaste.
                if (ev.detail !== 0) return;
                const s = sel?.kind === 'days' ? sel : { a: i, b: i };
                openDays(s.a, s.b, anchorOf(ev.currentTarget));
              }}
              onKeyDown={(ev) => headKeys(ev, i)}
            >
              <span className="wk-wd">{d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}</span>
              <span className="wk-date">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="wk-allday">
        <div className="wk-gutter wk-allday-label">ganztägig</div>
        <div className="wk-allday-grid" ref={alldayRef} onMouseDown={dragDays} title="Klicken oder über mehrere Tage ziehen: neuer Termin">
          {dayLo >= 0 && <div className="wk-day-sel" style={{ left: `${(dayLo / 7) * 100}%`, width: `${((dayHi - dayLo + 1) / 7) * 100}%` }} />}
          {allDayPlaced.map(({ e, col, span }) => (
            <div key={`${e.id}|${e.value}`} style={{ gridColumn: `${col + 1} / span ${span}` }}>
              <AllDayChip e={e} />
            </div>
          ))}
        </div>
      </div>

      <div className="wk-scroll" ref={scroller}>
        <div className="wk-body" style={{ height: 24 * HOUR }}>
          <div className="wk-gutter wk-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="wk-hour" style={{ top: h * HOUR }}>
                {h > 0 ? `${String(h).padStart(2, '0')}:00` : ''}
              </span>
            ))}
          </div>
          {days.map((d, i) => {
            const iso = isoDate(d);
            const placed = layoutDay(timed.filter((e) => e.when.start === iso));
            const isToday = iso === isoDate(today);
            const timeSel = shown?.kind === 'time' && shown.col === i ? shown : null;
            return (
              <div
                key={iso}
                className={`wk-col${isToday ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : ''}`}
                onMouseDown={(ev) => dragTime(ev, i)}
                onDoubleClick={(ev) => {
                  if (ev.target !== ev.currentTarget) return;
                  const r = ev.currentTarget.getBoundingClientRect();
                  const minutes = Math.max(0, Math.min(DAY_MIN - SLOT, Math.floor((((ev.clientY - r.top) / r.height) * DAY_MIN) / SLOT) * SLOT));
                  openTime(i, minutes, null, { left: ev.clientX, top: ev.clientY, bottom: ev.clientY + 4 });
                }}
                title="Ziehen oder Doppelklick: neuer Termin"
              >
                {timeSel && (
                  <div className="wk-sel" style={{ top: (timeSel.a / 60) * HOUR, height: ((timeSel.b - timeSel.a) / 60) * HOUR }}>
                    {clock(timeSel.a)}–{clock(timeSel.b)}
                  </div>
                )}
                {placed.map((p) => (
                  <WeekEvent key={`${p.e.id}|${p.e.value}`} p={p} />
                ))}
                {isToday && <div className="wk-now" style={{ top: (nowMin / 60) * HOUR }} />}
              </div>
            );
          })}
        </div>
      </div>

      {create && (
        <NewEventPopover
          anchor={create.anchor}
          draft={create.draft}
          onClose={() => setCreate(null)}
          onCreated={() => {
            setCreate(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
