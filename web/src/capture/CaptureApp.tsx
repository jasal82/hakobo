// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Erfassungsfenster für den globalen Hotkey: rahmenlos, transparent, oben
// eine Karte mit dem Eingabefeld. Die Desktop-Hülle ruft bei jedem Öffnen
// `window.__hakoboCapture.show()` auf.

import { loadZoom } from '../lib/zoom';
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, GripHorizontal } from 'lucide-react';
import { CaptureBox, type Captured } from '../components/CaptureBox';
import { desktop, ipc } from '../lib/desktop';
import { store, useStore } from '../lib/store';

export function CaptureApp() {
  const [resetKey, setResetKey] = useState(0);
  const [success, setSuccess] = useState<Captured | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const toasts = useStore((s) => s.toasts);

  useEffect(() => {
    // Notizbuch laden (Typen und Knoten für Vorschläge und Linktexte).
    void store().init();
    void loadZoom();
    window.__hakoboCapture = {
      show: () => {
        window.clearTimeout(timer.current);
        setSuccess(null);
        setResetKey((k) => k + 1);
        // Schriftgröße könnte sich im Hauptfenster geändert haben.
        void loadZoom();
      },
    };
    return () => {
      window.__hakoboCapture = undefined;
    };
  }, []);

  const hide = () => {
    window.clearTimeout(timer.current);
    setSuccess(null);
    // Im normalen Browser gibt es kein Fenster zum Verstecken: einfach leeren.
    if (!ipc('hide')) setResetKey((k) => k + 1);
  };

  const done = (r: Captured, open: boolean) => {
    if (open && ipc(`open:${r.id}`)) {
      setResetKey((k) => k + 1);
      return;
    }
    setSuccess(r);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(hide, desktop ? 700 : 1600);
  };

  return (
    <div className="capture-app" onMouseDown={(e) => e.target === e.currentTarget && hide()}>
      <div className="capture-card">
        <div className="capture-grip" onMouseDown={() => ipc('drag')} title="Verschieben">
          <GripHorizontal size={14} />
          <span>Schnell erfassen</span>
        </div>
        {success ? (
          <div className="capture-success">
            <CircleCheck size={20} />
            <div>
              <div className="capture-success-title">
                {success.place}: <b>{success.text || 'Eintrag'}</b>
              </div>
              {success.summary.length > 0 && <div className="capture-success-sub">{success.summary.join(' · ')}</div>}
            </div>
          </div>
        ) : (
          <CaptureBox variant="window" resetKey={resetKey} onCancel={hide} onDone={done} />
        )}
        {toasts
          .filter((t) => t.kind === 'error')
          .slice(-1)
          .map((t) => (
            <div key={t.id} className="capture-error">
              {t.text}
            </div>
          ))}
      </div>
    </div>
  );
}
