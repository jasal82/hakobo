// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Aufnahme eines globalen Tastenkürzels (Format von global-hotkey, z. B. `Ctrl+Shift+Space`).

import { useState } from 'react';
import { L } from '../../i18n';

/** Tasten, deren Beschriftung in allen Sprachen gleich ist (die übrigen stehen in `L.settings.hotkey.keys`). */
const KEY_SYMBOL: Record<string, string> = {
  Alt: 'Alt',
  Super: 'Win',
  Enter: 'Enter',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Comma: ',',
  Period: '.',
  Minus: '-',
  Equal: '=',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
};

/** Beschriftung der Tasten eines Kürzels in der aktuellen Sprache. */
export function hotkeyParts(hk: string): string[] {
  const names: Record<string, string> = L.settings.hotkey.keys;
  return hk
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const norm = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
      if (names[norm]) return names[norm];
      if (KEY_SYMBOL[norm]) return KEY_SYMBOL[norm];
      if (/^Control$/i.test(p)) return names.Ctrl;
      if (/^(Meta|Cmd|Command)$/i.test(p)) return 'Win';
      if (/^Key[A-Z]$/i.test(p)) return p.slice(3).toUpperCase();
      if (/^Digit\d$/i.test(p)) return p.slice(5);
      if (/^Numpad\d$/i.test(p)) return `Num ${p.slice(6)}`;
      return norm;
    });
}

/** Taste aus `KeyboardEvent.code` im Format, das global-hotkey versteht. */
function keyName(code: string): string | null {
  if (/^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|20)$/.test(code)) return code;
  if (code === 'Escape' || code === 'Unidentified' || !code) return null;
  return code;
}

function record(e: React.KeyboardEvent): string | null {
  const key = keyName(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  // Ohne Modifikator nur Funktionstasten (sonst ginge die Taste überall verloren).
  if (!mods.length && !/^F\d+$/.test(key)) return null;
  // Nur Umschalt + Buchstabe wäre ein normaler Großbuchstabe.
  if (mods.length === 1 && mods[0] === 'Shift' && !/^F\d+$/.test(key)) return null;
  return [...mods, key].join('+');
}

export function HotkeyInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  return (
    <button
      type="button"
      className={`hotkey-input${recording ? ' is-recording' : ''}`}
      data-esc-local=""
      disabled={disabled}
      onFocus={() => {
        setRecording(true);
        setHint(null);
      }}
      onBlur={() => {
        setRecording(false);
        setHint(null);
      }}
      onClick={(e) => e.currentTarget.focus()}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          (e.currentTarget as HTMLButtonElement).blur();
          return;
        }
        if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
          (e.currentTarget as HTMLButtonElement).blur();
          return;
        }
        const hk = record(e);
        if (!hk) {
          if (!/^(Control|Shift|Alt|Meta|OS)/.test(e.code)) setHint(L.settings.hotkey.needsModifier);
          return;
        }
        setHint(null);
        onChange(hk);
        (e.currentTarget as HTMLButtonElement).blur();
      }}
      aria-label={L.settings.hotkey.record}
    >
      {recording ? (
        <span className="hotkey-prompt">{hint ?? L.settings.hotkey.prompt}</span>
      ) : value ? (
        <span className="hotkey-keys">
          {hotkeyParts(value).map((p, i) => (
            <kbd key={i}>{p}</kbd>
          ))}
        </span>
      ) : (
        <span className="faint">{L.settings.hotkey.none}</span>
      )}
    </button>
  );
}
