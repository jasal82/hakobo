// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Englisch): Datumsangaben, Wiederholungen, Erinnerungen, relative Zeiten.
// Format wie US-Englisch (locale()), passend zu den Texten aus dem Backend.

import type { dates as de } from '../de/dates';
import { locale } from '..';

const p = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(locale(), o);

export const dates: typeof de = {
  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekdaysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  // „Fri, Oct 30“, „Sun, Jan 3, 2027“
  day: (d, withYear, long) => fmt(d, { weekday: long ? 'long' : 'short', month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined }),
  // „Friday, October 30“
  dayLong: (d, withYear) => fmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: withYear ? 'numeric' : undefined }),
  relDay: (rel, day) => `${rel} · ${day}`,
  date: (d) => fmt(d, { year: 'numeric', month: 'short', day: 'numeric' }),
  dateTime: (d) => `${fmt(d, { year: 'numeric', month: 'short', day: 'numeric' })} ${p(d.getHours())}:${p(d.getMinutes())}`,
  repeat: { daily: 'daily', weekdays: 'on weekdays', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly' },
  repeatDays: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
  repeatEvery: (n, unit) => `every ${n} ${unit}s`,
  repeatUntil: (date) => ` until ${date}`,
  remindAtStart: 'at start',
  remindDays: (n) => `${n} ${n === '1' ? 'day' : 'days'}`,
  remindHours: (n) => `${n} h`,
  remindMinutes: (n) => `${n} min`,
  remindBefore: (s) => `${s} before`,
  never: 'never',
  justNow: 'just now',
  minutesAgo: (n) => `${n} min ago`,
  hoursAgo: (n) => `${n} h ago`,
};
