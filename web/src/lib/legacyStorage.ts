// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Hakobo hieß früher Sqizzo: Ansichtseinstellungen unter den alten Schlüsseln übernehmen.
// Erster Import in main.tsx, damit Module, die schon beim Laden lesen (z. B. das Theme),
// die neuen Schlüssel vorfinden.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('sqizzo-')) continue;
    const next = `hakobo-${key.slice('sqizzo-'.length)}`;
    const value = localStorage.getItem(key);
    if (value !== null && localStorage.getItem(next) === null) localStorage.setItem(next, value);
    localStorage.removeItem(key);
  }
} catch {
  // Kein Speicher verfügbar (z. B. gesperrt): Dann gibt es auch nichts zu übernehmen.
}

export {};
