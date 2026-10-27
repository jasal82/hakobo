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
import { NodeView } from './views/NodeView';
import { AgendaView, WeekView } from './views/AgendaView';
import { TodoView } from './views/TodoView';
import { TagView } from './views/TagView';
import { TypeView } from './views/TypeView';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
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

export function App() {
  const ready = useStore((s) => s.ready);
  const loadError = useStore((s) => s.loadError);
  const sidebar = useStore((s) => s.sidebar);
  const overlays = useStore(useShallow((s) => ({ search: s.searchOpen, move: !!s.move, assign: !!s.assign, capture: s.captureOpen, settings: s.settingsOpen, history: !!s.history })));

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
      } else if (!inEditor && !mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') && s.route.view === 'node' && !s.selection.length && !document.querySelector('.overlay')) {
        // Ohne Fokus: in die Gliederung springen.
        const root = s.route.view === 'node' ? s.route.id : s.root;
        const list = visibleList(root);
        if (!list.length) return;
        e.preventDefault();
        s.setFocus({ id: e.key === 'ArrowUp' ? list[list.length - 1] : list[0], caret: 'end' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      <UpdateProgress />
      <Toasts />
    </div>
  );
}
