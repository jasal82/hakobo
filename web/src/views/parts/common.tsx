// Gemeinsame Hilfen der Ansichten Agenda, Woche, Tags und Typen.

import { useEffect, useRef } from 'react';
import { plainText } from '../../lib/inline';
import { ancestors, typesOf, useStore } from '../../lib/store';
import type { Node, Types } from '../../lib/types';

/** Typfarbe eines Knotens als CSS-Wert (erster Typ mit Farbe). */
export function nodeColor(n: Node | undefined, types: Types): string | undefined {
  if (!n) return undefined;
  for (const t of typesOf(n, types)) {
    const c = types[t]?.color;
    if (c) return `var(--t-${c})`;
  }
  return undefined;
}

/** `14:00:00` → `14:00`. */
export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

export function minutesOf(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Titel eines Knotens für Pfadangaben. */
export function crumbTitle(n: Node): string {
  return n.kind === 'item' ? plainText(n.text, false) || 'Unbenannt' : n.text;
}

/** Pfad eines Knotens (optional erst ab einem Vorfahren). */
export function pathOf(nodes: Record<string, Node>, id: string, after?: string): string {
  let list = ancestors(nodes, id);
  if (after) {
    const i = list.findIndex((a) => a.id === after);
    if (i >= 0) list = list.slice(i + 1);
  }
  return list.map(crumbTitle).join(' › ');
}

/** Lädt neu, wenn sich Knoten ändern (entprellt) und wenn das Fenster den Fokus bekommt. */
export function useReloadOnChange(load: () => void, delay = 300) {
  const nodes = useStore((s) => s.nodes);
  const loadRef = useRef(load);
  loadRef.current = load;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => loadRef.current(), delay);
    return () => window.clearTimeout(t);
  }, [nodes, delay]);
  useEffect(() => {
    const onFocus = () => loadRef.current();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
}

/** Tags, die nicht schon im Text sichtbar sind (z. B. aus der Notiz). */
export function hiddenTags(n: Node | undefined, tags: string[]): string[] {
  if (!n) return tags;
  const text = n.text.toLowerCase();
  return tags.filter((t) => !text.includes(`#${t}`));
}
