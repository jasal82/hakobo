// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Englisch): häufige Wörter, die überall vorkommen.

import type { common as de } from '../de/common';

export const common: typeof de = {
  close: 'Close',
  cancel: 'Cancel',
  save: 'Save',
  delete: 'Delete',
  remove: 'Remove',
  open: 'Open',
  undo: 'Undo',
  copy: 'Copy',
  cut: 'Cut',
  paste: 'Paste',
  search: 'Search',
  retry: 'Try again',
  untitled: 'Untitled',
  noTitle: 'Untitled',
  entry: 'Entry',
  page: 'Page',
  inbox: 'Inbox',
  agenda: 'Agenda',
  todos: 'Todos',
  calendar: 'Calendar',
  week: 'Week',
  month: 'Month',
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  done: 'Done',
  hakobo: 'Hakobo',
  none: '–',
  quote: (s: string) => `“${s}”`,
};
