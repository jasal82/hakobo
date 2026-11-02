// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Englisch): editor

import type { editor as de } from '../de/editor';

export const editor: typeof de = {
  noLinkHere: 'There’s no link to open here',
  linkCopied: 'Link copied – paste it into an entry with Ctrl+V',
  onlyImages: 'Only images can be dropped here',
  notePlaceholder: 'Note … (Markdown, ```code```, [[link]], #tag)',
  codePlaceholder: 'Code …',
  code: 'Code',
  copied: (what) => `${what} copied`,
  copyFailed: 'Couldn’t copy',
  chooseLanguage: 'Choose language',
  language: 'Language',
  copyCode: 'Copy code',
  searchLanguage: 'Search languages …',
  noLanguage: 'No language',
  linkOpens: 'Ctrl+click or Ctrl+O opens the target',
  linkMissing: 'Target doesn’t exist (yet)',
  targetMissing: (target) => `“${target}” doesn’t exist (yet)`,
};
