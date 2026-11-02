// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Monatsansicht: Wochen als Zeilen, mehrtägige Termine als durchgehende Balken.
// Neue Termine per Klick oder Ziehen über Tage bzw. per Tastatur (Pfeiltasten,
// Umschalt für mehrere Tage, Enter).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, Plus, Repeat } from 'lucide-react';
import { addDays, isoDate, longDayLabel, parseIsoDate, startOfDay } from '../lib/dates';
import { store, useStore } from '../lib/store';
import type { AgendaEntry, Node } from '../lib/types';
import { RichText } from '../components/RichText';
import { TaskBox } from '../components/outline/fields';
import { activateKeys, moveFocus, Popover, type Anchor } from '../components/ui';
import { hhmm, minutesOf, nodeColor } from './parts/common';
import { L, locale } from '../i18n';
import { anchorOf, CalendarSwitch, isAllDayish, isClosed, isoWeek, mondayOf, monthKey, NewEventPopover, orderedRange, parseMonthKey, rememberMode, useAgenda, useTooltip, type EventDraft } from './parts/calendar';

/** Höhe der Datumszeile, einer Termin-Zeile und des Abstands (px). */
const DATE_H = 26;
const LANE_H = 20;
const GAP = 2;

/** Ein Termin in einer Wochenzeile: Spalten `c0`–`c1`, Zeile `lane`. */
interface Seg {
  e: AgendaEntry;
  c0: number;
  c1: number;
  lane: number;
  /** Beginnt vor bzw. endet nach dieser Woche. */
  contL: boolean;
  contR: boolean;
}

interface WeekRow {
  days: Date[];
  segs: Seg[];
}

const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** Termine einer Woche auf Zeilen verteilen (längere Balken zuerst). */
function layoutWeek(days: Date[], entries: AgendaEntry[]): Seg[] {
  const from = isoDate(days[0]);
  const to = isoDate(days[6]);
  const isos = days.map(isoDate);
  const segs: Seg[] = [];
  for (const e of entries) {
    const s = e.when.start;
    const en = e.when.endDate ?? s;
    if (en < from || s > to) continue;
    segs.push({ e, c0: s < from ? 0 : isos.indexOf(s), c1: en > to ? 6 : isos.indexOf(en), lane: 0, contL: s < from, contR: en > to });
  }
  segs.sort(
    (a, b) =>
      a.c0 - b.c0 ||
      b.c1 - b.c0 - (a.c1 - a.c0) ||
      Number(!isAllDayish(a.e)) - Number(!isAllDayish(b.e)) ||
      minutesOf(a.e.when.startTime) - minutesOf(b.e.when.startTime) ||
      Number(isClosed(a.e)) - Number(isClosed(b.e)) ||
      a.e.text.localeCompare(b.e.text),
  );
  const used: boolean[][] = [];
  for (const g of segs) {
    let lane = 0;
    while (used[lane]?.slice(g.c0, g.c1 + 1).some(Boolean)) lane++;
    used[lane] ??= Array(7).fill(false);
    for (let c = g.c0; c <= g.c1; c++) used[lane][c] = true;
    g.lane = lane;
  }
  return segs;
}

function MonthEntry({ g, row }: { g: Seg; row?: number }) {
  const e = g.e;
  const node = useStore((s) => s.nodes[e.id]) as Node | undefined;
  const tooltip = useTooltip(e);
  const types = useStore((s) => s.types);
  const color = nodeColor(node, types);
  const bar = isAllDayish(e);
  const todo = e.kind === 'todo';
  return (
    <div
      className={`mo-ev${bar ? ' is-bar' : ''}${todo ? ' is-todo' : ''}${isClosed(e) ? ' is-closed' : ''}${e.overdue ? ' is-overdue' : ''}${g.contL ? ' cont-l' : ''}${g.contR ? ' cont-r' : ''}`}
      style={{ gridColumn: `${g.c0 + 1} / span ${g.c1 - g.c0 + 1}`, gridRow: row, ['--ev-color' as string]: color ?? 'var(--accent)' }}
      title={`${e.human} · ${tooltip}`}
      role="button"
      tabIndex={0}
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest('a, button')) return;
        store().reveal(e.id, { edit: true });
      }}
      onKeyDown={activateKeys(() => store().reveal(e.id, { edit: true }))}
    >
      {todo && node ? <TaskBox node={node} size={12} /> : !bar && <span className="mo-ev-dot" />}
      {e.when.startTime && !g.contL && <span className="mo-ev-time">{hhmm(e.when.startTime)}</span>}
      {e.repeat && <Repeat size={10} className="mo-ev-repeat" />}
      <span className="mo-ev-text">{node ? <RichText text={node.text} source={node} /> : <RichText text={e.text} />}</span>
    </div>
  );
}

/** Alle Termine eines Tages (bei „+ weitere“) und ein neuer Termin. */
function DayPopover({ anchor, day, segs, onClose, onNew }: { anchor: Anchor; day: Date; segs: Seg[]; onClose: () => void; onNew: () => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} className="mo-day-pop">
      <div className="fp-title">{longDayLabel(day)}</div>
      <div className="mo-day-list">
        {segs.map((g) => (
          <MonthEntry key={`${g.e.id}|${g.e.value}`} g={{ ...g, c0: 0, c1: 0, contL: false, contR: false }} />
        ))}
      </div>
      <div className="menu">
        <button className="menu-item" onClick={onNew}>
          <span className="menu-icon">
            <Plus size={14} />
          </span>
          <span className="menu-label">{L.views.calendar.newEvent}</span>
        </button>
      </div>
    </Popover>
  );
}

export function MonthView({ month }: { month?: string }) {
  const today = startOfDay();
  const todayIso = isoDate(today);
  const first = useMemo(() => parseMonthKey(month) ?? new Date(today.getFullYear(), today.getMonth(), 1), [month, today.getFullYear(), today.getMonth()]);
  const gridStart = useMemo(() => mondayOf(first), [first]);
  const weeks = useMemo(() => {
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return Math.round((mondayOf(last).getTime() - gridStart.getTime()) / (7 * 86400000)) + 1;
  }, [first, gridStart]);
  const days = useMemo(() => Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i)), [gridStart, weeks]);
  const fromIso = isoDate(days[0]);
  const toIso = isoDate(days[days.length - 1]);
  const { entries, error, load } = useAgenda(fromIso, toIso);

  // Tag mit Tastaturfokus (nur er ist per Tab erreichbar), Auswahl über mehrere Tage
  const [cursor, setCursor] = useState(() => (sameMonth(today, first) ? todayIso : isoDate(first)));
  const [sel, setSel] = useState<{ a: string; b: string } | null>(null);
  const [create, setCreate] = useState<{ anchor: Anchor; draft: EventDraft } | null>(null);
  const [more, setMore] = useState<{ anchor: Anchor; day: Date; segs: Seg[] } | null>(null);
  const [lanes, setLanes] = useState(3);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusCursor = useRef(false);

  useEffect(() => rememberMode('month'), []);

  // Anderer Monat (Knöpfe, Verlauf): Cursor auf heute bzw. den Ersten.
  const cursorDate = parseIsoDate(cursor) ?? first;
  useEffect(() => {
    if (!sameMonth(cursorDate, first)) setCursor(sameMonth(today, first) ? todayIso : isoDate(first));
    setSel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  // Nach Tastatur-Navigation den Fokus auf den neuen Tag setzen.
  useLayoutEffect(() => {
    if (!focusCursor.current) return;
    focusCursor.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus();
  });

  // Wie viele Termin-Zeilen passen in eine Woche?
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.querySelector<HTMLElement>('.mo-days')?.clientHeight ?? 0;
      setLanes(Math.max(1, Math.floor((h - DATE_H - 4 + GAP) / (LANE_H + GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks]);

  const rows: WeekRow[] = useMemo(
    () =>
      Array.from({ length: weeks }, (_, r) => {
        const wd = days.slice(r * 7, r * 7 + 7);
        return { days: wd, segs: layoutWeek(wd, entries) };
      }),
    [days, weeks, entries],
  );

  const go = (offset: number | null) => {
    if (offset === null) store().navigate({ view: 'month' });
    else store().navigate({ view: 'month', month: monthKey(new Date(first.getFullYear(), first.getMonth() + offset, 1)) });
  };
  const thisMonth = sameMonth(today, first);
  const title = first.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });

  // ---- Neue Termine -------------------------------------------------------

  const openRange = (a: string, b: string, anchor: Anchor) => {
    setSel(null);
    setMore(null);
    setCreate({ anchor, draft: orderedRange(a, b) });
  };

  /** Tag unter der Mausposition (ISO). */
  const dayAt = (x: number, y: number): string | null => {
    const rowsEl = gridRef.current?.querySelectorAll<HTMLElement>('.mo-days');
    if (!rowsEl?.length) return null;
    let r = 0;
    rowsEl.forEach((el, i) => {
      if (y >= el.getBoundingClientRect().top) r = i;
    });
    const rect = rowsEl[r].getBoundingClientRect();
    const c = Math.max(0, Math.min(6, Math.floor(((x - rect.left) / rect.width) * 7)));
    return isoDate(days[r * 7 + c]);
  };

  /** Klicken oder über mehrere Tage ziehen. */
  const drag = (ev: MouseEvent<HTMLElement>, iso: string) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.currentTarget.focus({ preventScroll: true });
    setCursor(iso);
    let b = iso;
    setSel({ a: iso, b });
    const move = (e: globalThis.MouseEvent) => {
      const d = dayAt(e.clientX, e.clientY);
      if (d && d !== b) {
        b = d;
        setSel({ a: iso, b });
      }
    };
    const up = (e: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      openRange(iso, b, { left: e.clientX, top: e.clientY, bottom: e.clientY + 4 });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Pfeiltasten (mit Umschalt: Auswahl), Pos1/Ende, Bild↑/↓, Enter. */
  const cellKeys = (ev: KeyboardEvent<HTMLElement>, d: Date) => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const iso = isoDate(d);
    const wd = (d.getDay() + 6) % 7;
    let next: Date | null = null;
    switch (ev.key) {
      case 'ArrowLeft':
        next = addDays(d, -1);
        break;
      case 'ArrowRight':
        next = addDays(d, 1);
        break;
      case 'ArrowUp':
        next = addDays(d, -7);
        break;
      case 'ArrowDown':
        next = addDays(d, 7);
        break;
      case 'Home':
        next = addDays(d, -wd);
        break;
      case 'End':
        next = addDays(d, 6 - wd);
        break;
      case 'PageUp':
      case 'PageDown': {
        const m = new Date(d.getFullYear(), d.getMonth() + (ev.key === 'PageUp' ? -1 : 1), 1);
        next = new Date(m.getFullYear(), m.getMonth(), Math.min(d.getDate(), new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()));
        break;
      }
      case 'Enter':
      case ' ':
        ev.preventDefault();
        openRange(sel?.a ?? iso, sel?.b ?? iso, anchorOf(ev.currentTarget));
        return;
      case 'Escape':
        if (sel) {
          ev.preventDefault();
          setSel(null);
        }
        return;
      default:
        return;
    }
    ev.preventDefault();
    const nIso = isoDate(next);
    if (ev.shiftKey && !ev.key.startsWith('Page')) setSel({ a: sel?.a ?? iso, b: nIso });
    else setSel(null);
    focusCursor.current = true;
    setCursor(nIso);
    if (!sameMonth(next, first)) store().navigate({ view: 'month', month: monthKey(next) });
  };

  // Markierung: laufende Auswahl, sonst der Zeitraum des offenen „Neuer Termin“.
  const range = sel ? orderedRange(sel.a, sel.b) : create?.draft;

  return (
    <div
      className="wk-view mo-view"
      onKeyDown={(ev) => {
        // ↑ ↓ zwischen den Terminen
        if ((ev.target as HTMLElement).matches('.mo-grid .mo-ev, .mo-more')) moveFocus(ev, ev.currentTarget, '.mo-grid .mo-ev, .mo-more');
      }}
    >
      <div className="wk-head">
        <h1>{title}</h1>
        <span className="spacer" />
        <CalendarSwitch mode="month" day={cursorDate} />
        <div className="wk-nav">
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => go(-1)} aria-label={L.views.calendar.prevMonth} title={L.views.calendar.withKey(L.views.calendar.prevMonth, true)}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-sm" onClick={() => go(null)} disabled={thisMonth}>
            {L.common.today}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => go(1)} aria-label={L.views.calendar.nextMonth} title={L.views.calendar.withKey(L.views.calendar.nextMonth, false)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {error && (
        <div className="ag-error">
          <CircleAlert size={15} /> {error}
        </div>
      )}

      <div className="mo-weekdays" aria-hidden="true">
        <span className="mo-kw-head">{L.views.calendar.weekShort}</span>
        {/* Montag zuerst */}
        {[1, 2, 3, 4, 5, 6, 0].map((i) => (
          <span key={i}>{L.dates.weekdaysShort[i]}</span>
        ))}
      </div>

      <div className="mo-grid" ref={gridRef} role="grid" aria-label={L.views.calendar.gridLabel(title)} style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {rows.map((row) => {
          // Läuft eine Zeile über, bleibt die letzte für „+ weitere“.
          const overflow = row.segs.some((g) => g.lane >= lanes);
          const visible = overflow ? Math.max(0, lanes - 1) : lanes;
          const hidden = Array.from({ length: 7 }, (_, c) => row.segs.filter((g) => g.lane >= visible && g.c0 <= c && g.c1 >= c));
          const monday = row.days[0];
          return (
            <div className="mo-week" role="row" key={isoDate(monday)}>
              <button className="mo-kw" tabIndex={-1} title={L.views.calendar.viewWeek} onClick={() => store().navigate({ view: 'week', start: isoDate(monday) })}>
                {isoWeek(monday)}
              </button>
              <div className="mo-days">
                {row.days.map((d) => {
                  const iso = isoDate(d);
                  const inRange = !!range && iso >= range.from && iso <= range.to;
                  return (
                    <div
                      key={iso}
                      role="gridcell"
                      data-day={iso}
                      tabIndex={iso === cursor ? 0 : -1}
                      aria-selected={inRange}
                      aria-label={longDayLabel(d)}
                      className={`mo-day${sameMonth(d, first) ? '' : ' is-out'}${iso === todayIso ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : ''}${inRange ? ' is-selected' : ''}`}
                      onMouseDown={(ev) => drag(ev, iso)}
                      onFocus={() => setCursor(iso)}
                      onKeyDown={(ev) => cellKeys(ev, d)}
                      title={L.views.calendar.clickOrDrag}
                    >
                      <span className="mo-date">{d.getDate() === 1 ? d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : d.getDate()}</span>
                    </div>
                  );
                })}
                <div className="mo-lanes" style={{ top: DATE_H, gridAutoRows: LANE_H, rowGap: GAP }}>
                  {row.segs
                    .filter((g) => g.lane < visible)
                    .map((g) => (
                      <MonthEntry key={`${g.e.id}|${g.e.value}`} g={g} row={g.lane + 1} />
                    ))}
                  {hidden.map((list, c) =>
                    list.length ? (
                      <button
                        key={`more${c}`}
                        className="mo-more"
                        style={{ gridColumn: c + 1, gridRow: visible + 1 }}
                        onMouseDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => {
                          const d = row.days[c];
                          const all = row.segs.filter((g) => g.c0 <= c && g.c1 >= c).sort((a, b) => a.lane - b.lane);
                          setMore({ anchor: anchorOf(ev.currentTarget), day: d, segs: all });
                        }}
                      >
                        {L.views.calendar.more(list.length)}
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {more && (
        <DayPopover
          anchor={more.anchor}
          day={more.day}
          segs={more.segs}
          onClose={() => setMore(null)}
          onNew={() => {
            const iso = isoDate(more.day);
            openRange(iso, iso, more.anchor);
          }}
        />
      )}
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
