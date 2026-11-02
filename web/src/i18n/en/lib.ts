// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Englisch): lib

import { plural } from '..';
import type { lib as de } from '../de/lib';

export const lib: typeof de = {
  keys: {
    ctrl: 'Ctrl',
  },

  api: {
    error: (status) => `Error ${status}`,
  },

  store: {
    parentMissing: 'Parent node is missing',
    idTaken: 'ID already in use',
    nodeMissing: 'Node is missing',
    notSaved: (msg) => `Change not saved: ${msg}`,
    reloadFailed: (msg) => `Reload failed: ${msg}`,
    syncFailed: (msg) => `Sync: ${msg}`,
  },

  outline: {
    nowPage: (title) => `“${title}” is now a page of its own`,
    confirmDeletePage: (title) => `Delete page “${title}” and its subpages? It stays in the history (Git).`,
    pageDeleted: (title) => `“${title}” deleted`,
    repeatDone: 'Recurring todo: moved to the next date',
    movedPages: (n) => plural(n, { one: 'Page', other: '# pages' }),
    movedEntries: (n) => plural(n, { one: 'Entry', other: '# entries' }),
    toTop: 'to the top level',
    toTarget: (title) => `to “${title}”`,
    moved: (what, where) => `${what} moved ${where}`,
  },

  drag: {
    pages: (n) => plural(n, { one: '# page', other: '# pages' }),
    entries: (n) => plural(n, { one: '# entry', other: '# entries' }),
  },

  images: {
    pastedName: (stamp) => `Image ${stamp}`,
    inInbox: (n) => plural(n, { one: 'Image added to the inbox', other: '# images added to the inbox' }),
    onlyImages: 'Only images can be inserted',
  },

  markdown: {
    image: 'Image',
    openImage: (name) => `Open ${name}`,
    resize: 'Drag: width · Double-click: automatic',
    copyCode: 'Copy code',
  },
};
