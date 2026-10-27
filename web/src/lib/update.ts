// Update der lokalen App (siehe src/update.rs): Stand abfragen, prüfen, installieren.
//
// Für das Update beendet sich das Programm: Das App-Fenster schließt sich und die neue
// Version öffnet ein eigenes. Im Browser lädt sich die Seite neu, sobald die neue Version
// antwortet – ihr Status ist wieder „idle“ (die alte kehrt nie dorthin zurück) oder meldet
// eine andere Version.

import { create } from 'zustand';
import { api } from './api';
import type { UpdateStatus } from './types';

const BUSY: UpdateStatus['phase'][] = ['downloading', 'installing', 'restarting'];

export const isBusy = (u: UpdateStatus | null | undefined) => !!u && BUSY.includes(u.phase);

interface UpdateState {
  status: UpdateStatus | null;
  /** Der Server antwortet nicht (Neustart nach dem Update). */
  down: boolean;
  /** Version, von der aus gerade aktualisiert wird; diese Seite verfolgt den Neustart. */
  from: string | null;
  checking: boolean;
  /** Übersprungene Version aus den Einstellungen. */
  skipped: string;
  check(): Promise<void>;
  install(): Promise<void>;
}

let timer: number | undefined;
let started = false;

export const useUpdate = create<UpdateState>((set) => ({
  status: null,
  down: false,
  from: null,
  checking: false,
  skipped: '',
  async check() {
    set({ checking: true });
    try {
      set({ status: await api.update.check(), down: false });
    } finally {
      set({ checking: false });
      schedule();
    }
  },
  async install() {
    const status = await api.update.install();
    set({ status, from: status.current });
    schedule();
  },
}));

/** Neue Version, auf die hingewiesen wird (nicht übersprungen), sonst `null`. */
export function pendingVersion(s: Pick<UpdateState, 'status' | 'skipped'>): string | null {
  const u = s.status;
  return u?.enabled && u.available && u.latest && u.latest !== s.skipped ? u.latest : null;
}

async function poll() {
  try {
    const status = await api.update.status();
    const { from } = useUpdate.getState();
    if (from !== null && (status.phase === 'idle' || status.current !== from)) {
      location.reload();
      return;
    }
    // Auch Updates aus einem anderen Fenster verfolgen; nach einem Fehler nicht mehr.
    const next = isBusy(status) ? (from ?? status.current) : status.phase === 'failed' ? null : from;
    useUpdate.setState({ status, down: false, from: next });
    if (!status.enabled) return; // Server-Modus: keine Updates
  } catch {
    useUpdate.setState({ down: true });
  }
  schedule();
}

/** Schnell während eines Updates, sonst bis zur ersten Prüfung alle 5 s, danach halbstündlich. */
function schedule() {
  window.clearTimeout(timer);
  const { status, from, down } = useUpdate.getState();
  const delay = from !== null || isBusy(status) ? 500 : down ? 10_000 : status?.checkedAt ? 30 * 60_000 : 5_000;
  timer = window.setTimeout(() => void poll(), delay);
}

async function loadSkipped() {
  try {
    const { settings } = await api.settings();
    useUpdate.setState({ skipped: settings.skippedVersion ?? '' });
  } catch {
    /* später erneut beim nächsten Einstellungs-Ereignis */
  }
}

/** Beginnt einmal pro Seite mit der Abfrage (nur in der lokalen App sinnvoll). */
export function startUpdatePolling() {
  if (started) return;
  started = true;
  void loadSkipped();
  window.addEventListener('hakobo-settings', () => void loadSkipped());
  void poll();
}
