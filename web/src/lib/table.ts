// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Tabellen (wie in Workflowy): Ein Knoten mit `layout:: table` zeigt seine
// Kinder als Zeilen, die erste als Kopfzeile. Spalte 0 ist der Text einer
// Zeile, Spalte k ihr k-tes Kind. Alles bleibt eine normale Gliederung.

import { plainText } from './inline';
import { simulate } from './outline';
import { createOp, field, isTable, store, withField } from './store';
import type { Node, Op } from './types';

const S = () => store();

/** Einträge (ohne Unterseiten) eines Knotens. */
export function itemsOf(nodes: Record<string, Node>, id: string): string[] {
  return (nodes[id]?.children ?? []).filter((c) => nodes[c]?.kind === 'item');
}

/** Zeilen und Spaltenzahl (mindestens 1; Zeilen dürfen kürzer sein). */
export function tableShape(nodes: Record<string, Node>, table: string): { rows: string[]; cols: number } {
  const rows = itemsOf(nodes, table);
  const cols = Math.max(1, ...rows.map((r) => 1 + itemsOf(nodes, r).length));
  return { rows, cols };
}

/** Knoten der Zelle; `null`, wenn die Zeile so viele Spalten (noch) nicht hat. */
export function cellOf(nodes: Record<string, Node>, row: string, col: number): string | null {
  return col === 0 ? row : (itemsOf(nodes, row)[col - 1] ?? null);
}

/** Position einer Zelle in ihrer Tabelle (oder `null`, wenn der Knoten keine Zelle ist). */
export function cellPos(nodes: Record<string, Node>, id: string): { table: string; row: number; col: number } | null {
  const n = nodes[id];
  if (!n || n.kind !== 'item' || !n.parent) return null;
  const p = nodes[n.parent];
  if (isTable(p)) return { table: p.id, row: itemsOf(nodes, p.id).indexOf(id), col: 0 };
  const g = p?.parent ? nodes[p.parent] : undefined;
  if (p?.kind === 'item' && isTable(g)) return { table: g!.id, row: itemsOf(nodes, g!.id).indexOf(p.id), col: 1 + itemsOf(nodes, p.id).indexOf(id) };
  return null;
}

/** Fokus auf eine Zelle; fehlende Zellen (und Zeilen) werden leer angelegt. */
export function focusCell(table: string, row: number, col: number, caret: 'start' | 'end' = 'end') {
  const s = S();
  const rows = itemsOf(s.nodes, table);
  if (row < 0) return;
  let focus: string | null = null;
  const ops = simulate((get, push) => {
    let rowId = rows[row];
    for (let r = rows.length; r <= row; r++) {
      const op = createOp(table, r, '');
      push(op);
      rowId = op.id;
    }
    if (col === 0) {
      focus = rowId;
      return;
    }
    const cells = itemsOf(get(), rowId);
    focus = cells[col - 1] ?? null;
    for (let c = cells.length; c < col; c++) {
      const op = createOp(rowId, c, '');
      push(op);
      focus = op.id;
    }
  });
  if (!focus) return;
  if (ops.length) s.commit(ops, { focusAfter: { id: focus, caret } });
  else s.setFocus({ id: focus, caret });
}

// ---------------------------------------------------------------------------
// Umwandeln
// ---------------------------------------------------------------------------

/** Liste ↔ Tabelle. Neue Tabellen bekommen eine leere Kopfzeile in voller Breite. */
export function toggleTable(id: string) {
  const s = S();
  const n = s.nodes[id];
  if (!n || n.kind === 'root') return;
  if (isTable(n)) {
    s.commit([{ op: 'update', id, fields: withField(n.fields, 'layout', null) }]);
    s.toast('Wieder als Liste', 'info');
    return;
  }
  const { rows, cols } = tableShape(s.nodes, id);
  const ops: Op[] = [{ op: 'update', id, fields: withField(n.fields, 'layout', 'table') }];
  const width = Math.max(cols, 2);
  const head = createOp(id, 0, '');
  ops.push(head);
  for (let c = 1; c < width; c++) ops.push(createOp(head.id, c - 1, ''));
  // Ohne Inhalt: gleich eine leere Zeile zum Losschreiben.
  if (!rows.length) {
    const row = createOp(id, 1, '');
    ops.push(row, createOp(row.id, 0, ''));
  }
  s.commit(ops, { focusAfter: { id: head.id, caret: 'end' } });
  if (n.kind === 'item') s.setCollapsed(id, false);
}

// ---------------------------------------------------------------------------
// Zeilen
// ---------------------------------------------------------------------------

/** Neue Zeile nach der Zeile `row` (Index), Fokus in ihre erste Zelle. */
export function insertRow(table: string, at: number) {
  const s = S();
  const op = createOp(table, Math.max(1, at), '');
  s.commit([op], { focusAfter: { id: op.id, caret: 'end' } });
}

export function deleteRow(table: string, row: number) {
  const s = S();
  const rows = itemsOf(s.nodes, table);
  const id = rows[row];
  if (!id) return;
  const next = rows[row + 1] ?? rows[row - 1] ?? table;
  s.commit([{ op: 'delete', id }], { focusAfter: { id: next, caret: 'end' } });
}

/** Zeile nach oben/unten; die Kopfzeile bleibt oben. */
export function moveRow(table: string, row: number, dir: -1 | 1, focus?: string) {
  const s = S();
  const rows = itemsOf(s.nodes, table);
  const target = row + dir;
  if (row < 1 || target < 1 || target >= rows.length) return;
  s.commit([{ op: 'move', id: rows[row], parent: table, index: target }], { focusAfter: focus ? { id: focus, caret: 'end' } : null });
}

// ---------------------------------------------------------------------------
// Spalten (Spalte 0 ist der Zeilentext und bleibt fest)
// ---------------------------------------------------------------------------

/** Feld mit den Spaltenbreiten in px, `0` = automatisch: `col-widths:: 180,0,240`. */
export const WIDTHS = 'col-widths';

export function parseWidths(v: string | undefined): number[] {
  return v ? v.split(',').map((x) => Math.max(0, Math.round(Number(x.trim()) || 0))) : [];
}

export function widthsOf(n: Node | undefined): number[] {
  return parseWidths(field(n, WIDTHS));
}

/** Änderung der Breiten als Operation (oder nichts, wenn gleich). */
function widthsOp(nodes: Record<string, Node>, table: string, widths: number[]): Op | null {
  const n = nodes[table];
  if (!n) return null;
  const list = widths.map((w) => w || 0);
  while (list.length && !list[list.length - 1]) list.pop();
  const value = list.length ? list.join(',') : null;
  if ((field(n, WIDTHS) ?? null) === value) return null;
  return { op: 'update', id: table, fields: withField(n.fields, WIDTHS, value) };
}

/** Breite einer Spalte setzen (`null`: wieder automatisch). */
export function setColumnWidth(table: string, col: number, width: number | null) {
  const s = S();
  const w = widthsOf(s.nodes[table]);
  while (w.length <= col) w.push(0);
  w[col] = width ? Math.round(width) : 0;
  const op = widthsOp(s.nodes, table, w);
  if (op) s.commit([op], { focusAfter: null });
}

/** Leere Spalte an Position `col` (≥ 1) in jeder Zeile. */
export function insertColumn(table: string, col: number) {
  const s = S();
  if (col < 1) return;
  const rows = itemsOf(s.nodes, table);
  const ops: Op[] = [];
  let focus: string | null = null;
  for (const [i, r] of rows.entries()) {
    const cells = itemsOf(s.nodes, r);
    // Kürzere Zeilen bekommen die Lücke bis zur neuen Spalte nicht: dort zählt die Position.
    if (cells.length < col - 1) continue;
    const op = createOp(r, col - 1, '');
    ops.push(op);
    if (i === 0) focus = op.id;
  }
  const w = widthsOf(s.nodes[table]);
  if (w.length > col) w.splice(col, 0, 0);
  const wop = widthsOp(s.nodes, table, w);
  if (wop) ops.push(wop);
  if (ops.length) s.commit(ops, { focusAfter: focus ? { id: focus, caret: 'end' } : null });
}

export function deleteColumn(table: string, col: number) {
  const s = S();
  if (col < 1) return;
  const ops: Op[] = [];
  for (const r of itemsOf(s.nodes, table)) {
    const cell = itemsOf(s.nodes, r)[col - 1];
    if (cell) ops.push({ op: 'delete', id: cell });
  }
  const w = widthsOf(s.nodes[table]);
  w.splice(col, 1);
  const wop = widthsOp(s.nodes, table, w);
  if (wop) ops.push(wop);
  if (ops.length) {
    s.commit(ops, { focusAfter: { id: itemsOf(s.nodes, table)[0] ?? table, caret: 'end' } });
    s.toast('Spalte gelöscht', 'info', { label: 'Rückgängig', run: () => S().undo() });
  }
}

/** Spalte `from` an die Stelle `to` (beide ≥ 1); die Breite wandert mit. */
export function moveColumnTo(table: string, from: number, to: number, focusRow = 0) {
  const s = S();
  if (from < 1 || to < 1 || from === to) return;
  let focus: string | null = null;
  const ops = simulate((get, push) => {
    for (const [i, r] of itemsOf(get(), table).entries()) {
      if (itemsOf(get(), r).length < from) continue; // Zelle gibt es hier nicht
      // Bis zur Zielspalte auffüllen, damit die Position stimmt
      for (let c = itemsOf(get(), r).length; c < to; c++) push(createOp(r, c, ''));
      const id = itemsOf(get(), r)[from - 1];
      push({ op: 'move', id, parent: r, index: to - 1 });
      if (i === focusRow) focus = id;
    }
    const w = widthsOf(get()[table]);
    while (w.length <= Math.max(from, to)) w.push(0);
    const [moved] = w.splice(from, 1);
    w.splice(to, 0, moved);
    const wop = widthsOp(get(), table, w);
    if (wop) push(wop);
  });
  if (ops.length) s.commit(ops, { focusAfter: focus ? { id: focus, caret: 'end' } : null });
}

/** Spalte `col` um eine Stelle nach links/rechts. */
export function moveColumn(table: string, col: number, dir: -1 | 1, focusRow = 0) {
  moveColumnTo(table, col, col + dir, focusRow);
}

/** Kopie eines Knotens samt Kindern (neue IDs). */
function cloneInto(nodes: Record<string, Node>, id: string, parent: string, index: number, push: (op: Op) => void, withChildren = true): string | null {
  const n = nodes[id];
  if (!n) return null;
  const op = createOp(parent, index, n.text, { body: n.body, fields: n.fields, task: n.task ?? null });
  push(op);
  if (withChildren) itemsOf(nodes, id).forEach((c, i) => cloneInto(nodes, c, op.id, i, push));
  return op.id;
}

/** Spalte `col` rechts daneben kopieren (aus Spalte 0 nur der Text der Zeilen). */
export function duplicateColumn(table: string, col: number, focusRow = 0) {
  const s = S();
  let focus: string | null = null;
  const ops = simulate((get, push) => {
    for (const [i, r] of itemsOf(get(), table).entries()) {
      const src = cellOf(get(), r, col);
      if (!src) continue;
      // Die Zeile selbst ohne ihre Zellen kopieren, sonst die Zelle samt Inhalt
      const id = cloneInto(get(), src, r, col, push, col > 0);
      if (i === focusRow) focus = id;
    }
    const w = widthsOf(get()[table]);
    if (w.length > col) w.splice(col + 1, 0, w[col]);
    const wop = widthsOp(get(), table, w);
    if (wop) push(wop);
  });
  if (ops.length) s.commit(ops, { focusAfter: focus ? { id: focus, caret: 'end' } : null });
}

/** Zeile samt Zellen darunter kopieren. */
export function duplicateRow(table: string, row: number) {
  const s = S();
  const id = itemsOf(s.nodes, table)[row];
  if (!id) return;
  let copy: string | null = null;
  const ops = simulate((get, push) => {
    copy = cloneInto(get(), id, table, row + 1, push);
  });
  if (ops.length) s.commit(ops, { focusAfter: copy ? { id: copy, caret: 'end' } : null });
}

/** Zwei Zellen (Spalten ≥ 1) tauschen; fehlende werden leer angelegt, so wird Tauschen mit einer Lücke zum Verschieben. */
export function swapCells(table: string, a: { row: number; col: number }, b: { row: number; col: number }) {
  const s = S();
  if (a.col < 1 || b.col < 1 || (a.row === b.row && a.col === b.col)) return;
  let moved: string | null = null;
  const ops = simulate((get, push) => {
    const rows = itemsOf(get(), table);
    const ra = rows[a.row];
    const rb = rows[b.row];
    if (!ra || !rb) return;
    const pad = (r: string, col: number) => {
      for (let c = itemsOf(get(), r).length; c < col; c++) push(createOp(r, c, ''));
    };
    pad(ra, a.col);
    pad(rb, b.col);
    const A = itemsOf(get(), ra)[a.col - 1];
    const B = itemsOf(get(), rb)[b.col - 1];
    // Erst A an die Stelle von B, dann B an die alte Stelle von A
    push({ op: 'move', id: A, parent: rb, index: b.col - 1 });
    push({ op: 'move', id: B, parent: ra, index: a.col - 1 });
    moved = A;
  });
  if (ops.length) s.commit(ops, { focusAfter: moved ? { id: moved, caret: 'end' } : null });
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Zeilen (ohne Kopfzeile) nach Spalte `col` sortieren, leere zuletzt. */
export function sortByColumn(table: string, col: number, dir: 1 | -1) {
  const s = S();
  const nodes = s.nodes;
  const [head, ...rows] = itemsOf(nodes, table);
  if (!head || rows.length < 2) return;
  const key = (r: string) => {
    const c = cellOf(nodes, r, col);
    return c ? plainText(nodes[c]?.text ?? '', false).trim() : '';
  };
  const sorted = [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (!ka !== !kb) return ka ? -1 : 1;
    return collator.compare(ka, kb) * dir;
  });
  if (sorted.every((r, i) => r === rows[i])) return;
  const ops = simulate((_get, push) => {
    sorted.forEach((r, i) => push({ op: 'move', id: r, parent: table, index: i + 1 }));
  });
  s.commit(ops, { focusAfter: null });
}

// ---------------------------------------------------------------------------
// Einfügen aus Tabellenkalkulation, TSV oder Markdown
// ---------------------------------------------------------------------------

/** Zeilen und Zellen aus eingefügtem Text; `null`, wenn es keine Tabelle ist. */
export function parseGrid(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.some((l) => l.includes('\t'))) return lines.map((l) => l.split('\t').map((c) => c.trim()));
  const md = lines.filter((l) => l.trim());
  if (md.length >= 2 && md.every((l) => /^\s*\|.*\|\s*$/.test(l))) {
    return md
      .filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)) // Trennzeile |---|---|
      .map((l) =>
        l
          .trim()
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim()),
      );
  }
  return null;
}

/** Füllt die Tabelle ab Zeile `row`, Spalte `col`; fehlende Zeilen und Zellen entstehen dabei. */
export function pasteGrid(table: string, row: number, col: number, grid: string[][]) {
  const s = S();
  let last: string | null = null;
  const ops = simulate((get, push) => {
    grid.forEach((values, i) => {
      const rows = itemsOf(get(), table);
      let rowId = rows[row + i];
      if (!rowId) {
        const op = createOp(table, rows.length, '');
        push(op);
        rowId = op.id;
      }
      values.forEach((v, j) => {
        const c = col + j;
        if (c === 0) {
          push({ op: 'update', id: rowId, text: v });
          last = rowId;
          return;
        }
        const cells = itemsOf(get(), rowId);
        for (let k = cells.length; k < c - 1; k++) push(createOp(rowId, k, ''));
        const existing = itemsOf(get(), rowId)[c - 1];
        if (existing) {
          push({ op: 'update', id: existing, text: v });
          last = existing;
        } else {
          const op = createOp(rowId, c - 1, v);
          push(op);
          last = op.id;
        }
      });
    });
  });
  if (ops.length) s.commit(ops, { focusAfter: last ? { id: last, caret: 'end' } : null });
}

// ---------------------------------------------------------------------------
// Export (wie in Workflowy: Markdown, TSV, HTML)
// ---------------------------------------------------------------------------

export type ExportFormat = 'markdown' | 'tsv' | 'html';

/** Zellen als Raster (fehlende: `undefined`), erste Zeile = Kopfzeile. */
function cellGrid(nodes: Record<string, Node>, table: string): (Node | undefined)[][] {
  const { rows, cols } = tableShape(nodes, table);
  return rows.map((r) => Array.from({ length: cols }, (_, c) => {
    const id = cellOf(nodes, r, c);
    return id ? nodes[id] : undefined;
  }));
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Text einer Tabelle im gewünschten Format. Markdown behält Formatierung und Links, TSV und HTML zeigen lesbaren Text. */
export function exportTable(table: string, format: ExportFormat): string {
  const nodes = S().nodes;
  const grid = cellGrid(nodes, table);
  const box = (n: Node | undefined) => (n?.task ? (n.task === 'done' ? '[x] ' : '[ ] ') : '');
  const plain = (n: Node | undefined) => (n ? box(n) + plainText(n.text, false) : '');
  if (format === 'tsv') return grid.map((r) => r.map((n) => plain(n).replace(/[\t\n]/g, ' ')).join('\t')).join('\n') + '\n';
  if (format === 'markdown') {
    const line = (r: (Node | undefined)[]) => `| ${r.map((n) => (n ? box(n) + n.text : '').replace(/\|/g, '\\|').trim()).join(' | ')} |`;
    const [head, ...body] = grid;
    if (!head) return '';
    return [line(head), `| ${head.map(() => '---').join(' | ')} |`, ...body.map(line)].join('\n') + '\n';
  }
  const [head, ...body] = grid;
  const cells = (r: (Node | undefined)[], tag: 'th' | 'td') => r.map((n) => `<${tag}>${escapeHtml(plain(n))}</${tag}>`).join('');
  return `<table>\n<thead><tr>${head ? cells(head, 'th') : ''}</tr></thead>\n<tbody>\n${body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('\n')}\n</tbody>\n</table>\n`;
}

/** In die Zwischenablage; HTML zusätzlich als formatierte Tabelle (für Word, Mail, Tabellenkalkulation). */
export async function copyTable(table: string, format: ExportFormat) {
  const text = exportTable(table, format);
  const label = { markdown: 'Markdown', tsv: 'TSV', html: 'HTML' }[format];
  try {
    if (format === 'html' && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([text], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    S().toast(`Tabelle als ${label} kopiert`, 'success');
  } catch {
    S().toast('Kopieren nicht möglich', 'error');
  }
}
