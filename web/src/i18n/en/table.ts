// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Englisch): table

import type { table as de } from '../de/table';
import { plural } from '..';

export const table: typeof de = {
  backToList: 'Back to a list',
  rowsDeleted: (n) => plural(n, { one: '# row deleted', other: '# rows deleted' }),
  columnsDeleted: (n) => plural(n, { one: 'Column deleted', other: '# columns deleted' }),
  tableCopied: (format) => `Table copied as ${format}`,
  copyFailed: 'Couldn’t copy',
  cellsCopied: (n) => plural(n, { one: '# cell copied', other: '# cells copied' }),
  cellsCut: (n) => plural(n, { one: '# cell cut', other: '# cells cut' }),
  onlyImages: 'Only images can be dropped here',

  columnsGhost: (n) => plural(n, { one: '# column', other: '# columns' }),
  rowsGhost: (n) => plural(n, { one: '# row', other: '# rows' }),

  menu: {
    selection: (rows, cols) => `Selection · ${rows} × ${cols}`,
    clearContent: 'Clear contents',
    complete: 'Complete',
    rows: (n) => plural(n, { one: 'Row', other: '# rows' }),
    insertRowAbove: 'Insert row above',
    insertRowBelow: 'Insert row below',
    duplicateRows: (n) => plural(n, { one: 'Duplicate row', other: 'Duplicate rows' }),
    rowsUp: (n) => plural(n, { one: 'Move row up', other: 'Move rows up' }),
    rowsDown: (n) => plural(n, { one: 'Move row down', other: 'Move rows down' }),
    deleteRows: (n) => plural(n, { one: 'Delete row', other: 'Delete # rows' }),
    deleteHeader: 'Delete header row',
    cols: (n) => plural(n, { one: 'Column', other: '# columns' }),
    insertColLeft: 'Insert column left',
    insertColRight: 'Insert column right',
    duplicateCol: 'Duplicate column',
    colsLeft: (n) => plural(n, { one: 'Move column left', other: 'Move columns left' }),
    colsRight: (n) => plural(n, { one: 'Move column right', other: 'Move columns right' }),
    sortAsc: 'Sort ascending',
    sortDesc: 'Sort descending',
    autoWidth: 'Automatic width',
    deleteCols: (n) => plural(n, { one: 'Delete column', other: 'Delete # columns' }),
    table: 'Table',
    openCell: 'Open cell',
    copyAs: (format) => `Copy as ${format}`,
    showAsList: 'Show as list',
  },

  keys: {
    copy: 'Ctrl+C',
    cut: 'Ctrl+X',
    clear: 'Del',
    complete: 'Ctrl+Enter',
    enter: 'Enter',
    rowUp: 'Alt+⇧+↑',
    rowDown: 'Alt+⇧+↓',
    deleteRows: 'Ctrl+⇧+⌫',
    openCell: 'Alt+→',
  },

  gripCol: 'Drag: move column · Click: select column',
  gripCell: 'Drag: swap with another cell',
  columnName: 'Column name',
  nested: (n) => plural(n, { one: '# entry inside – open (Alt+→)', other: '# entries inside – open (Alt+→)' }),
  cellMenu: 'Row and column',
  cellMenuTitle: 'Row and column (Shift+F10)',
  resize: 'Drag: column width · Double-click: automatic',
  selectHeader: 'Click: select header row',
  gripRow: 'Drag: move row · Click: select row',
  addColumn: 'Add column',
  selectedCells: 'Selected cells',
  addRow: 'Row',
};
