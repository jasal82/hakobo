// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// IDs wie im Backend: 6 Zeichen, erstes ein Buchstabe.

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALNUM = LETTERS + '0123456789';

export function newId(): string {
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  let s = LETTERS[buf[0] % 26];
  for (let i = 1; i < 6; i++) s += ALNUM[buf[i] % 36];
  return s;
}
