// Schriftgröße bzw. Zoom der ganzen Oberfläche.
//
// In der Desktop-App zoomt die WebView selbst (wie Strg+Plus im Browser), der
// Server gibt den Wert an die Fenster weiter. Im reinen Browser-Modus
// übernimmt CSS `zoom` am Wurzelelement.

import { useSyncExternalStore } from 'react';
import { api } from './api';
import { desktop } from './desktop';

export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2;

let current = 1;
const listeners = new Set<() => void>();

const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

function apply(z: number) {
  current = z;
  if (!desktop) {
    const root = document.documentElement;
    root.style.zoom = z === 1 ? '' : String(z);
    root.style.setProperty('--ui-zoom', String(z));
  }
  listeners.forEach((l) => l());
}

export function getZoom(): number {
  return current;
}

/** Umrechnung von Bildschirm- in CSS-Koordinaten (nur beim CSS-Zoom nötig). */
export function cssZoom(): number {
  return desktop ? 1 : current;
}

export function useZoom(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Gespeicherten Wert dieses Rechners übernehmen. */
export async function loadZoom() {
  try {
    const r = await api.settings();
    apply(clamp(r.settings.uiScale || 1));
  } catch {
    /* Server nicht erreichbar: bleibt wie es ist */
  }
}

let saveTimer: number | undefined;

/** Neuen Wert anwenden und (kurz danach) in den Einstellungen speichern. */
export function setZoom(z: number) {
  const next = clamp(z);
  apply(next);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      const r = await api.settings();
      if (r.settings.uiScale !== next) await api.saveSettings({ ...r.settings, uiScale: next });
    } catch {
      /* wird beim nächsten Mal gespeichert */
    }
  }, 150);
}

/** Eine Stufe größer (1) bzw. kleiner (-1). */
export function stepZoom(dir: 1 | -1) {
  const z = current;
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
  if (next !== undefined) setZoom(next);
}
