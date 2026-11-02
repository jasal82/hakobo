// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Übersicht der Tastenkürzel (F1 und „Über Hakobo“ in den Einstellungen).

import { L } from '../i18n';
import { store } from '../lib/store';
import { Dialog } from './ui';

/** Gruppen aus [Tasten, Beschreibung] in der aktuellen Sprache; Alternativen sind mit „ / “ getrennt. */
export function shortcutGroups() {
  return L.shortcuts.groups;
}

export function ShortcutTable() {
  return (
    <>
      {shortcutGroups().map((g) => (
        <section key={g.title} className="shortcut-group">
          <h4>{g.title}</h4>
          <table className="set-table">
            <tbody>
              {g.keys.map(([k, d]) => (
                <tr key={k}>
                  <td>
                    {k.split(' / ').map((part, i) => (
                      <span key={i}>
                        {i > 0 && ' / '}
                        <kbd>{part}</kbd>
                      </span>
                    ))}
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

export function ShortcutsDialog() {
  const close = () => store().set({ shortcutsOpen: false });
  return (
    <Dialog title={L.shortcuts.title} onClose={close} width={640} className="shortcuts-dialog">
      {/* Fokussierbar, damit die Pfeiltasten die Liste rollen. */}
      <div className="shortcuts-body" tabIndex={0} aria-label={L.shortcuts.list}>
        <ShortcutTable />
      </div>
    </Dialog>
  );
}
