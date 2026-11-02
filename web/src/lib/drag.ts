// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Ziehen und Ablegen von Knoten: in der Gliederung (auch mehrere ausgewählte)
// und im Seitenbaum der Seitenleiste.

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { moveBeside, moveInto, topLevel } from './outline';
import { isAncestor, store } from './store';

export type DropPos = 'before' | 'after' | 'into';

/** Knoten, die gerade gezogen werden (leer: kein Ziehen aus der App). */
let dragged: string[] = [];

/**
 * Nur innerhalb dieses Knotens ablegen (Zeilen einer Tabelle bleiben in ihrer Tabelle).
 * Gilt bis zum nächsten `startDrag`, damit `canDrop` auch nach `endDrag` beim Ablegen stimmt.
 */
let within: string | null = null;

/** Datentyp für Ziehen, das die App nicht verlassen soll (kein Text für Editoren oder andere Programme). */
export const INTERNAL = 'application/x-hakobo';

export function draggedIds(): string[] {
  return dragged;
}

/** Zieh-Bild mit einem kurzen Text („3 Einträge“) statt des gezogenen Elements. */
export function dragGhost(e: DragEvent, text: string) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = text;
  document.body.append(ghost);
  e.dataTransfer.setDragImage(ghost, -12, -8);
  window.setTimeout(() => ghost.remove(), 0);
}

/**
 * Beginnt das Ziehen; bei mehreren Knoten mit einem Zähler statt der Zeile als Bild.
 * `within`: nur zwischen die Kinder dieses Knotens (z. B. Zeilen einer Tabelle), ohne Text.
 * `noun`: Wort für den Zähler (sonst „Einträge“ bzw. „Seiten“).
 */
export function startDrag(e: DragEvent, ids: string[], opts: { within?: string; noun?: string } = {}) {
  dragged = topLevel(ids);
  within = opts.within ?? null;
  const nodes = store().nodes;
  e.dataTransfer.effectAllowed = 'move';
  if (within) e.dataTransfer.setData(INTERNAL, within);
  else e.dataTransfer.setData('text/plain', dragged.map((id) => nodes[id]?.text ?? '').join('\n'));
  if (dragged.length > 1) {
    const noun = opts.noun ?? (dragged.every((id) => nodes[id]?.kind === 'page') ? 'Seiten' : 'Einträge');
    dragGhost(e, `${dragged.length} ${noun}`);
  }
}

export function endDrag() {
  dragged = [];
}

/** Vor, hinter oder in eine Zeile – nach der Höhe des Mauszeigers. */
export function dropPosition(e: DragEvent, el: HTMLElement): DropPos {
  const r = el.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (y < 0.3) return 'before';
  if (y > 0.7) return 'after';
  return 'into';
}

/**
 * Dürfen alle `ids` an dieser Stelle liegen? Seiten nur unter Seiten (Reihenfolge dort
 * alphabetisch, also nur „in“), Einträge nicht in der obersten Ebene.
 */
export function canDrop(ids: string[], target: string, pos: DropPos): boolean {
  const { nodes, inbox } = store();
  const t = nodes[target];
  if (!t || !ids.length) return false;
  // Gebunden (Tabellenzeile): nur vor oder hinter ein Geschwister im selben Knoten.
  if (within && (pos === 'into' || t.parent !== within)) return false;
  const parent = pos === 'into' ? t : nodes[t.parent ?? ''];
  if (!parent) return false;
  return ids.every((id) => {
    const d = nodes[id];
    if (!d || id === target || isAncestor(nodes, id, target)) return false;
    // Seiten nicht in die Inbox: deren Unterseiten zeigt die Seitenleiste nicht.
    if (d.kind === 'page') return id !== inbox && pos === 'into' && parent.kind !== 'item' && parent.id !== inbox && d.parent !== parent.id;
    return d.kind === 'item' && parent.kind !== 'root';
  });
}

/** Legt ab. `quiet`: ohne Meldung (Ziel bleibt sichtbar). */
export function dropOn(ids: string[], target: string, pos: DropPos, { quiet = false }: { quiet?: boolean } = {}) {
  const s = store();
  if (pos === 'into') {
    moveInto(ids, target, { quiet });
    if (s.nodes[target]?.kind === 'item') s.setCollapsed(target, false);
  } else {
    moveBeside(ids, target, pos);
  }
}

/**
 * Ablageziel, das Knoten nur „in“ `target` annimmt (Seitenleiste): `over` für die Markierung,
 * `props` für das Element. `onHover` läuft nach kurzem Verweilen (z. B. Zweig aufklappen).
 */
export function useIntoTarget(target: string, onHover?: () => void) {
  const [over, setOver] = useState(false);
  const timer = useRef(0);
  const hover = useRef(onHover);
  hover.current = onHover;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const clear = () => window.clearTimeout(timer.current);
  const props = {
    onDragEnter: (e: DragEvent) => {
      if (!canDrop(dragged, target, 'into')) return;
      e.preventDefault();
      clear();
      if (hover.current) timer.current = window.setTimeout(() => hover.current?.(), 600);
    },
    onDragOver: (e: DragEvent) => {
      if (!canDrop(dragged, target, 'into')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      clear();
      setOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      clear();
      setOver(false);
      const ids = dragged;
      endDrag();
      if (canDrop(ids, target, 'into')) dropOn(ids, target, 'into');
    },
  };
  return { over, props };
}
