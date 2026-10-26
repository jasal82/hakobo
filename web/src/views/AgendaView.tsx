// Agenda (Liste der nächsten Tage) und Wochenansicht (Zeitraster).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, CircleAlert, Plus, Repeat } from 'lucide-react';
import { api, type CapturePreview } from '../lib/api';
import { addDays, dayLabel, isoDate, longDayLabel, parseIsoDate, startOfDay } from '../lib/dates';
import { store, useStore } from '../lib/store';
import type { Agenda, AgendaEntry, Node } from '../lib/types';
import { RichText, openTag } from '../components/RichText';
import { TaskBox } from '../components/outline/fields';
import { Popover, type Anchor } from '../components/ui';
import { hhmm, hiddenTags, minutesOf, nodeColor, pathOf, useReloadOnChange } from './parts/common';

const isClosed = (e: AgendaEntry) => e.task === 'done' || e.task === 'cancelled';

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
    return `bis ${end ? dayLabel(end, today) : w.endDate}${w.endTime ? ` ${hhmm(w.endTime)}` : ''}`;
  }
  if (w.startTime) return w.endTime ? `${hhmm(w.startTime)}–${hhmm(w.endTime)}` : hhmm(w.startTime);
  return e.kind === 'event' ? 'ganztägig' : '';
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
      store().toast(`In der Inbox: ${r.node?.text ?? text}${r.summary.length ? ` · ${r.summary.join(' · ')}` : ''}`, 'success', {
        label: 'Öffnen',
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
          {preview.task && <span className="chip">Todo</span>}
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
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') store().reveal(e.id, { edit: true });
      }}
    >
      <span className="ag-time">{showDate ? e.human : timeLabel(e, today)}</span>
      <span className="ag-mark">
        {e.kind === 'todo' && node ? <TaskBox node={node} /> : <span className="ag-dot" style={color ? { background: color } : undefined} />}
      </span>
      <span className="ag-main">
        <span className="ag-text">{node ? <RichText text={node.text} source={node} /> : <RichText text={e.text} />}</span>
        <span className="ag-meta">
          {e.repeat && (
            <span className="ag-repeat" title="Wiederholung">
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
  const [days, setDays] = useState(() => readNum('sqizzo-agenda-days', 14));
  const [showDone, setShowDone] = useState(() => {
    try {
      return localStorage.getItem('sqizzo-agenda-done') === '1';
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
    <div className="view ag-view">
      <div className="view-inner">
        <div className="view-head">
          <h1>Agenda</h1>
          <div className="tabs" role="tablist">
            {[7, 14, 30].map((n) => (
              <button
                key={n}
                className={days === n ? 'is-active' : ''}
                onClick={() => {
                  setDays(n);
                  writeLocal('sqizzo-agenda-days', String(n));
                }}
              >
                {n} Tage
              </button>
            ))}
          </div>
          <label className="switch ag-done-toggle">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => {
                setShowDone(e.target.checked);
                writeLocal('sqizzo-agenda-done', e.target.checked ? '1' : '0');
              }}
            />
            Erledigte
          </label>
        </div>

        <QuickAdd onAdded={() => void load()} placeholder="Neuer Termin oder Todo … z. B. „Zahnarzt /morgen 14 uhr“ oder „[] Bericht /fällig fr“" />

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
              <CircleAlert size={15} /> Überfällig <span className="ag-count">{data.overdue.length}</span>
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
                {g.entries.length ? g.entries.map((e) => <EntryRow key={`${e.id}|${e.value}`} e={e} today={today} />) : <div className="ag-nothing">Nichts geplant</div>}
              </section>
            );
          })}

        {data && total === 0 && data.overdue.length === 0 && (
          <div className="empty ag-empty">
            <CalendarClock size={28} />
            <h3>Keine Termine und fälligen Todos</h3>
            <p>
              Termine entstehen, sobald ein Eintrag ein Datum bekommt – im Text mit <kbd>/morgen 14 uhr</kbd>, <kbd>/fällig fr</kbd> oder <kbd>/jeden montag</kbd>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Woche
// ---------------------------------------------------------------------------

const HOUR = 44;
const DAY_MIN = 24 * 60;

function mondayOf(d: Date): Date {
  const r = startOfDay(d);
  const wd = (r.getDay() + 6) % 7;
  return addDays(r, -wd);
}

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

function WeekEvent({ p, today }: { p: Placed; today: Date }) {
  const node = useStore((s) => s.nodes[p.e.id]) as Node | undefined;
  const types = useStore((s) => s.types);
  const color = nodeColor(node, types) ?? 'var(--accent)';
  const short = p.end - p.start <= 35;
  void today;
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
      title={`${hhmm(p.e.when.startTime)}${p.e.when.endTime ? `–${hhmm(p.e.when.endTime)}` : ''} ${node ? node.text : p.e.text}`}
      onClick={(ev) => {
        ev.stopPropagation();
        if ((ev.target as HTMLElement).closest('a, button')) return;
        store().reveal(p.e.id, { edit: true });
      }}
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
  const types = useStore((s) => s.types);
  const color = nodeColor(node, types);
  return (
    <div
      className={`wk-allday-item${isClosed(e) ? ' is-closed' : ''}${e.overdue ? ' is-overdue' : ''}${e.kind === 'todo' ? ' is-todo' : ''}`}
      style={color ? { ['--ev-color' as string]: color } : undefined}
      title={node?.text ?? e.text}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest('a, button')) return;
        store().reveal(e.id, { edit: true });
      }}
    >
      {e.kind === 'todo' && node && <TaskBox node={node} size={12} />}
      <span className="wk-allday-text">{node ? <RichText text={node.text} source={node} /> : <RichText text={e.text} />}</span>
    </div>
  );
}

export function WeekView({ start }: { start?: string }) {
  const today = startOfDay();
  const monday = useMemo(() => mondayOf((start && parseIsoDate(start)) || new Date()), [start]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const [data, setData] = useState<Agenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [create, setCreate] = useState<{ anchor: Anchor; date: Date; minutes: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.agenda(isoDate(days[0]), isoDate(days[6])));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);
  useReloadOnChange(() => void load());

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR - 6;
  }, [monday]);

  const fromIso = isoDate(days[0]);
  const toIso = isoDate(days[6]);
  const all = useMemo(() => {
    if (!data) return [];
    // Überfällige Todos dieser Woche erscheinen an ihrem Tag.
    const extra = data.overdue.filter((e) => e.when.start >= fromIso && e.when.start <= toIso);
    return [...data.entries, ...extra];
  }, [data, fromIso, toIso]);

  const isTimed = (e: AgendaEntry) => !!e.when.startTime && (!e.when.endDate || e.when.endDate === e.when.start);
  const allDay = all.filter((e) => !isTimed(e));
  const timed = all.filter(isTimed);

  // Ganztägige: Spalten (1–7) und Länge, auch über mehrere Tage
  const allDayPlaced = allDay
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

  const kw = useMemo(() => {
    // ISO-Kalenderwoche
    const d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3));
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  }, [monday]);

  const monthLabel = useMemo(() => {
    const f = (d: Date) => d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const a = f(days[0]);
    const b = f(days[6]);
    return a === b ? a : `${days[0].toLocaleDateString('de-DE', { month: 'long' })} – ${b}`;
  }, [days]);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const thisWeek = days.some((d) => isoDate(d) === isoDate(today));

  return (
    <div className="wk-view">
      <div className="wk-head">
        <h1>{monthLabel}</h1>
        <span className="wk-kw">KW {kw}</span>
        <span className="spacer" />
        <div className="wk-nav">
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => go(-7)} aria-label="Vorige Woche" title="Vorige Woche">
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-sm" onClick={() => go(null)} disabled={thisWeek}>
            Heute
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => go(7)} aria-label="Nächste Woche" title="Nächste Woche">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {error && (
        <div className="ag-error">
          <CircleAlert size={15} /> {error}
        </div>
      )}

      <div className="wk-grid-head">
        <div className="wk-gutter" />
        {days.map((d) => {
          const isToday = isoDate(d) === isoDate(today);
          return (
            <div key={isoDate(d)} className={`wk-col-head${isToday ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : ''}`}>
              <span className="wk-wd">{d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}</span>
              <span className="wk-date">{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="wk-allday">
        <div className="wk-gutter wk-allday-label">ganztägig</div>
        <div className="wk-allday-grid">
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
          {days.map((d) => {
            const iso = isoDate(d);
            const placed = layoutDay(timed.filter((e) => e.when.start === iso));
            const isToday = iso === isoDate(today);
            return (
              <div
                key={iso}
                className={`wk-col${isToday ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : ''}`}
                onDoubleClick={(ev) => {
                  const r = ev.currentTarget.getBoundingClientRect();
                  const y = ev.clientY - r.top;
                  const minutes = Math.max(0, Math.min(DAY_MIN - 30, Math.floor(((y / HOUR) * 60) / 30) * 30));
                  setCreate({ anchor: { left: ev.clientX, top: ev.clientY, bottom: ev.clientY + 4 }, date: d, minutes });
                }}
                title="Doppelklick: neuer Termin"
              >
                {placed.map((p) => (
                  <WeekEvent key={`${p.e.id}|${p.e.value}`} p={p} today={today} />
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
          date={create.date}
          minutes={create.minutes}
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

function NewEventPopover({ anchor, date, minutes, onClose, onCreated }: { anchor: Anchor; date: Date; minutes: number; onClose: () => void; onCreated: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      // Eigene Datumsangaben im Text haben Vorrang.
      const hasDate = /(^|\s)\/(termin|datum|date|fällig|faellig|due|heute|morgen)/i.test(text);
      const r = await api.capture(hasDate ? text : `${text} /termin ${isoDate(date)} ${time}`);
      store().toast(`Termin angelegt (Inbox): ${r.node?.text ?? text}`, 'success', { label: 'Öffnen', run: () => store().reveal(r.id) });
      onCreated();
    } catch (err) {
      store().toast((err as Error).message, 'error');
      setBusy(false);
    }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} className="field-pop">
      <form className="fp-body" onSubmit={submit}>
        <div className="fp-title" style={{ padding: 0 }}>
          Neuer Termin · {dayLabel(date)} {time}
        </div>
        <input className="input" autoFocus placeholder="Titel, z. B. Abstimmung mit @Anna" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        <div className="fp-hint">Landet in der Inbox. Dauer z. B. mit „/termin {time}-…“ selbst angeben.</div>
      </form>
    </Popover>
  );
}
