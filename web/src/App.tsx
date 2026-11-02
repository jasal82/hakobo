// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CircleCheck, CircleAlert, X } from 'lucide-react';
import { store, useStore } from './lib/store';
import { visibleList } from './lib/outline';
import { loadZoom, setZoom, stepZoom } from './lib/zoom';
import { startUpdatePolling } from './lib/update';
import { UpdateProgress, useUpdateNotice } from './components/UpdateProgress';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { SearchPalette } from './components/SearchPalette';
import { AssignDialog, MoveDialog } from './components/MoveDialog';
import { CaptureModal } from './components/CaptureBox';
import { SettingsDialog } from './components/SettingsDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { ShortcutsDialog } from './components/Shortcuts';
import { focusables } from './components/ui';
import { NodeView } from './views/NodeView';
import { AgendaView } from './views/AgendaView';
import { WeekView } from './views/WeekView';
import { MonthView } from './views/MonthView';
import { calendarRoute } from './views/parts/calendar';
import { TodoView } from './views/TodoView';
import { TagView } from './views/TagView';
import { TypeView } from './views/TypeView';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-${t.kind}`}>
          {t.kind === 'error' ? <CircleAlert size={16} /> : t.kind === 'success' ? <CircleCheck size={16} /> : null}
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                t.action!.run();
                store().dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => store().dismissToast(t.id)} aria-label="Schließen">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Main() {
  const route = useStore((s) => s.route);
  const inbox = useStore((s) => s.inbox);
  switch (route.view) {
    case 'inbox':
      return <NodeView id={inbox} inbox key="inbox" />;
    case 'agenda':
      return <AgendaView />;
    case 'todos':
      return <TodoView />;
    case 'week':
      return <WeekView start={route.start} />;
    case 'month':
      return <MonthView month={route.month} />;
    case 'tag':
      return <TagView tag={route.tag} key={route.tag} />;
    case 'type':
      return <TypeView type={route.type} key={route.type} />;
    default:
      return <NodeView id={route.id} key={route.id} />;
  }
}

function isEditable(el: Element | null): boolean {
  return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable);
}

/** Die Taste ging an kein bestimmtes Element (nur an die Seite oder die Ansicht selbst). */
function untargeted(e: KeyboardEvent): boolean {
  const t = e.target as Element | null;
  return !e.defaultPrevented && (!t || t === document.body || t === document.documentElement || t.matches('.app, .main, .view'));
}

/** Zuletzt bearbeiteter Knoten – dorthin kehren Pfeiltasten und F6 zurück. */
let lastFocus: string | null = null;

/** Fokus in die Gliederung der aktuellen Ansicht setzen. */
function enterOutline(key: string): boolean {
  const s = store();
  const root = s.route.view === 'node' ? s.route.id : s.route.view === 'inbox' ? s.inbox : null;
  if (!root || !s.nodes[root]) return false;
  const list = visibleList(root);
  if (!list.length) {
    // Leere Seite: in den Titel.
    if (s.nodes[root].kind === 'root' || root === s.inbox) return false;
    s.setFocus({ id: root, caret: 'end' });
    return true;
  }
  const i = lastFocus ? list.indexOf(lastFocus) : -1;
  let target: string;
  if (i >= 0) target = key === 'ArrowDown' ? list[Math.min(i + 1, list.length - 1)] : key === 'ArrowUp' ? list[Math.max(i - 1, 0)] : list[i];
  else target = key === 'ArrowUp' ? list[list.length - 1] : list[0];
  s.setFocus({ id: target, caret: 'end' });
  return true;
}

/** F6: zwischen Titelleiste, Seitenleiste, Inhalt und Meldungen wechseln. */
function cycleRegion(dir: 1 | -1) {
  const regions = ['.titlebar', '.sidebar', '.main', '.toasts'].map((q) => document.querySelector<HTMLElement>(q)).filter((el): el is HTMLElement => !!el);
  const main = regions.findIndex((r) => r.matches('.main'));
  let i = regions.findIndex((r) => r.contains(document.activeElement));
  if (i < 0) i = main - dir;
  const next = regions[(i + dir + regions.length * 2) % regions.length];
  if (next.matches('.main') && enterOutline('Enter')) return;
  const preferred = next.matches('.sidebar') ? next.querySelector<HTMLElement>('.nav-link.is-active, .nav-item.is-active .nav-link') : null;
  (preferred ?? focusables(next)[0])?.focus();
}

const VIEW_KEYS: Record<string, () => void> = {
  '1': () => store().navigate({ view: 'inbox' }),
  '2': () => store().navigate({ view: 'agenda' }),
  '3': () => store().navigate({ view: 'todos' }),
  '4': () => store().navigate(calendarRoute()),
  '5': () => store().navigate({ view: 'node', id: store().root }),
};

export function App() {
  const ready = useStore((s) => s.ready);
  const loadError = useStore((s) => s.loadError);
  const sidebar = useStore((s) => s.sidebar);
  const overlays = useStore(useShallow((s) => ({ search: s.searchOpen, move: !!s.move, assign: !!s.assign, capture: s.captureOpen, settings: s.settingsOpen, history: !!s.history, shortcuts: s.shortcutsOpen })));

  useUpdateNotice();

  useEffect(() => {
    void store().init();
    // Updates (nur lokale App; im Server-Modus endet die Abfrage nach der ersten Antwort).
    startUpdatePolling();
    // Schriftgröße: gespeicherten Wert übernehmen, auch nach Änderungen in anderen Fenstern.
    void loadZoom();
    const onSettings = () => void loadZoom();
    window.addEventListener('hakobo-settings', onSettings);
    // Strg+Mausrad vergrößert/verkleinert.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('hakobo-settings', onSettings);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const inEditor = isEditable(document.activeElement) || !!document.activeElement?.closest('.cm-editor');
      if (mod && !e.shiftKey && (k === 'k' || k === 'p')) {
        e.preventDefault();
        s.set({ searchOpen: true });
      } else if (mod && e.shiftKey && k === 'f') {
        e.preventDefault();
        s.set({ searchOpen: true });
      } else if (mod && !e.shiftKey && k === 'n') {
        e.preventDefault();
        s.set({ captureOpen: true });
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        s.set({ sidebar: !s.sidebar });
      } else if (mod && !e.altKey && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) {
        e.preventDefault();
        stepZoom(1);
      } else if (mod && !e.altKey && (e.key === '-' || e.code === 'NumpadSubtract')) {
        e.preventDefault();
        stepZoom(-1);
      } else if (mod && !e.altKey && !e.shiftKey && (e.key === '0' || e.code === 'Numpad0')) {
        e.preventDefault();
        setZoom(1);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        s.set({ settingsOpen: true });
      } else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && !mod && !e.altKey) {
        // Aktionsmenü des Eintrags, in dem der Fokus steht (Gliederung oder Titel).
        const btn = document.activeElement?.closest('.ot-cell, .row-line, .zoom-title-row')?.querySelector<HTMLElement>('[aria-haspopup="menu"]');
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      } else if (e.key === 'F1' && !mod && !e.altKey) {
        e.preventDefault();
        s.set({ shortcutsOpen: true });
      } else if (e.key === 'F6' && !mod && !e.altKey && !document.querySelector('.overlay')) {
        e.preventDefault();
        cycleRegion(e.shiftKey ? -1 : 1);
      } else if (mod && !e.shiftKey && !e.altKey && VIEW_KEYS[e.key] && !document.querySelector('.overlay')) {
        e.preventDefault();
        VIEW_KEYS[e.key]();
      } else if (e.altKey && e.key === 'ArrowLeft' && !inEditor) {
        e.preventDefault();
        history.back();
      } else if (e.altKey && e.key === 'ArrowRight' && !inEditor) {
        e.preventDefault();
        history.forward();
      } else if (!inEditor && mod && !e.shiftKey && k === 'z') {
        e.preventDefault();
        s.undo();
      } else if (!inEditor && mod && ((e.shiftKey && k === 'z') || k === 'y')) {
        e.preventDefault();
        s.redo();
      } else if (!mod && !e.altKey && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') && untargeted(e) && !s.selection.length && !document.querySelector('.overlay, .popover')) {
        // Ohne Fokus: in die Gliederung springen (dorthin, wo zuletzt bearbeitet wurde).
        if (enterOutline(e.key)) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    const unsub = useStore.subscribe((st) => {
      if (st.focus) lastFocus = st.focus.id;
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      unsub();
    };
  }, []);

  if (loadError) {
    return (
      <div className="boot">
        <h2>Hakobo konnte das Notizbuch nicht laden</h2>
        <p className="subtle">{loadError}</p>
        <button className="btn" onClick={() => location.reload()}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <div className={`app${sidebar ? '' : ' no-sidebar'}`}>
      <TitleBar />
      <div className="app-body">
        {sidebar && <Sidebar />}
        <main className="main">{ready ? <Main /> : <div className="boot"><div className="spinner" /></div>}</main>
      </div>
      {overlays.search && <SearchPalette />}
      {overlays.move && <MoveDialog />}
      {overlays.assign && <AssignDialog />}
      {overlays.capture && <CaptureModal />}
      {overlays.settings && <SettingsDialog />}
      {overlays.history && <HistoryDialog />}
      {overlays.shortcuts && <ShortcutsDialog />}
      <UpdateProgress />
      <Toasts />
    </div>
  );
}
