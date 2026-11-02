// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Updates der lokalen App außerhalb der Einstellungen: Fortschritt während der
// Installation bis zum Neustart und Hinweis auf eine neue Version (siehe lib/update.ts).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtNum, L } from '../i18n';
import { store } from '../lib/store';
import { isBusy, pendingVersion, useUpdate } from '../lib/update';

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${fmtNum(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
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
          <h2>{L.settings.progress.title(u?.latest ?? '')}</h2>
        </div>
        <div className="dialog-body">
          {u?.phase === 'downloading' && !down && (
            <>
              <p>{L.settings.progress.downloading}</p>
              <div className="update-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <span style={{ width: `${percent}%` }} />
              </div>
              <small className="subtle">{L.settings.progress.percentOf(percent, fileSize(u.downloadSize))}</small>
            </>
          )}
          {u?.phase === 'installing' && !down && (
            <p className="update-step">
              <span className="spinner" /> {L.settings.progress.installing}
            </p>
          )}
          {restarting && (
            <p className="update-step">
              <span className="spinner" />
              {seconds > 120 ? L.settings.progress.stuck : L.settings.progress.restarting}
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
    store().toast(L.settings.progress.available(latest, current), 'info', { label: L.settings.progress.view, run: openUpdates }, { sticky: true });
  }, [latest, current]);
}
