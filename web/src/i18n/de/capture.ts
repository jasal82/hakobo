// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): capture – Schnellerfassung (Dialog und Hotkey-Fenster).

export const capture = {
  title: 'Schnell erfassen',
  /** Tooltip des Griffs im Hotkey-Fenster. */
  drag: 'Verschieben',
  todo: 'Todo',
  placeholder: 'Idee, Todo oder Termin … /morgen 14 uhr #tag @person',
  help: '/ für Datum, Wiederholung, Erinnerung · # Tag · @ Person · [[ Link',
  chooseTarget: 'Ziel wählen (Tab)',
  target: 'Ziel:',
  backToInbox: 'Zurück zur Inbox',
  keySave: 'speichern',
  keyCtrl: 'Strg',
  keyOpen: 'öffnen',
  keyLine: 'Zeile',
  /** Ort des neuen Eintrags (Titel der Inbox bzw. des Ziels). */
  placeInbox: (inbox: string) => `In der ${inbox}`,
  placeUnder: (target: string) => `Unter „${target}“`,
  searchTarget: 'Seite oder Eintrag suchen …',
  nothing: 'Nichts gefunden',
};
