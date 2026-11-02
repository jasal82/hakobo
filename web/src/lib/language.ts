// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Sprache aus den Einstellungen dieses Rechners übernehmen (auch nach Änderungen in anderen Fenstern).

import { api } from './api';
import { setLangSetting } from '../i18n';

export async function loadLanguage() {
  try {
    const r = await api.settings();
    setLangSetting(r.settings.language);
  } catch {
    /* Server nicht erreichbar: bleibt bei der zuletzt gespeicherten Wahl */
  }
}
