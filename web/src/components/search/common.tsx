// Gemeinsame Bausteine für Suche, Einsortieren, Zuordnen und Erfassen.

import { useEffect, useRef, useState } from 'react';
import { CheckSquare, FileText, Inbox, Square } from 'lucide-react';
import { api } from '../../lib/api';
import { plainText } from '../../lib/inline';
import { ancestors, store, typesOf, useStore } from '../../lib/store';
import type { Hit, Node, Types } from '../../lib/types';
import { Highlighted } from '../ui';

/** Titel als Klartext (so, wie ihn die Suche kennt). */
export function nodeTitle(n: Node | undefined): string {
  if (!n) return '';
  if (n.kind === 'root') return 'Notizbuch';
  return n.kind === 'item' ? plainText(n.text) : n.text;
}

/** Titel der Vorfahren (ohne Wurzel), in derselben Form wie der Suchindex. */
export function pathTitles(nodes: Record<string, Node>, id: string): string[] {
  return ancestors(nodes, id).map((a) => (a.kind === 'item' ? plainText(a.text) : a.text));
}

export function typeColor(n: Node, types: Types): string | undefined {
  const t = typesOf(n, types)[0];
  return t ? types[t].color ?? 'gray' : undefined;
}

/** Symbol eines Knotens: Seite, Inbox, Todo-Zustand, Typfarbe oder Punkt. */
export function NodeIcon({ n, inbox }: { n: Node; inbox?: string }) {
  const types = useStore((s) => s.types);
  if (n.kind === 'page' || n.kind === 'root') return n.id === inbox ? <Inbox size={15} /> : <FileText size={15} />;
  if (n.task) return n.task === 'done' || n.task === 'cancelled' ? <CheckSquare size={15} className="ni-done" /> : <Square size={15} />;
  const c = typeColor(n, types);
  return <span className="ni-dot" style={c ? { ['--type-color' as string]: `var(--t-${c})` } : undefined} />;
}

/** Pfad mit Hervorhebungen (`pathRanges` des Servers: Index, Start, Ende). */
export function PathLine({ parts, ranges }: { parts: string[]; ranges?: [number, number, number][] }) {
  if (!parts.length) return null;
  return (
    <span className="sp-path">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="sp-sep"> › </span>}
          <Highlighted text={p} ranges={ranges?.filter((r) => r[0] === i).map((r) => [r[1], r[2]] as [number, number])} />
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Zuletzt geöffnete Knoten
// ---------------------------------------------------------------------------

const RECENT = 'sqizzo-recent';

export function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushList(key: string, id: string, max = 30) {
  const list = [id, ...readList(key).filter((x) => x !== id)].slice(0, max);
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* Speicher gesperrt */
  }
}

export const pushRecent = (id: string) => pushList(RECENT, id);
export const readRecent = () => readList(RECENT);

let tracking = false;
/** Merkt sich geöffnete Seiten/Knoten (Navigation und `reveal`). */
export function trackRecent() {
  if (tracking) return;
  tracking = true;
  useStore.subscribe((s, p) => {
    if (s.route !== p.route && s.route.view === 'node' && s.route.id !== s.root) pushRecent(s.route.id);
    if (s.flash && s.flash !== p.flash) pushRecent(s.flash);
  });
}

/** Wartet, bis ein Knoten (z. B. nach dem Erfassen per Ereignis) im Store ist. */
export function waitForNode(id: string, timeout = 2000): Promise<boolean> {
  if (store().nodes[id]) return Promise.resolve(true);
  return new Promise((resolve) => {
    const unsub = useStore.subscribe((s) => {
      if (s.nodes[id]) {
        unsub();
        clearTimeout(t);
        resolve(true);
      }
    });
    const t = window.setTimeout(() => {
      unsub();
      resolve(false);
    }, timeout);
  });
}

// ---------------------------------------------------------------------------
// Fuzzy-Auswahl eines Ziels (Seite oder Knoten)
// ---------------------------------------------------------------------------

export interface Candidate {
  id: string;
  hit?: Hit;
}

/** Suchtreffer für eine Eingabe; leere Eingabe → `fallback()`. */
export function useCandidates(query: string, fallback: () => string[], limit = 40): { list: Candidate[]; loading: boolean } {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fb = useRef(fallback);
  fb.current = fallback;
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      api.search(q, limit, ac.signal).then(
        (r) => {
          setHits(r.hits);
          setLoading(false);
        },
        () => undefined,
      );
    }, 15);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [query, limit]);
  const list: Candidate[] = hits ? hits.map((h) => ({ id: h.id, hit: h })) : fb.current().map((id) => ({ id }));
  return { list, loading };
}

/** Alle Seiten, nach Pfad sortiert (Inbox zuerst). */
export function allPages(nodes: Record<string, Node>, inbox: string): string[] {
  return Object.values(nodes)
    .filter((n) => n.kind === 'page')
    .sort((a, b) => (a.id === inbox ? -1 : b.id === inbox ? 1 : (a.path ?? a.text).localeCompare(b.path ?? b.text, 'de', { numeric: true, sensitivity: 'base' })))
    .map((n) => n.id);
}

/** Dauerhaftes Wählen per Pfeiltasten in einer Liste. */
export function useListKeys(count: number, deps: unknown[] = []) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (active >= count) setActive(Math.max(0, count - 1));
  }, [count, active]);
  const onKey = (e: React.KeyboardEvent): boolean => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, count - 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
      return true;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 8, count - 1));
      return true;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 8, 0));
      return true;
    }
    return false;
  };
  return { active, setActive, onKey };
}
