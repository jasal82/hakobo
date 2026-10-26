// Anzeige von Datumswerten (kanonisches Format aus src/dates.rs).

export interface WhenParts {
  start: Date;
  startTime: string | null;
  endDate: Date | null;
  endTime: string | null;
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Liest `2026-10-27`, `2026-10-27 14:00`, `2026-10-27 14:00-15:30`, `… - 2026-10-29` usw. */
export function parseWhen(value: string | undefined | null): WhenParts | null {
  if (!value) return null;
  const v = value.trim();
  let m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?(?:\s*[-–]\s*(?:(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?|(\d{1,2}:\d{2})))?$/.exec(v);
  if (!m) {
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{1,2}:\d{2}))?$/.exec(v);
    if (!m) return null;
    return { start: new Date(+m[3], +m[2] - 1, +m[1]), startTime: m[4] ?? null, endDate: null, endTime: null };
  }
  const start = parseIsoDate(m[1]);
  if (!start) return null;
  return {
    start,
    startTime: m[2] ? m[2].padStart(5, '0') : null,
    endDate: m[3] ? parseIsoDate(m[3]) : null,
    endTime: (m[4] ?? m[5]) ? (m[4] ?? m[5])!.padStart(5, '0') : null,
  };
}

/** „Heute“, „Morgen“, „Fr 30.10.“, „So 3.1.2027“ */
export function dayLabel(d: Date, today = startOfDay(), long = false): string {
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  const wd = long ? WD_LONG[d.getDay()] : WD[d.getDay()];
  const year = d.getFullYear() !== today.getFullYear() ? String(d.getFullYear()) : '';
  return `${wd}${long ? ',' : ''} ${d.getDate()}.${d.getMonth() + 1}.${year}`;
}

export function longDayLabel(d: Date, today = startOfDay()): string {
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  const base = `${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  if (diff === 0) return `Heute · ${base}`;
  if (diff === 1) return `Morgen · ${base}`;
  if (diff === -1) return `Gestern · ${base}`;
  return d.getFullYear() !== today.getFullYear() ? `${base} ${d.getFullYear()}` : base;
}

export function humanWhen(value: string | undefined | null, today = startOfDay()): string {
  const w = parseWhen(value);
  if (!w) return value ?? '';
  let s = dayLabel(w.start, today);
  if (w.startTime) s += ` ${w.startTime}`;
  if (w.endDate && !sameDay(w.endDate, w.start)) {
    s += ` – ${dayLabel(w.endDate, today)}`;
    if (w.endTime) s += ` ${w.endTime}`;
  } else if (w.endTime) {
    s += `–${w.endTime}`;
  }
  return s;
}

/** Relative Lage eines Datums: überfällig, heute, bald, später. */
export function urgency(value: string | undefined | null, today = startOfDay()): 'overdue' | 'today' | 'soon' | 'later' | null {
  const w = parseWhen(value);
  if (!w) return null;
  const last = w.endDate ?? w.start;
  const diff = Math.round((startOfDay(last).getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'overdue';
  if (Math.round((w.start.getTime() - today.getTime()) / 86400000) <= 0) return 'today';
  if (diff <= 3) return 'soon';
  return 'later';
}

export function humanRepeat(v: string): string {
  const map: Record<string, string> = { daily: 'täglich', weekdays: 'werktags', weekly: 'wöchentlich', monthly: 'monatlich', yearly: 'jährlich' };
  const days: Record<string, string> = { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' };
  let s = v.trim();
  let until = '';
  const u = / until (\d{4}-\d{2}-\d{2})$/.exec(s);
  if (u) {
    const d = parseIsoDate(u[1]);
    until = d ? ` bis ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}` : '';
    s = s.slice(0, u.index);
  }
  let on = '';
  const o = / on ([a-z,]+)$/.exec(s);
  if (o) {
    on = ` (${o[1].split(',').map((x) => days[x] ?? x).join(', ')})`;
    s = s.slice(0, o.index);
  }
  let base = map[s];
  if (!base) {
    const e = /^every (\d+) (day|week|month|year)s?$/.exec(s);
    const unit: Record<string, string> = { day: 'Tage', week: 'Wochen', month: 'Monate', year: 'Jahre' };
    base = e ? `alle ${e[1]} ${unit[e[2]]}` : s;
  }
  return base + on + until;
}

export function humanRemind(v: string): string {
  return v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      if (x === '0') return 'zu Beginn';
      const w = parseWhen(x);
      if (w) return humanWhen(x);
      const m = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(x);
      if (!m) return x;
      const parts: string[] = [];
      if (m[1]) parts.push(`${m[1]} ${m[1] === '1' ? 'Tag' : 'Tage'}`);
      if (m[2]) parts.push(`${m[2]} Std.`);
      if (m[3]) parts.push(`${m[3]} Min.`);
      return parts.join(' ') + ' vorher';
    })
    .join(', ');
}

export function relativeTime(unix: number | null | undefined): string {
  if (!unix) return 'nie';
  const s = Math.round(Date.now() / 1000 - unix);
  if (s < 45) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  const d = new Date(unix * 1000);
  return `${dayLabel(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDateTime(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
