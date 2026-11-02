// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): app – Rahmen der App (Start, Meldungen, Titelleiste, Seitenleiste).

export const app = {
  /** Start ist gescheitert. */
  loadFailed: 'Hakobo konnte das Notizbuch nicht laden',
  /** Von außen abgelegte Dateien, die keine Bilder sind. */
  onlyImagesDrop: 'Nur Bilder lassen sich ablegen',

  titleBar: {
    sidebar: 'Seitenleiste (Strg+\\)',
    back: 'Zurück (Alt+←)',
    forward: 'Vor',
    search: 'Suchen …',
    searchKey: 'Strg K',
    captureTitle: 'Schnell erfassen (Strg+N)',
    capture: 'Erfassen',
    minimize: 'Minimieren',
    restore: 'Wiederherstellen',
    maximize: 'Maximieren',
  },

  sidebar: {
    label: 'Seitenleiste',
    searchKey: 'Strg K',
    inboxTitle: 'Inbox (Strg+1)',
    agendaTitle: 'Agenda (Strg+2)',
    todosTitle: 'Todos (Strg+3)',
    calendarTitle: 'Kalender: Woche oder Monat (Strg+4)',
    notebook: 'Notizbuch',
    notebookTitle: 'Notizbuch (Strg+5)',
    pages: 'Seiten',
    newPage: 'Neue Seite',
    newSubpage: 'Unterseite anlegen',
    types: 'Typen',
    tags: 'Tags',
    settings: 'Einstellungen (Strg+,)',
    updateAvailable: (version: string) => `Einstellungen · Hakobo ${version} ist verfügbar`,
    syncing: 'Synchronisiere …',
    syncError: 'Sync-Fehler',
    synced: (when: string) => `Synchronisiert ${when}`,
    localVersion: (when: string) => `Lokal · Version ${when}`,
    localOnly: 'Nur lokal versioniert (Git). Remote in den Einstellungen einrichten.',
    pending: 'Änderungen, die noch nicht als Version festgehalten sind',
  },
};
