// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Englisch): shortcuts

import type { shortcuts as de } from '../de/shortcuts';

export const shortcuts: typeof de = {
  title: 'Keyboard shortcuts',
  list: 'List of keyboard shortcuts',
  groups: [
    {
      title: 'Everywhere',
      keys: [
        ['Ctrl+K', 'Search'],
        ['Ctrl+N', 'Quick capture'],
        ['Ctrl+1 … Ctrl+5', 'Inbox, Agenda, Todos, Calendar, Notebook'],
        ['F6 / Shift+F6', 'Move between title bar, sidebar and content'],
        ['Alt+← / Alt+→', 'Back / forward (outside the editor)'],
        ['Ctrl+\\', 'Show or hide the sidebar'],
        ['Ctrl+,', 'Settings'],
        ['Ctrl++ / Ctrl+- / Ctrl+0', 'Text larger / smaller / reset'],
        ['Esc', 'Close dialog, menu or editing'],
        ['F1', 'This overview'],
      ],
    },
    {
      title: 'Outline',
      keys: [
        ['↑ / ↓', 'Previous / next entry (also: back into the outline)'],
        ['Enter', 'New entry / split line'],
        ['Tab / Shift+Tab', 'Indent / outdent'],
        ['Ctrl+Enter', 'Complete todo (or turn into a todo)'],
        ['Ctrl+Shift+Enter', 'Todo on / off'],
        ['Shift+Enter', 'Edit note (Esc or Shift+Enter to go back)'],
        ['Alt+→ / Alt+Enter / Ctrl+.', 'Zoom in'],
        ['Alt+←', 'Zoom out'],
        ['Ctrl+↑ / Ctrl+↓', 'Collapse / expand'],
        ['Alt+Shift+↑ / Alt+Shift+↓', 'Move entry'],
        ['Shift+↑ / Shift+↓', 'At the line edge: select entries'],
        ['Ctrl+M', 'Move'],
        ['Ctrl+O', 'Open link, tag or web address at the cursor'],
        ['Ctrl+L', 'Copy link to the entry'],
        ['Ctrl+B / Ctrl+I', 'Bold / italic'],
        ['Ctrl+Shift+Del', 'Delete entry'],
        ['Shift+F10 / Menu key', 'Entry action menu'],
        ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
        ['/', 'Commands: event, due, repeat, reminder …'],
        ['@ / # / [[', 'Mention a person, tag, link'],
      ],
    },
    {
      title: 'Selected entries',
      keys: [
        ['Shift+↑ / Shift+↓', 'Extend selection'],
        ['Tab / Shift+Tab', 'Indent / outdent'],
        ['Ctrl+Enter', 'Complete'],
        ['Ctrl+M', 'Move'],
        ['Ctrl+C / Ctrl+X', 'Copy / cut (as Markdown)'],
        ['Del', 'Delete'],
        ['Enter / Esc', 'Edit / clear selection'],
      ],
    },
    {
      title: 'Lists, menus and tables',
      keys: [
        ['↑ / ↓ / Home / End', 'Move through sidebar, lists and menus'],
        ['→ / ←', 'Sidebar: expand and collapse subpages and tags'],
        ['Enter / Space', 'Open or activate'],
        ['Arrow keys', 'Type table: select cell'],
        ['Enter / F2', 'Type table: edit cell or open entry'],
      ],
    },
    {
      title: 'Tables',
      keys: [
        ['/table', 'Show entry as a table (again: as a list)'],
        ['Tab / Shift+Tab', 'Next / previous cell (after the last one: new row)'],
        ['Enter', 'New row below'],
        ['Arrow keys', 'At the text edge: neighboring cell'],
        ['Alt+Shift+↑ / Alt+Shift+↓', 'Move row'],
        ['Ctrl+Shift+Del', 'Delete row'],
        ['Shift+F10', 'Menu: insert, duplicate, move, sort, delete rows and columns; copy as Markdown, TSV or HTML'],
        ['Ctrl+V', 'Paste from Excel, TSV or a Markdown table'],
        ['Ctrl+Enter', 'Complete cell as a todo (or turn into a todo)'],
      ],
    },
    {
      title: 'Selected cells',
      keys: [
        ['Shift+Arrow keys', 'At the text edge: select cells, then change the selection (mouse: drag, Shift+click, handles)'],
        ['Ctrl+A (twice)', 'Select the whole table'],
        ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy, cut, paste (one value fills all cells)'],
        ['Del', 'Clear contents'],
        ['Ctrl+Shift+Del', 'Delete rows (whole columns selected: columns)'],
        ['Alt+Shift+↑ / Alt+Shift+↓', 'Move rows'],
        ['Ctrl+Enter', 'Complete'],
        ['Enter / Esc', 'Clear selection and keep typing in the cell'],
      ],
    },
    {
      title: 'Images',
      keys: [
        ['Ctrl+V', 'Attach image from the clipboard to the entry (in the note: at the cursor)'],
        ['/image', 'Insert image from a file (also in the action menu: Shift+F10)'],
        ['Enter / Space', 'Show selected image large (Tab jumps to the images of a note)'],
      ],
    },
    {
      title: 'Calendar',
      keys: [
        ['Arrow keys', 'Month: select day · Week: day headers (← →) and events (↑ ↓)'],
        ['Shift+Arrow keys', 'Select several days'],
        ['Enter', 'New event on the selected day or range'],
        ['PgUp / PgDn', 'Previous / next month or week'],
        ['Esc', 'Clear selection'],
      ],
    },
  ],
};
