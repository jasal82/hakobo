// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Kleine UI-Bausteine: Dialog, verankertes Popover, Menüliste, Tastatur-Helfer.

import { useEffect, useLayoutEffect, useRef, useState, type AnchorHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cssZoom } from '../lib/zoom';
import { routeToHash, store, type Route } from '../lib/store';
import { L } from '../i18n';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex], [contenteditable="true"]';

/** Per Tab erreichbare, sichtbare Elemente in `root` (in Dokumentreihenfolge). */
export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}

/** Hält Tab und Umschalt+Tab innerhalb von `root`. */
function trapTab(e: ReactKeyboardEvent, root: HTMLElement) {
  if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  const list = focusables(root);
  const active = document.activeElement;
  if (!list.length) {
    e.preventDefault();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey ? active === first || !root.contains(active) : active === last || !root.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

/** Wohin der Fokus nach dem Schließen eines Popovers zurückkehrt (für Dialoge, die aus einem Menü heraus öffnen). */
const returnTargets = new WeakMap<Element, HTMLElement>();

function currentFocus(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return null;
  const pop = a.closest('.popover');
  return (pop && returnTargets.get(pop)) || a;
}

/**
 * Merkt sich das fokussierte Element beim Öffnen und gibt ihm den Fokus beim Schließen zurück –
 * sofern bis dahin nichts anderes (z. B. ein Editor) den Fokus übernommen hat.
 * `skip` (gesetzt beim Schließen per Klick daneben) lässt den Fokus dort, wo geklickt wurde.
 */
function useReturnFocus(enabled = true, skip?: { current: boolean }): HTMLElement | null {
  const [prev] = useState(() => (enabled ? currentFocus() : null));
  useEffect(
    () => () => {
      if (!prev) return;
      window.setTimeout(() => {
        const a = document.activeElement;
        if (!prev.isConnected || (a && a !== document.body)) return;
        prev.focus({ preventScroll: true });
        // Klick ins Leere: Fokus nicht behalten, aber das Verlassen melden (ein Editor beendet dann die Bearbeitung).
        if (skip?.current) prev.blur();
      }, 0);
    },
    [prev, skip],
  );
  return prev;
}

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
  const ref = useRef<HTMLDivElement>(null);
  useReturnFocus();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Offene Vorschlagslisten, Popover und Felder mit eigener Esc-Belegung (Kürzel-Aufnahme) zuerst.
      if (document.querySelector('.popover.suggest') || (e.target as HTMLElement | null)?.closest?.('[data-esc-local], .popover')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // Fokus in den Dialog holen (sofern der Inhalt das nicht selbst tut).
  useEffect(() => {
    const el = ref.current;
    if (!el || el.contains(document.activeElement)) return;
    (focusables(el).find((f) => !f.closest('.dialog-header')) ?? el).focus({ preventScroll: true });
  }, []);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dialog ${className ?? ''}`}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Popover hängen am Dokument, ihre Ereignisse laufen aber durch den React-Baum.
          if (ref.current?.contains(e.target as Node)) trapTab(e, ref.current);
        }}
      >
        {title !== undefined && (
          <div className="dialog-header">
            <h2>{title}</h2>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={L.common.close}>
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

/**
 * Popover an einer Bildschirmposition (unterhalb, bei Platzmangel oberhalb).
 * Mit `onClose` übernimmt es den Fokus: Pfeiltasten in Menüs, Tab bleibt im Popover,
 * Esc schließt und gibt den Fokus zurück. Ohne `onClose` (Vorschlagslisten) bleibt
 * der Fokus im Editor.
 */
export function Popover({ anchor, onClose, children, className, width }: { anchor: Anchor; onClose?: () => void; children: ReactNode; className?: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 4 });
  const interactive = !!onClose;
  const clickedAway = useRef(false);
  const prev = useReturnFocus(interactive, clickedAway);
  useEffect(() => {
    const el = ref.current;
    if (!interactive || !el) return;
    if (prev) returnTargets.set(el, prev);
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>('.menu-item.is-active, .menu-item.is-current') ?? focusables(el)[0] ?? el).focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const el = ref.current;
    if (!interactive || !el || !el.contains(e.target as Node)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose!();
      return;
    }
    if (e.key === 'Tab') {
      trapTab(e, el);
      return;
    }
    // Pfeiltasten zwischen Menüeinträgen (Eingabefelder steuern ihre Listen selbst).
    const item = (e.target as HTMLElement).closest('.menu-item');
    if (item && moveFocus(e, el, '.menu-item', { wrap: true })) e.stopPropagation();
  };
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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        clickedAway.current = true;
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className ?? ''}`}
      style={{ left: pos.left / cssZoom(), top: pos.top / cssZoom(), width }}
      tabIndex={interactive ? -1 : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      // Kein Browser-Kontextmenü über dem eigenen (z. B. nach Umschalt+F10).
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Pfeiltasten (↑ ↓, Pos1, Ende) bewegen den Fokus zwischen den Elementen `selector` in `scope`.
 * Liefert `true`, wenn die Taste verarbeitet wurde.
 */
export function moveFocus(e: ReactKeyboardEvent | KeyboardEvent, scope: Element, selector: string, opts: { wrap?: boolean; horizontal?: boolean } = {}): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  const prevKey = opts.horizontal ? 'ArrowLeft' : 'ArrowUp';
  const nextKey = opts.horizontal ? 'ArrowRight' : 'ArrowDown';
  if (![prevKey, nextKey, 'Home', 'End'].includes(e.key)) return false;
  const list = [...scope.querySelectorAll<HTMLElement>(selector)].filter((el) => el.getClientRects().length > 0);
  if (!list.length) return false;
  const i = list.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
  let next: number;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = list.length - 1;
  else {
    const d = e.key === prevKey ? -1 : 1;
    next = i < 0 ? (d > 0 ? 0 : list.length - 1) : i + d;
    if (next < 0 || next >= list.length) next = opts.wrap ? (next + list.length) % list.length : i;
  }
  e.preventDefault();
  list[next].focus();
  list[next].scrollIntoView({ block: 'nearest' });
  return true;
}

/** Enter und Leertaste lösen ein Element mit `role="button"` aus (nicht seine inneren Knöpfe). */
export function activateKeys(run: () => void) {
  return (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run();
    }
  };
}

/** Link auf eine Ansicht: per Tab erreichbar, Enter und Klick navigieren in der App. */
export function RouteLink({ route, children, ...rest }: { route: Route; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>) {
  return (
    <a
      // Links nicht als Adresse ziehen (außer der Aufrufer will es, z. B. Seiten im Baum).
      draggable={false}
      {...rest}
      href={routeToHash(route)}
      onClick={(e: ReactMouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        store().navigate(route);
      }}
      // Kein neues Fenster per Mittelklick.
      onAuxClick={(e) => e.preventDefault()}
    >
      {children}
    </a>
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
