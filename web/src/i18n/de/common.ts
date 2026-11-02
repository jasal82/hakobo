// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): häufige Wörter, die überall vorkommen.

export const common = {
  close: 'Schließen',
  cancel: 'Abbrechen',
  save: 'Speichern',
  delete: 'Löschen',
  remove: 'Entfernen',
  open: 'Öffnen',
  undo: 'Rückgängig',
  copy: 'Kopieren',
  cut: 'Ausschneiden',
  paste: 'Einfügen',
  search: 'Suchen',
  retry: 'Erneut versuchen',
  /** Titel einer Seite ohne Namen (auch Vorgabe für neue Seiten). */
  untitled: 'Unbenannt',
  /** Platzhalter für einen Eintrag ohne Text. */
  noTitle: 'Ohne Titel',
  entry: 'Eintrag',
  page: 'Seite',
  inbox: 'Inbox',
  agenda: 'Agenda',
  todos: 'Todos',
  calendar: 'Kalender',
  week: 'Woche',
  month: 'Monat',
  today: 'Heute',
  tomorrow: 'Morgen',
  yesterday: 'Gestern',
  done: 'Erledigt',
  hakobo: 'Hakobo',
  /** Wert, der im Formular fehlt. */
  none: '–',
  /** Anführungszeichen um einen Namen: „Name“. */
  quote: (s: string) => `„${s}“`,
};
