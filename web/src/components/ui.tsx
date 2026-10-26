// Kleine UI-Bausteine: Dialog, verankertes Popover, Menüliste.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width,
  className,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Offene Vorschlagslisten und Felder mit eigener Esc-Belegung (Kürzel-Aufnahme) zuerst.
      if (document.querySelector('.popover.suggest') || (e.target as HTMLElement | null)?.closest?.('[data-esc-local]')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${className ?? ''}`} style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog">
        {title !== undefined && (
          <div className="dialog-header">
            <h2>{title}</h2>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Schließen">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface Anchor {
  left: number;
  top: number;
  bottom: number;
}

/** Popover an einer Bildschirmposition (unterhalb, bei Platzmangel oberhalb). */
export function Popover({ anchor, onClose, children, className, width }: { anchor: Anchor; onClose?: () => void; children: ReactNode; className?: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 4 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let top = anchor.bottom + 4;
    if (top + r.height > window.innerHeight - 8 && anchor.top - r.height - 4 > 8) top = anchor.top - r.height - 4;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - r.width - 8));
    setPos({ left, top });
  }, [anchor.left, anchor.top, anchor.bottom, children]);
  useEffect(() => {
    if (!onClose) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [onClose]);
  return createPortal(
    <div ref={ref} className={`popover ${className ?? ''}`} style={{ left: pos.left, top: pos.top, width }} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

/** Position des Cursors in einem Textfeld (für Vorschlagslisten). */
export function caretAnchor(el: HTMLTextAreaElement | HTMLInputElement, index: number): Anchor {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const mirror = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'borderLeftWidth', 'borderTopWidth', 'whiteSpace', 'wordBreak', 'overflowWrap'] as const) {
    mirror.style[p] = style[p];
  }
  mirror.style.position = 'fixed';
  mirror.style.visibility = 'hidden';
  mirror.style.left = `${r.left}px`;
  mirror.style.top = `${r.top}px`;
  mirror.style.width = `${r.width}px`;
  mirror.style.whiteSpace = el instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
  mirror.textContent = el.value.slice(0, index);
  const span = document.createElement('span');
  span.textContent = '​';
  mirror.append(span);
  document.body.append(mirror);
  const s = span.getBoundingClientRect();
  mirror.remove();
  const line = parseFloat(style.lineHeight) || 20;
  const top = s.top - el.scrollTop;
  return { left: s.left, top, bottom: top + line };
}

/** Hervorgehobener Text (Bereiche in UTF-16-Einheiten). */
export function Highlighted({ text, ranges }: { text: string; ranges?: [number, number][] }) {
  if (!ranges?.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([s, e], i) => {
    if (s > last) out.push(text.slice(last, s));
    if (e > Math.max(s, last)) out.push(<mark className="hl" key={i}>{text.slice(Math.max(s, last), e)}</mark>);
    last = Math.max(last, e);
  });
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

/** Hält das aktive Menüelement im sichtbaren Bereich. */
export function useScrollActive(container: React.RefObject<HTMLElement | null>, active: number) {
  useEffect(() => {
    const el = container.current?.querySelector('.is-active');
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [container, active]);
}
