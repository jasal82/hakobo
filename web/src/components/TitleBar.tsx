// Titelleiste: Navigation, Suche, Schnellerfassung, Fensterknöpfe (Desktop).

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Minus, PanelLeft, Plus, Search, Square, X } from 'lucide-react';
import { desktop, ipc } from '../lib/desktop';
import { store, useStore } from '../lib/store';

export function TitleBar() {
  const [max, setMax] = useState(false);
  const sidebar = useStore((s) => s.sidebar);
  useEffect(() => {
    window.__hakoboWindow = (s) => setMax(s.maximized);
    ipc('ready');
  }, []);
  const isWin = desktop?.platform === 'windows';
  return (
    <header
      className={`titlebar${desktop ? ' is-desktop' : ''}`}
      onMouseDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input')) return;
        if (e.detail === 2) ipc('maximize');
        else ipc('drag');
      }}
    >
      <div className="tb-left">
        {desktop?.platform === 'macos' && <span className="tb-traffic" />}
        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={() => {
            const v = !sidebar;
            store().set({ sidebar: v });
            try {
              localStorage.setItem('hakobo-sidebar', v ? '1' : '0');
            } catch {
              /* egal */
            }
          }}
          title="Seitenleiste (Strg+\)"
        >
          <PanelLeft size={15} />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => history.back()} title="Zurück (Alt+←)">
          <ArrowLeft size={15} />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => history.forward()} title="Vor">
          <ArrowRight size={15} />
        </button>
        <span className="tb-brand">Hakobo</span>
      </div>
      <button className="tb-search" onClick={() => store().set({ searchOpen: true })}>
        <Search size={14} />
        <span>Suchen …</span>
        <kbd>Strg K</kbd>
      </button>
      <div className="tb-right">
        <button className="btn btn-ghost btn-sm" onClick={() => store().set({ captureOpen: true })} title="Schnell erfassen (Strg+N)">
          <Plus size={15} /> Erfassen
        </button>
        {isWin && (
          <div className="win-controls">
            <button onClick={() => ipc('minimize')} aria-label="Minimieren">
              <Minus size={15} />
            </button>
            <button onClick={() => ipc('maximize')} aria-label={max ? 'Wiederherstellen' : 'Maximieren'}>
              {max ? <Copy size={13} style={{ transform: 'scaleX(-1)' }} /> : <Square size={12} />}
            </button>
            <button className="win-close" onClick={() => ipc('close')} aria-label="Schließen">
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
