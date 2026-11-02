// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): table

import { plural } from '..';

export const table = {
  // Meldungen (lib/table.ts)
  backToList: 'Wieder als Liste',
  rowsDeleted: (n: number) => plural(n, { one: '# Zeile gelöscht', other: '# Zeilen gelöscht' }),
  columnsDeleted: (n: number) => plural(n, { one: 'Spalte gelöscht', other: '# Spalten gelöscht' }),
  /** `format`: Markdown, TSV oder HTML. */
  tableCopied: (format: string) => `Tabelle als ${format} kopiert`,
  copyFailed: 'Kopieren nicht möglich',
  cellsCopied: (n: number) => plural(n, { one: '# Zelle kopiert', other: '# Zellen kopiert' }),
  cellsCut: (n: number) => plural(n, { one: '# Zelle ausgeschnitten', other: '# Zellen ausgeschnitten' }),
  onlyImages: 'Nur Bilder lassen sich hier ablegen',

  // Ziehen
  columnsGhost: (n: number) => plural(n, { one: '# Spalte', other: '# Spalten' }),
  rowsGhost: (n: number) => plural(n, { one: '# Zeile', other: '# Zeilen' }),

  // Menü einer Zelle
  menu: {
    selection: (rows: number, cols: number) => `Auswahl · ${rows} × ${cols}`,
    clearContent: 'Inhalt löschen',
    complete: 'Erledigen',
    rows: (n: number) => plural(n, { one: 'Zeile', other: '# Zeilen' }),
    insertRowAbove: 'Zeile darüber einfügen',
    insertRowBelow: 'Zeile darunter einfügen',
    duplicateRows: (n: number) => plural(n, { one: 'Zeile duplizieren', other: 'Zeilen duplizieren' }),
    rowsUp: (n: number) => plural(n, { one: 'Zeile nach oben', other: 'Zeilen nach oben' }),
    rowsDown: (n: number) => plural(n, { one: 'Zeile nach unten', other: 'Zeilen nach unten' }),
    deleteRows: (n: number) => plural(n, { one: 'Zeile löschen', other: '# Zeilen löschen' }),
    deleteHeader: 'Kopfzeile löschen',
    cols: (n: number) => plural(n, { one: 'Spalte', other: '# Spalten' }),
    insertColLeft: 'Spalte links einfügen',
    insertColRight: 'Spalte rechts einfügen',
    duplicateCol: 'Spalte duplizieren',
    colsLeft: (n: number) => plural(n, { one: 'Spalte nach links', other: 'Spalten nach links' }),
    colsRight: (n: number) => plural(n, { one: 'Spalte nach rechts', other: 'Spalten nach rechts' }),
    sortAsc: 'Aufsteigend sortieren',
    sortDesc: 'Absteigend sortieren',
    autoWidth: 'Breite automatisch',
    deleteCols: (n: number) => plural(n, { one: 'Spalte löschen', other: '# Spalten löschen' }),
    table: 'Tabelle',
    openCell: 'Zelle öffnen',
    /** `format`: Markdown, TSV oder HTML. */
    copyAs: (format: string) => `Als ${format} kopieren`,
    showAsList: 'Als Liste anzeigen',
  },

  // Tastenkürzel neben den Menüeinträgen
  keys: {
    copy: 'Strg+C',
    cut: 'Strg+X',
    clear: 'Entf',
    complete: 'Strg+Enter',
    enter: 'Enter',
    rowUp: 'Alt+⇧+↑',
    rowDown: 'Alt+⇧+↓',
    deleteRows: 'Strg+⇧+⌫',
    openCell: 'Alt+→',
  },

  // Zellen, Zeilen, Tabelle
  gripCol: 'Ziehen: Spalte verschieben · Klick: Spalte auswählen',
  gripCell: 'Ziehen: Zelle mit einer anderen tauschen',
  columnName: 'Spaltenname',
  nested: (n: number) => plural(n, { one: '# Eintrag darunter – öffnen (Alt+→)', other: '# Einträge darunter – öffnen (Alt+→)' }),
  cellMenu: 'Zeile und Spalte',
  cellMenuTitle: 'Zeile und Spalte (Umschalt+F10)',
  resize: 'Ziehen: Spaltenbreite · Doppelklick: automatisch',
  selectHeader: 'Klick: Kopfzeile auswählen',
  gripRow: 'Ziehen: Zeile verschieben · Klick: Zeile auswählen',
  addColumn: 'Spalte anfügen',
  selectedCells: 'Ausgewählte Zellen',
  addRow: 'Zeile',
};
