// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Auswahl per Ziehen mit der Maus: Innerhalb eines Eintrags markiert der Browser
// bzw. der Editor Text; sobald der Mauszeiger einen anderen Eintrag erreicht,
// werden stattdessen die Einträge dazwischen ausgewählt. Aus dem leeren Bereich
// neben oder unter der Gliederung wählt Ziehen alle überstrichenen Einträge.

import type { MouseEvent as ReactMouseEvent } from 'react';
import { clearSelection, selectRange } from '../../lib/outline';

/**
 * Hier beginnt kein Auswahl-Ziehen: Knöpfe, Links, alles zum Verschieben (Aufzählungspunkt,
 * `draggable`), Kopf der Seite … und Tabellen: Dort gehört die Maus dem Text, den Griffen
 * für Zeilen, Spalten und Zellen und dem Spaltenrand.
 */
const IGNORE =
  'button, a, input, textarea, select, label, [role="button"], [draggable="true"], .chip, .cm-chip, .bullet, .taskbox, .row-actions, .code-head, .zoom-head, .crumbs, .backlinks, .inbox-hint, .outline-add, .outline-empty, .row-line.is-selected, .ot-wrap, .popover, .dialog';

/** Rand (px), ab dem beim Ziehen gerollt wird. */
const EDGE = 36;

interface Line {
  id: string;
  top: number;
  bottom: number;
}

export function startDragSelect(e: ReactMouseEvent, root: string, view: HTMLElement) {
  if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (target.closest(IGNORE)) return;
  const outline = view.querySelector<HTMLElement>('.outline');
  if (!outline) return;
  // In der Gliederung oder im leeren Hintergrund der Ansicht
  const inOutline = outline.contains(target);
  if (!inOutline && !target.matches('.view, .view-inner')) return;
  const startRow = inOutline ? (target.closest<HTMLElement>('.row')?.dataset.id ?? null) : null;
  const scroller = view.closest<HTMLElement>('.main') ?? view;
  const scroll0 = scroller.scrollTop;
  const y0 = e.clientY;
  let y = y0;
  let active = false;
  let rolling = 0;

  const lines = (): Line[] =>
    [...outline.querySelectorAll<HTMLElement>('.row-line')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.closest<HTMLElement>('.row')?.dataset.id ?? '', top: r.top, bottom: r.bottom };
    });
  /** Eintrag auf Höhe `at`: der letzte, der darüber beginnt (Notizen gehören zum Eintrag). */
  const rowAt = (ls: Line[], at: number) => {
    let id = ls[0]?.id ?? '';
    for (const l of ls) {
      if (l.top > at) break;
      id = l.id;
    }
    return id;
  };

  const update = () => {
    select();
    // Am Rand weiterrollen, auch wenn die Maus dort stillsteht.
    if (active && !rolling) roll();
  };

  /** Bereich nur setzen, wenn er sich ändert (spart Neuzeichnen bei jeder Mausbewegung). */
  let range = '';
  const setRange = (a: string | null, b: string | null) => {
    const key = `${a}|${b}`;
    if (key === range) return;
    range = key;
    if (a && b) selectRange(root, a, b);
    else clearSelection();
  };

  const select = () => {
    const ls = lines();
    if (!ls.length) return;
    // Startpunkt mitrollen, damit die Auswahl beim automatischen Rollen stimmt.
    const start = y0 - (scroller.scrollTop - scroll0);
    if (startRow) {
      const here = rowAt(ls, y);
      if (!active && here === startRow) return;
      activate();
      setRange(startRow, here);
      return;
    }
    if (!active && Math.abs(y - y0) < 6) return;
    activate();
    const lo = Math.min(start, y);
    const hi = Math.max(start, y);
    const hit = ls.filter((l) => l.bottom > lo && l.top < hi);
    setRange(hit[0]?.id ?? null, hit[hit.length - 1]?.id ?? null);
  };

  const activate = () => {
    if (active) return;
    active = true;
    window.getSelection()?.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.classList.add('is-drag-selecting');
  };

  /** Am oberen oder unteren Rand weiterrollen, solange die Maustaste gedrückt bleibt. */
  const roll = () => {
    rolling = 0;
    if (!active) return;
    const r = scroller.getBoundingClientRect();
    const d = y < r.top + EDGE ? -1 : y > r.bottom - EDGE ? 1 : 0;
    if (!d) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += d * 14;
    if (scroller.scrollTop === before) return;
    select();
    rolling = window.setTimeout(roll, 16);
  };

  const move = (ev: MouseEvent) => {
    // Taste schon losgelassen, ohne dass ein mouseup kam (z. B. außerhalb des Fensters): beenden.
    if (ev.buttons === 0) {
      finish(false);
      return;
    }
    y = ev.clientY;
    if (active) {
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
    update();
  };

  /** Aufräumen; `swallowClick`: den Klick nach dem Loslassen nicht als Klick auf einen Eintrag werten. */
  const finish = (swallowClick: boolean) => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', up, true);
    window.removeEventListener('dragstart', stop, true);
    window.removeEventListener('blur', stop);
    window.clearTimeout(rolling);
    if (!active) return;
    document.body.classList.remove('is-drag-selecting');
    if (!swallowClick) return;
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', swallow, true);
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };
  const up = () => finish(true);
  // Beginnt stattdessen echtes Ziehen (Verschieben), meldet der Browser kein mouseup mehr.
  const stop = () => finish(false);

  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', up, true);
  window.addEventListener('dragstart', stop, true);
  window.addEventListener('blur', stop);
}
