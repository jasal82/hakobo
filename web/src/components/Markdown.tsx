// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Gerenderte Markdown-Notiz mit Wiki-Links, Tags, Bildern und hervorgehobenem Code.

import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { enhance, renderMarkdown } from '../lib/markdown';
import { isPerson, linkLabel, resolveKey } from '../lib/links';
import { store, useStore } from '../lib/store';
import type { Node } from '../lib/types';
import { cssZoom } from '../lib/zoom';
import { openExternal, openTag } from './RichText';

/** Großansicht eines Bilds öffnen (siehe ImageViewer). */
function openImage(el: HTMLElement) {
  const img = el.querySelector('img');
  if (!img) return;
  store().set({ imageView: { url: img.currentSrc || img.src, href: el.dataset.src ?? '', alt: img.alt } });
}

export const Markdown = memo(function Markdown({
  text,
  source,
  className,
  onClick,
  onImageResize,
}: {
  text: string;
  source?: Node;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  /** Neue Breite des `k`-ten Bilds mit Pfad `href` (`null`: automatisch). Ohne: Breite nicht änderbar. */
  onImageResize?: (href: string, k: number, width: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Nur Notizen mit Links hängen von anderen Knoten ab.
  const nodes = useStore((s) => (text.includes('[[') ? s.nodes : null));
  const html = useMemo(() => renderMarkdown(text), [text]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    enhance(el, {
      link: (key, alias, target) => {
        const all = nodes ?? store().nodes;
        const id = resolveKey(all, source, key);
        return { id, label: linkLabel(all, id, alias, target), person: isPerson(id ? all[id] : undefined) };
      },
    });
  }, [html, nodes, source]);

  /** Breite ziehen: live am Rahmen, gespeichert beim Loslassen. */
  const resize = (e: React.MouseEvent, frame: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    const z = cssZoom();
    const x0 = e.clientX;
    const w0 = frame.getBoundingClientRect().width / z;
    const max = (frame.parentElement?.getBoundingClientRect().width ?? 2000) / z;
    let w = w0;
    const move = (ev: MouseEvent) => {
      w = Math.max(48, Math.min(max, w0 + (ev.clientX - x0) / z));
      frame.style.width = `${w}px`;
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      document.body.classList.remove('is-img-resizing');
      if (Math.abs(w - w0) >= 1) onImageResize?.(frame.dataset.src ?? '', Number(frame.dataset.k ?? 0), w);
    };
    document.body.classList.add('is-img-resizing');
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

  return (
    <div
      ref={ref}
      className={`md${onImageResize ? ' can-resize' : ''} ${className ?? ''}`}
      onMouseDown={(e) => {
        const handle = (e.target as HTMLElement).closest('.md-img-resize');
        const frame = handle?.closest<HTMLElement>('.md-img');
        if (handle && frame && onImageResize && e.button === 0) resize(e, frame);
      }}
      onDoubleClick={(e) => {
        const frame = (e.target as HTMLElement).closest('.md-img-resize')?.closest<HTMLElement>('.md-img');
        if (!frame || !onImageResize) return;
        e.preventDefault();
        e.stopPropagation();
        onImageResize(frame.dataset.src ?? '', Number(frame.dataset.k ?? 0), null);
      }}
      onKeyDown={(e) => {
        const frame = (e.target as HTMLElement).closest<HTMLElement>('.md-img');
        if (frame && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          e.stopPropagation();
          openImage(frame);
        }
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.md-img-resize')) {
          e.stopPropagation();
          return;
        }
        const frame = target.closest<HTMLElement>('.md-img');
        if (frame) {
          e.preventDefault();
          e.stopPropagation();
          openImage(frame);
          return;
        }
        const copy = target.closest('.md-copy');
        if (copy) {
          e.preventDefault();
          e.stopPropagation();
          const code = copy.parentElement?.querySelector('code')?.textContent ?? '';
          void navigator.clipboard.writeText(code).then(
            () => store().toast('Code kopiert', 'success'),
            () => store().toast('Kopieren nicht möglich', 'error'),
          );
          return;
        }
        const a = target.closest('a') as HTMLAnchorElement | null;
        if (a) {
          e.preventDefault();
          e.stopPropagation();
          if (a.dataset.id) store().reveal(a.dataset.id);
          else if (a.dataset.tag) openTag(a.dataset.tag);
          else if (a.href) openExternal(a.href);
          return;
        }
        onClick?.(e);
      }}
    />
  );
});
