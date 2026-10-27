// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Darstellung eines Knotentextes mit Tags, Links, Erwähnungen und Formatierung.

import { memo, type MouseEvent, type ReactNode } from 'react';
import { headingLevel, tokenize, type Segment } from '../lib/inline';
import { isPerson, linkLabel, resolveKey } from '../lib/links';
import { store, useStore } from '../lib/store';
import type { Node } from '../lib/types';

export function openTag(tag: string) {
  store().navigate({ view: 'tag', tag: tag.toLowerCase() });
}

export function openExternal(href: string) {
  window.open(href, '_blank', 'noopener');
}

/** Link-Segment: abonniert nur sein eigenes Ziel (Titel, Typ). */
function LinkSeg({ s, source }: { s: Extract<Segment, { t: 'link' }>; source: Node | undefined }) {
  const info = useStore((st) => {
    const id = resolveKey(st.nodes, source, s.key);
    const target = id ? st.nodes[id] : undefined;
    return `${id ?? ''}\u0000${linkLabel(st.nodes, id, s.alias, s.target)}\u0000${isPerson(target) ? 1 : 0}\u0000${target?.kind ?? ''}`;
  });
  const [id, label, person, kind] = info.split('\u0000');
  return (
    <a
      className={`wikilink${id ? '' : ' is-broken'}${person === '1' ? ' is-person' : ''}${kind === 'page' ? ' is-page' : ''}`}
      data-e={s.e}
      title={id ? undefined : `„${s.target}“ gibt es (noch) nicht`}
      onClick={(e) => {
        e.stopPropagation();
        if (id) store().reveal(id);
      }}
    >
      {person === '1' ? '@' : ''}
      {label}
    </a>
  );
}

function render(segs: Segment[], source: Node | undefined): ReactNode[] {
  return segs.map((s, i) => {
    switch (s.t) {
      case 'text':
        return (
          <span key={i} data-o={s.s}>
            {s.v}
          </span>
        );
      case 'code':
        return (
          <code key={i} className="rt-code" data-o={s.s + 1}>
            {s.v}
          </code>
        );
      case 'bold':
        return <strong key={i}>{render(s.children, source)}</strong>;
      case 'italic':
        return <em key={i}>{render(s.children, source)}</em>;
      case 'strike':
        return <s key={i}>{render(s.children, source)}</s>;
      case 'mark':
        return <mark key={i}>{render(s.children, source)}</mark>;
      case 'tag':
        return (
          <a
            key={i}
            className="tag"
            data-e={s.e}
            onClick={(e) => {
              e.stopPropagation();
              openTag(s.tag);
            }}
          >
            {s.raw}
          </a>
        );
      case 'link':
        return <LinkSeg key={i} s={s} source={source} />;
      case 'url':
        return (
          <a
            key={i}
            className="url"
            href={s.href}
            data-e={s.e}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openExternal(s.href);
            }}
          >
            {s.label}
          </a>
        );
    }
  });
}

/** Rendert einen einzeiligen Text; `source` liefert die Link-Auflösung des Servers. */
export const RichText = memo(function RichText({ text, source, stripHeading = true }: { text: string; source?: Node; stripHeading?: boolean }) {
  const body = stripHeading ? headingLevel(text)[1] : text;
  const segs = tokenize(body, text.length - body.length);
  return <>{render(segs, source)}</>;
});

/** Cursorposition im Originaltext für einen Klick in gerenderten Text. */
export function caretFromClick(e: MouseEvent, textLength: number): number {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!node) return textLength;
  const el = node.nodeType === 3 ? node.parentElement : (node as HTMLElement);
  const span = el?.closest('[data-o]') as HTMLElement | null;
  if (span) return Math.min(textLength, Number(span.dataset.o) + (sel?.anchorOffset ?? 0));
  const after = el?.closest('[data-e]') as HTMLElement | null;
  if (after) return Math.min(textLength, Number(after.dataset.e));
  void e;
  return textLength;
}
