// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Texte (Deutsch): editor

export const editor = {
  noLinkHere: 'Hier gibt es keinen Link zum Öffnen',
  linkCopied: 'Link kopiert – mit Strg+V in einen Knoten einfügen',
  onlyImages: 'Nur Bilder lassen sich hier ablegen',
  notePlaceholder: 'Notiz … (Markdown, ```code```, [[Link]], #tag)',
  codePlaceholder: 'Code …',
  /** Was kopiert wurde (Vorgabe für die Meldung „… kopiert“). */
  code: 'Code',
  copied: (what: string) => `${what} kopiert`,
  copyFailed: 'Kopieren nicht möglich',
  chooseLanguage: 'Sprache wählen',
  language: 'Sprache',
  copyCode: 'Code kopieren',
  searchLanguage: 'Sprache suchen …',
  noLanguage: 'Ohne Sprache',
  /** Tooltip eines Links im Editor. */
  linkOpens: 'Strg+Klick oder Strg+O öffnet das Ziel',
  linkMissing: 'Ziel gibt es (noch) nicht',
  targetMissing: (target: string) => `„${target}“ gibt es (noch) nicht`,
};
