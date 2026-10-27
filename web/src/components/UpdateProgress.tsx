// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Updates der lokalen App außerhalb der Einstellungen: Fortschritt während der
// Installation bis zum Neustart und Hinweis auf eine neue Version (siehe lib/update.ts).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { store } from '../lib/store';
import { isBusy, pendingVersion, useUpdate } from '../lib/update';

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

/** Öffnet die Einstellungen beim Bereich „Updates“. */
export function openUpdates() {
  store().set({ settingsOpen: true, settingsTab: 'updates' });
}

/** Fortschritt während der Installation bis zum Neustart; lässt sich nicht schließen. */
export function UpdateProgress() {
  const { status: u, down, from } = useUpdate();
  const restarting = from !== null && (u?.phase === 'restarting' || down);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!restarting) return;
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [restarting]);
  if (from === null || !(isBusy(u) || down)) return null;
  const percent = Math.round((u?.progress ?? 0) * 100);
  return createPortal(
    <div className="overlay update-overlay">
      <div className="dialog update-progress" role="dialog" aria-live="polite">
        <div className="dialog-header">
          <h2>Update auf Hakobo {u?.latest ?? ''}</h2>
        </div>
        <div className="dialog-body">
          {u?.phase === 'downloading' && !down && (
            <>
              <p>Die neue Version wird heruntergeladen und geprüft …</p>
              <div className="update-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <span style={{ width: `${percent}%` }} />
              </div>
              <small className="subtle">
                {percent} % von {fileSize(u.downloadSize)}
              </small>
            </>
          )}
          {u?.phase === 'installing' && !down && (
            <p className="update-step">
              <span className="spinner" /> Wird installiert …
            </p>
          )}
          {restarting && (
            <p className="update-step">
              <span className="spinner" />
              {seconds > 120
                ? 'Hakobo wurde beendet, meldet sich aber noch nicht zurück. Falls es nicht von selbst startet, bitte Hakobo neu starten.'
                : 'Hakobo wird neu gestartet – gleich geht es mit der neuen Version weiter.'}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Version, auf die schon hingewiesen wurde – der Hinweis kommt einmal pro Programmstart. */
let announced = '';

/** Weist einmal pro Programmstart auf eine neue Version hin, sofern sie nicht übersprungen wurde. */
export function useUpdateNotice() {
  const latest = useUpdate(pendingVersion);
  const current = useUpdate((s) => s.status?.current ?? '');
  useEffect(() => {
    if (!latest || announced === latest) return;
    announced = latest;
    store().toast(`Hakobo ${latest} ist verfügbar (installiert: ${current}).`, 'info', { label: 'Ansehen', run: openUpdates }, { sticky: true });
  }, [latest, current]);
}
