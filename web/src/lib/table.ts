// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Tabellen (wie in Workflowy): Ein Knoten mit `layout:: table` zeigt seine
// Kinder als Zeilen, die erste als Kopfzeile. Spalte 0 ist der Text einer
// Zeile, Spalte k ihr k-tes Kind. Alles bleibt eine normale Gliederung.

import { compareText, L } from '../i18n';
import { plainText } from './inline';
import { clearSelection, simulate } from './outline';
import { createOp, field, isTable, store, withField, type CellSel } from './store';
import type { Node, Op, Task } from './types';

const S = () => store();

/** Zelle: Zeile (0 = Kopfzeile) und Spalte (0 = Text der Zeile). */
export interface Addr {
  row: number;
  col: number;
}

/** Rechteckiger Zellbereich (Grenzen einschließlich). */
export interface CellRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

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

/** Knoten der Zelle; fehlende Zellen (und Zeilen) werden leer angelegt. */
export function ensureCell(table: string, row: number, col: number): string | null {
  const s = S();
  const existing = itemsOf(s.nodes, table)[row];
  const id = existing ? cellOf(s.nodes, existing, col) : null;
  if (id) return id;
  let created: string | null = null;
  const ops = simulate((get, push) => {
    let rowId = itemsOf(get(), table)[row];
    for (let r = itemsOf(get(), table).length; r <= row; r++) {
      const op = createOp(table, r, '');
      push(op);
      rowId = op.id;
    }
    if (col === 0) {
      created = rowId;
      return;
    }
    for (let c = itemsOf(get(), rowId).length; c < col; c++) {
      const op = createOp(rowId, c, '');
      push(op);
      created = op.id;
    }
  });
  if (ops.length) s.commit(ops, { focusAfter: null });
  return created;
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
    s.toast(L.table.backToList, 'info');
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

/** Zeilen `r0` bis `r1` löschen. */
export function deleteRows(table: string, r0: number, r1: number) {
  const s = S();
  const rows = itemsOf(s.nodes, table);
  const ids = rows.slice(Math.max(0, r0), r1 + 1);
  if (!ids.length) return;
  const next = rows[r1 + 1] ?? rows[r0 - 1] ?? table;
  s.commit(
    ids.map((id) => ({ op: 'delete', id }) as Op),
    { focusAfter: { id: next, caret: 'end' } },
  );
  if (ids.length > 1) s.toast(L.table.rowsDeleted(ids.length), 'info', { label: L.common.undo, run: () => S().undo() });
}

export function deleteRow(table: string, row: number) {
  deleteRows(table, row, row);
}

/** Zeilen `r0`–`r1` gemeinsam um eine Stelle nach oben/unten; die Kopfzeile bleibt oben. `false`: geht nicht. */
export function moveRows(table: string, r0: number, r1: number, dir: -1 | 1, focus?: string): boolean {
  const s = S();
  const rows = itemsOf(s.nodes, table);
  if (r0 < 1 || r1 >= rows.length || (dir < 0 ? r0 <= 1 : r1 >= rows.length - 1)) return false;
  // Statt des Blocks wandert die Nachbarzeile auf seine andere Seite.
  const op: Op = dir < 0 ? { op: 'move', id: rows[r0 - 1], parent: table, index: r1 } : { op: 'move', id: rows[r1 + 1], parent: table, index: r0 };
  s.commit([op], { focusAfter: focus ? { id: focus, caret: 'end' } : null });
  return true;
}

/** Zeile nach oben/unten; die Kopfzeile bleibt oben. */
export function moveRow(table: string, row: number, dir: -1 | 1, focus?: string) {
  moveRows(table, row, row, dir, focus);
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

/** Spalten `c0` bis `c1` (≥ 1) löschen. */
export function deleteColumns(table: string, c0: number, c1: number) {
  const s = S();
  if (c0 < 1 || c1 < c0) return;
  const ops: Op[] = [];
  for (const r of itemsOf(s.nodes, table)) {
    for (const cell of itemsOf(s.nodes, r).slice(c0 - 1, c1)) ops.push({ op: 'delete', id: cell });
  }
  const w = widthsOf(s.nodes[table]);
  w.splice(c0, c1 - c0 + 1);
  const wop = widthsOp(s.nodes, table, w);
  if (wop) ops.push(wop);
  if (ops.length) {
    const n = c1 - c0 + 1;
    s.commit(ops, { focusAfter: { id: itemsOf(s.nodes, table)[0] ?? table, caret: 'end' } });
    s.toast(L.table.columnsDeleted(n), 'info', { label: L.common.undo, run: () => S().undo() });
  }
}

export function deleteColumn(table: string, col: number) {
  deleteColumns(table, col, col);
}

/**
 * Spalten `from` … `from+n-1` (≥ 1) an die Grenze vor Spalte `edge` (alte Zählung) verschieben;
 * die Breiten wandern mit. Fokus danach auf die erste verschobene Zelle in Zeile `focusRow`
 * (`-1`: kein Fokus). Liefert die neue erste Spalte, `null`, wenn sich nichts ändert.
 */
export function moveColumns(table: string, from: number, n: number, edge: number, focusRow = 0): number | null {
  const s = S();
  if (from < 1 || n < 1 || edge < 1 || (edge >= from && edge <= from + n)) return null;
  const right = edge > from;
  const to = right ? edge - n : edge;
  // Betroffen sind die Spalten zwischen Ziel und Block; kürzere Zeilen werden bis dahin aufgefüllt.
  const lo = Math.min(from, edge);
  const hi = Math.max(from + n - 1, edge - 1);
  let focus: string | null = null;
  const ops = simulate((get, push) => {
    for (const [i, r] of itemsOf(get(), table).entries()) {
      if (itemsOf(get(), r).length < lo) continue; // in dieser Zeile ist der ganze Bereich leer
      for (let c = itemsOf(get(), r).length; c < hi; c++) push(createOp(r, c, ''));
      const block = itemsOf(get(), r).slice(from - 1, from - 1 + n);
      // Nach rechts: jede Zelle an die Zielgrenze (die vorige rückt nach links); nach links: der Reihe nach ab dem Ziel.
      block.forEach((id, k) => push({ op: 'move', id, parent: r, index: right ? edge - 2 : edge - 1 + k }));
      if (i === focusRow) focus = block[0] ?? null;
    }
    const w = widthsOf(get()[table]);
    while (w.length <= hi) w.push(0);
    const moved = w.splice(from, n);
    w.splice(to, 0, ...moved);
    const wop = widthsOp(get(), table, w);
    if (wop) push(wop);
  });
  if (!ops.length) return null;
  s.commit(ops, { focusAfter: focus ? { id: focus, caret: 'end' } : null });
  return to;
}

/** Spalte `col` um eine Stelle nach links/rechts. */
export function moveColumn(table: string, col: number, dir: -1 | 1, focusRow = 0) {
  moveColumns(table, col, 1, dir < 0 ? col - 1 : col + 2, focusRow);
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

/** Zeilen `r0`–`r1` samt Zellen darunter kopieren (die Kopfzeile nicht). */
export function duplicateRows(table: string, r0: number, r1: number) {
  const s = S();
  const ids = itemsOf(s.nodes, table).slice(Math.max(1, r0), r1 + 1);
  if (!ids.length) return;
  let first: string | null = null;
  const ops = simulate((get, push) => {
    ids.forEach((id, i) => {
      const copy = cloneInto(get(), id, table, r1 + 1 + i, push);
      if (i === 0) first = copy;
    });
  });
  if (ops.length) s.commit(ops, { focusAfter: first ? { id: first, caret: 'end' } : null });
}

export function duplicateRow(table: string, row: number) {
  duplicateRows(table, row, row);
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
    return compareText(ka, kb) * dir;
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

/** Eingefügter Zellinhalt: Text, aus Hakobo kopiert auch mit Todo-Status. */
export type GridCell = string | { text: string; task?: Task | null };

/**
 * Füllt die Tabelle ab Zeile `row`, Spalte `col`; fehlende Zeilen und Zellen entstehen dabei.
 * Danach steht der Fokus in der letzten Zelle oder (`select`) der eingefügte Bereich ist ausgewählt.
 */
export function pasteGrid(table: string, row: number, col: number, grid: GridCell[][], { select = false }: { select?: boolean } = {}) {
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
      values.forEach((cell, j) => {
        const v = typeof cell === 'string' ? { text: cell } : cell;
        const task = v.task !== undefined ? { task: v.task } : {};
        const c = col + j;
        if (c === 0) {
          push({ op: 'update', id: rowId, text: v.text, ...task });
          last = rowId;
          return;
        }
        const cells = itemsOf(get(), rowId);
        for (let k = cells.length; k < c - 1; k++) push(createOp(rowId, k, ''));
        const existing = itemsOf(get(), rowId)[c - 1];
        if (existing) {
          push({ op: 'update', id: existing, text: v.text, ...task });
          last = existing;
        } else {
          const op = createOp(rowId, c - 1, v.text, task);
          push(op);
          last = op.id;
        }
      });
    });
  });
  if (!ops.length) return;
  if (!select) {
    s.commit(ops, { focusAfter: last ? { id: last, caret: 'end' } : null });
    return;
  }
  s.commit(ops, { focusAfter: null });
  const width = Math.max(1, ...grid.map((r) => r.length));
  selectCells(table, { row, col }, { row: row + grid.length - 1, col: col + width - 1 });
}

// ---------------------------------------------------------------------------
// Export (wie in Workflowy: Markdown, TSV, HTML)
// ---------------------------------------------------------------------------

export type ExportFormat = 'markdown' | 'tsv' | 'html';

/** Zellen eines Bereichs (ohne Angabe: der ganzen Tabelle) als Raster; fehlende: `undefined`. */
function gridOf(nodes: Record<string, Node>, table: string, rg?: CellRange): (Node | undefined)[][] {
  const { rows, cols } = tableShape(nodes, table);
  const { r0, r1, c0, c1 } = rg ?? { r0: 0, r1: rows.length - 1, c0: 0, c1: cols - 1 };
  const out: (Node | undefined)[][] = [];
  for (let r = r0; r <= r1; r++) {
    const line: (Node | undefined)[] = [];
    for (let c = c0; c <= c1; c++) {
      const id = rows[r] ? cellOf(nodes, rows[r], c) : null;
      line.push(id ? nodes[id] : undefined);
    }
    out.push(line);
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const box = (n: Node | undefined) => (n?.task ? (n.task === 'done' ? '[x] ' : '[ ] ') : '');
const plainCell = (n: Node | undefined) => (n ? box(n) + plainText(n.text, false) : '');

function toTsv(grid: (Node | undefined)[][]): string {
  return grid.map((r) => r.map((n) => plainCell(n).replace(/[\t\n]/g, ' ')).join('\t')).join('\n') + '\n';
}

/** HTML-Tabelle; `head`: erste Zeile als Kopfzeile. */
function toHtml(grid: (Node | undefined)[][], head: boolean): string {
  const cells = (r: (Node | undefined)[], tag: 'th' | 'td') => r.map((n) => `<${tag}>${escapeHtml(plainCell(n))}</${tag}>`).join('');
  const [first, ...rest] = grid;
  const body = (rows: (Node | undefined)[][]) => `<tbody>\n${rows.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('\n')}\n</tbody>`;
  if (!head) return `<table>\n${body(grid)}\n</table>\n`;
  return `<table>\n<thead><tr>${first ? cells(first, 'th') : ''}</tr></thead>\n${body(rest)}\n</table>\n`;
}

/** Text einer Tabelle im gewünschten Format. Markdown behält Formatierung und Links, TSV und HTML zeigen lesbaren Text. */
export function exportTable(table: string, format: ExportFormat): string {
  const grid = gridOf(S().nodes, table);
  if (format === 'tsv') return toTsv(grid);
  if (format === 'markdown') {
    const line = (r: (Node | undefined)[]) => `| ${r.map((n) => (n ? box(n) + n.text : '').replace(/\|/g, '\\|').trim()).join(' | ')} |`;
    const [head, ...body] = grid;
    if (!head) return '';
    return [line(head), `| ${head.map(() => '---').join(' | ')} |`, ...body.map(line)].join('\n') + '\n';
  }
  return toHtml(grid, true);
}

/** In die Zwischenablage; mit `html` zusätzlich als formatierte Tabelle (für Word, Mail, Tabellenkalkulation). */
async function writeClipboard(plain: string, html?: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    return true;
  } catch {
    return false;
  }
}

export async function copyTable(table: string, format: ExportFormat) {
  const text = exportTable(table, format);
  const label = { markdown: 'Markdown', tsv: 'TSV', html: 'HTML' }[format];
  if (await writeClipboard(text, format === 'html' ? text : undefined)) S().toast(L.table.tableCopied(label), 'success');
  else S().toast(L.table.copyFailed, 'error');
}

// ---------------------------------------------------------------------------
// Zellauswahl (mehrere Zellen, ganze Zeilen oder Spalten)
// ---------------------------------------------------------------------------

export function rangeOf(sel: CellSel): CellRange {
  return {
    r0: Math.min(sel.anchor.row, sel.head.row),
    r1: Math.max(sel.anchor.row, sel.head.row),
    c0: Math.min(sel.anchor.col, sel.head.col),
    c1: Math.max(sel.anchor.col, sel.head.col),
  };
}

export const inRange = (rg: CellRange, row: number, col: number) => row >= rg.r0 && row <= rg.r1 && col >= rg.c0 && col <= rg.c1;

/** Zellen von `anchor` bis `head` auswählen (an die Tabelle angepasst); hebt Fokus und Auswahl von Einträgen auf. */
export function selectCells(table: string, anchor: Addr, head: Addr) {
  const s = S();
  const { rows, cols } = tableShape(s.nodes, table);
  if (!rows.length) return;
  const fit = (a: Addr) => ({ row: Math.max(0, Math.min(rows.length - 1, a.row)), col: Math.max(0, Math.min(cols - 1, a.col)) });
  if (s.selection.length) clearSelection();
  s.set({ cellSel: { table, anchor: fit(anchor), head: fit(head) }, focus: null });
}

export function clearCellSel() {
  if (S().cellSel) S().set({ cellSel: null });
}

/** Position der Zelle mit dem Fokus, sofern sie in dieser Tabelle liegt. */
export function focusedCell(table: string): Addr | null {
  const s = S();
  const p = s.focus ? cellPos(s.nodes, s.focus.id) : null;
  return p && p.table === table ? { row: p.row, col: p.col } : null;
}

/** Vorhandene Zellknoten im Bereich. */
function cellsIn(nodes: Record<string, Node>, table: string, rg: CellRange): Node[] {
  return gridOf(nodes, table, rg)
    .flat()
    .filter((n): n is Node => !!n);
}

/** Inhalt leeren (Text, Notiz, Todo); die Zellen selbst bleiben, damit keine Spalte verrutscht. */
export function clearCells(table: string, rg: CellRange) {
  const s = S();
  const ops: Op[] = cellsIn(s.nodes, table, rg)
    .filter((n) => n.text || n.body || n.task)
    .map((n) => ({ op: 'update', id: n.id, text: '', body: '', task: null }));
  if (ops.length) s.commit(ops);
}

/** Strg+Enter: alle als erledigt markieren (sind schon alle erledigt: wieder offen). */
export function completeCells(table: string, rg: CellRange) {
  const s = S();
  const cells = cellsIn(s.nodes, table, rg);
  if (!cells.length) return;
  const allDone = cells.every((n) => n.task === 'done');
  s.commit(cells.map((n) => ({ op: 'update', id: n.id, task: allDone ? 'open' : 'done' }) as Op));
}

/** Zuletzt kopierte Zellen: Beim Einfügen in Hakobo bleiben Formatierung, Links und Todos erhalten. */
let lastCopy: { plain: string; grid: GridCell[][] } | null = null;

const normalize = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\n+$/, '');

/** Bereich kopieren (TSV und HTML, z. B. für Excel oder Word); `cut`: danach leeren. */
export async function copyCells(table: string, rg: CellRange, cut = false) {
  const s = S();
  const grid = gridOf(s.nodes, table, rg);
  const plain = toTsv(grid);
  lastCopy = { plain, grid: grid.map((r) => r.map((n) => ({ text: n?.text ?? '', task: n?.task ?? null }))) };
  if (!(await writeClipboard(plain, toHtml(grid, rg.r0 === 0)))) {
    s.toast(L.table.copyFailed, 'error');
    return;
  }
  const n = (rg.r1 - rg.r0 + 1) * (rg.c1 - rg.c0 + 1);
  if (cut) clearCells(table, rg);
  s.toast(cut ? L.table.cellsCut(n) : L.table.cellsCopied(n), 'success');
}

/** Text in die Auswahl einfügen: Ein einzelner Wert füllt alle Zellen, ein Bereich beginnt oben links. */
export function pasteIntoCells(table: string, rg: CellRange, text: string) {
  let grid: GridCell[][];
  if (lastCopy && normalize(lastCopy.plain) === normalize(text)) grid = lastCopy.grid;
  else grid = parseGrid(text) ?? normalize(text).split('\n').map((l) => [l.trim()]);
  if (grid.length === 1 && grid[0].length === 1) {
    const v = grid[0][0];
    grid = Array.from({ length: rg.r1 - rg.r0 + 1 }, () => Array.from({ length: rg.c1 - rg.c0 + 1 }, () => v));
  }
  pasteGrid(table, rg.r0, rg.c0, grid, { select: true });
}
