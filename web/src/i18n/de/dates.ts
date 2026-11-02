// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): Datumsangaben, Wiederholungen, Erinnerungen, relative Zeiten.

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const p = (n: number) => String(n).padStart(2, '0');

export const dates = {
  /** Kurze Wochentage, Sonntag zuerst (wie `Date.getDay()`). */
  weekdaysShort: WD,
  weekdaysLong: WD_LONG,
  months: MONTHS,
  /** „Fr 30.10.“, „So 3.1.2027“; lang: „Freitag, 30.10.“ */
  day: (d: Date, withYear: boolean, long: boolean) =>
    `${long ? WD_LONG[d.getDay()] : WD[d.getDay()]}${long ? ',' : ''} ${d.getDate()}.${d.getMonth() + 1}.${withYear ? d.getFullYear() : ''}`,
  /** „Freitag, 30. Oktober“ bzw. „… 2027“ */
  dayLong: (d: Date, withYear: boolean) => `${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`,
  /** „Heute · Freitag, 30. Oktober“ */
  relDay: (rel: string, day: string) => `${rel} · ${day}`,
  /** „30.10.2026“ */
  date: (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`,
  /** „30.10.2026 14:05“ */
  dateTime: (d: Date) => `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`,
  repeat: { daily: 'täglich', weekdays: 'werktags', weekly: 'wöchentlich', monthly: 'monatlich', yearly: 'jährlich' } as Record<string, string>,
  /** Kurze Wochentage für `on mon,fri`. */
  repeatDays: { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' } as Record<string, string>,
  repeatEvery: (n: string, unit: 'day' | 'week' | 'month' | 'year') => `alle ${n} ${{ day: 'Tage', week: 'Wochen', month: 'Monate', year: 'Jahre' }[unit]}`,
  repeatUntil: (date: string) => ` bis ${date}`,
  remindAtStart: 'zu Beginn',
  remindDays: (n: string) => `${n} ${n === '1' ? 'Tag' : 'Tage'}`,
  remindHours: (n: string) => `${n} Std.`,
  remindMinutes: (n: string) => `${n} Min.`,
  remindBefore: (s: string) => `${s} vorher`,
  never: 'nie',
  justNow: 'gerade eben',
  minutesAgo: (n: number) => `vor ${n} Min.`,
  hoursAgo: (n: number) => `vor ${n} Std.`,
};
