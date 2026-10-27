// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Auflösen von Wiki-Links im Frontend (Server-Auflösung bevorzugt).

import { plainText } from './inline';
import type { Node } from './types';

let indexFor: Record<string, Node> | null = null;
let byTitle = new Map<string, Node[]>();
let byPath = new Map<string, Node>();

function index(nodes: Record<string, Node>) {
  if (indexFor === nodes) return;
  indexFor = nodes;
  byTitle = new Map();
  byPath = new Map();
  for (const n of Object.values(nodes)) {
    if (n.kind !== 'page') continue;
    const t = n.text.toLowerCase();
    const list = byTitle.get(t);
    if (list) list.push(n);
    else byTitle.set(t, [n]);
    if (n.path) byPath.set(n.path.toLowerCase(), n);
  }
}

export function findPage(nodes: Record<string, Node>, target: string): Node | undefined {
  index(nodes);
  const t = target.trim().replace(/\.md$/i, '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!t) return undefined;
  const direct = byPath.get(t);
  if (direct) return direct;
  if (t.includes('/')) {
    let best: Node | undefined;
    for (const [p, n] of byPath) if (p.endsWith('/' + t) && (!best || p.length < best.path!.length)) best = n;
    return best;
  }
  const list = byTitle.get(t);
  if (!list?.length) return undefined;
  return [...list].sort((a, b) => (a.path ?? '').split('/').length - (b.path ?? '').split('/').length || (a.path ?? '').localeCompare(b.path ?? ''))[0];
}

/** Ziel eines Links (`key` = `Ziel#Anker`). */
export function resolveKey(nodes: Record<string, Node>, source: Node | undefined, key: string): string | null {
  const fromServer = source?.links?.find((l) => l.key === key);
  if (fromServer?.id && nodes[fromServer.id]) return fromServer.id;
  const hash = key.indexOf('#');
  const target = hash >= 0 ? key.slice(0, hash) : key;
  const anchor = hash >= 0 ? key.slice(hash + 1) : null;
  if (anchor?.startsWith('^')) {
    const id = anchor.slice(1);
    if (nodes[id]) return id;
  }
  return findPage(nodes, target)?.id ?? null;
}

/** Anzeigetitel eines Knotens ohne Tags. */
export function displayTitle(n: Node | undefined): string {
  if (!n) return '';
  if (n.kind !== 'item') return n.text;
  return plainText(n.text, false) || plainText(n.text);
}

export function linkLabel(nodes: Record<string, Node>, id: string | null, alias: string | null, target: string): string {
  if (id && nodes[id]) {
    const n = nodes[id];
    if (n.kind === 'item') return displayTitle(n) || alias || target;
    return alias || n.text;
  }
  return alias || target;
}

export function isPerson(n: Node | undefined): boolean {
  return !!n?.tags.includes('person');
}

/** Linktext für einen Knoten (Seiten direkt, Knoten über den Server, der die ID festschreibt). */
export async function linkTextFor(nodes: Record<string, Node>, id: string, getLink: (id: string) => Promise<{ link: string }>): Promise<string> {
  const n = nodes[id];
  if (n?.kind === 'page') {
    const sameTitle = Object.values(nodes).filter((x) => x.kind === 'page' && x.text.toLowerCase() === n.text.toLowerCase()).length;
    return `[[${sameTitle > 1 && n.path ? n.path : n.text}]]`;
  }
  return (await getLink(id)).link;
}
