// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Englisch): capture – Schnellerfassung (Dialog und Hotkey-Fenster).

import type { capture as de } from '../de/capture';

export const capture: typeof de = {
  title: 'Quick capture',
  drag: 'Move',
  todo: 'Todo',
  placeholder: 'Idea, todo or appointment … /tomorrow 2 pm #tag @person',
  help: '/ for date, repeat, reminder · # tag · @ person · [[ link',
  chooseTarget: 'Choose target (Tab)',
  target: 'Target:',
  backToInbox: 'Back to Inbox',
  keySave: 'save',
  keyCtrl: 'Ctrl',
  keyOpen: 'open',
  keyLine: 'new line',
  placeInbox: (inbox) => `In ${inbox}`,
  placeUnder: (target) => `Under “${target}”`,
  searchTarget: 'Search page or entry …',
  nothing: 'Nothing found',
};
