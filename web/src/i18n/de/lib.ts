// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): lib – Meldungen aus Zustand, Gliederung, Bildern, Ziehen, Markdown.

import { plural } from '..';

export const lib = {
  keys: {
    /** Strg-Taste in Tastenkürzeln (macOS: ⌘). */
    ctrl: 'Strg',
  },

  api: {
    /** Fehler ohne Text vom Server. */
    error: (status: number) => `Fehler ${status}`,
  },

  store: {
    parentMissing: 'Übergeordneter Knoten fehlt',
    idTaken: 'ID schon vergeben',
    nodeMissing: 'Knoten fehlt',
    notSaved: (msg: string) => `Änderung nicht gespeichert: ${msg}`,
    reloadFailed: (msg: string) => `Neu laden fehlgeschlagen: ${msg}`,
    syncFailed: (msg: string) => `Synchronisation: ${msg}`,
  },

  outline: {
    nowPage: (title: string) => `„${title}“ ist jetzt eine eigene Seite`,
    confirmDeletePage: (title: string) => `Seite „${title}“ samt Unterseiten löschen? Sie bleibt im Verlauf (Git) erhalten.`,
    pageDeleted: (title: string) => `„${title}“ gelöscht`,
    repeatDone: 'Wiederkehrendes Todo: auf den nächsten Termin verschoben',
    /** Einsortiert: `moved(what, where)`, z. B. „3 Einträge nach „Projekte“ verschoben“. */
    movedPages: (n: number) => plural(n, { one: 'Seite', other: '# Seiten' }),
    movedEntries: (n: number) => plural(n, { one: 'Eintrag', other: '# Einträge' }),
    toTop: 'in die oberste Ebene',
    toTarget: (title: string) => `nach „${title}“`,
    moved: (what: string, where: string) => `${what} ${where} verschoben`,
  },

  drag: {
    pages: (n: number) => plural(n, { one: '# Seite', other: '# Seiten' }),
    entries: (n: number) => plural(n, { one: '# Eintrag', other: '# Einträge' }),
  },

  images: {
    /** Name eines Bilds ohne eigenen Namen (Bildschirmfoto aus der Zwischenablage). */
    pastedName: (stamp: string) => `Bild ${stamp}`,
    inInbox: (n: number) => plural(n, { one: 'Bild in der Inbox', other: '# Bilder in der Inbox' }),
    onlyImages: 'Nur Bilder lassen sich einfügen',
  },

  markdown: {
    image: 'Bild',
    openImage: (name: string) => `${name} öffnen`,
    resize: 'Ziehen: Breite · Doppelklick: automatisch',
    copyCode: 'Code kopieren',
  },
};
