// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Sprachen der Oberfläche (Deutsch als Ausgangssprache, Englisch).
//
// Die Texte stehen je Sprache in `de/*.ts` bzw. `en/*.ts`, gegliedert nach
// Bereichen. Platzhalter sind Funktionsparameter, Mehrzahl geht über
// `plural()`. Die englischen Dateien sind gegen die deutschen typisiert:
// fehlt ein Text oder passt ein Parameter nicht, meldet das TypeScript.
//
// `L` ist eine Live-Bindung auf die Texte der aktuellen Sprache. Sie darf nur
// innerhalb von Funktionen (beim Rendern, beim Auslösen einer Meldung) gelesen
// werden, nie beim Laden eines Moduls – sonst bliebe der Text beim Umschalten
// stehen. Beim Umschalten baut die App ihren Inhalt neu auf (siehe App.tsx).

import { useSyncExternalStore } from 'react';
import { de } from './de';
import { en } from './en';

export type Lang = 'de' | 'en';
/** Einstellung: `system` folgt der Sprache des Systems (Deutsch, sonst Englisch). */
export type LangSetting = 'system' | Lang;
export type Messages = typeof de;

export const LANGS: Lang[] = ['de', 'en'];
const DICTS: Record<Lang, Messages> = { de, en };
const KEY = 'hakobo-lang';

/** Texte der aktuellen Sprache (nur in Funktionen lesen, siehe oben). */
export let L: Messages = de;
let current: Lang = 'de';
const listeners = new Set<() => void>();

/** Sprache des Systems bzw. Browsers: Deutsch, wenn sie vorne steht, sonst Englisch. */
export function systemLang(): Lang {
  const list = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  return list[0]?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function resolveLang(s: string | null | undefined): Lang {
  return s === 'de' || s === 'en' ? s : systemLang();
}

/** Gespeicherte Einstellung dieses Rechners (Zwischenspeicher für den schnellen Start). */
export function storedLangSetting(): LangSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'de' || v === 'en' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function lang(): Lang {
  return current;
}

function apply(l: Lang) {
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  if (l === current) return;
  current = l;
  L = DICTS[l];
  collator = null;
  listeners.forEach((f) => f());
}

/** Einstellung übernehmen (`system`, `de`, `en`) und für den nächsten Start merken. */
export function setLangSetting(s: string | null | undefined) {
  const v: LangSetting = s === 'de' || s === 'en' ? s : 'system';
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* Speicher gesperrt */
  }
  apply(resolveLang(v));
}

/** Aktuelle Sprache als React-Hook (für den Neuaufbau beim Umschalten). */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

// Beim Laden des Moduls: zuletzt gespeicherte Wahl, bis die Einstellungen da sind.
apply(resolveLang(storedLangSetting()));

// ---------------------------------------------------------------------------
// Formate
// ---------------------------------------------------------------------------

/** Gebietsschema für `Intl`. Englisch einheitlich als US-Englisch, damit Daten aus dem
 *  Backend (src/dates.rs: „Fri, Oct 30“) und aus der Oberfläche gleich aussehen. */
export function locale(): string {
  return current === 'de' ? 'de-DE' : 'en-US';
}

/** Zahl im Format der Sprache (`1.234,5` bzw. `1,234.5`). */
export function fmtNum(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(locale(), opts);
}

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {};

/** Mehrzahl: `plural(3, { one: '# Zeile', other: '# Zeilen' })` → „3 Zeilen“ (`#` = formatierte Zahl). */
export function plural(n: number, forms: { one: string; other: string; zero?: string }): string {
  const rules = (pluralRules[current] ??= new Intl.PluralRules(current));
  const form = n === 0 && forms.zero !== undefined ? forms.zero : rules.select(n) === 'one' ? forms.one : forms.other;
  return form.replace(/#/g, fmtNum(n));
}

let collator: Intl.Collator | null = null;

/** Natürliche Sortierung nach den Regeln der Sprache (Zahlen numerisch, ohne Groß/klein). */
export function compareText(a: string, b: string): number {
  collator ??= new Intl.Collator(current, { numeric: true, sensitivity: 'base' });
  return collator.compare(a, b);
}

/** Aufzählung: „A, B und C“ bzw. „A, B, and C“. */
export function listJoin(items: string[]): string {
  return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(items);
}
