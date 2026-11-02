// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Englisch): app

import type { app as de } from '../de/app';

export const app: typeof de = {
  loadFailed: 'Hakobo couldn’t load the notebook',
  onlyImagesDrop: 'Only images can be dropped here',

  titleBar: {
    sidebar: 'Sidebar (Ctrl+\\)',
    back: 'Back (Alt+←)',
    forward: 'Forward',
    search: 'Search…',
    searchKey: 'Ctrl K',
    captureTitle: 'Quick capture (Ctrl+N)',
    capture: 'Capture',
    minimize: 'Minimize',
    restore: 'Restore',
    maximize: 'Maximize',
  },

  sidebar: {
    label: 'Sidebar',
    searchKey: 'Ctrl K',
    inboxTitle: 'Inbox (Ctrl+1)',
    agendaTitle: 'Agenda (Ctrl+2)',
    todosTitle: 'Todos (Ctrl+3)',
    calendarTitle: 'Calendar: week or month (Ctrl+4)',
    notebook: 'Notebook',
    notebookTitle: 'Notebook (Ctrl+5)',
    pages: 'Pages',
    newPage: 'New page',
    newSubpage: 'Add subpage',
    types: 'Types',
    tags: 'Tags',
    settings: 'Settings (Ctrl+,)',
    updateAvailable: (version) => `Settings · Hakobo ${version} is available`,
    syncing: 'Syncing…',
    syncError: 'Sync error',
    synced: (when) => `Synced ${when}`,
    localVersion: (when) => `Local · version ${when}`,
    localOnly: 'Versioned locally only (Git). Set up a remote in the settings.',
    pending: 'Changes not yet saved as a version',
  },
};
