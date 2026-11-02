// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Tabellenansicht eines Knotens (`layout:: table`, siehe lib/table.ts).

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  Copy,
  CornerDownRight,
  Eraser,
  GripHorizontal,
  GripVertical,
  List,
  MoreHorizontal,
  MoveHorizontal,
  Plus,
  Scissors,
  SquareCheck,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import { canDrop, dragGhost, draggedIds, dropOn, endDrag, INTERNAL, startDrag, type DropPos } from '../../lib/drag';
import { nextVisible, prevVisible } from '../../lib/outline';
import { store, useStore, type CellSel } from '../../lib/store';
import {
  cellOf,
  clearCells,
  clearCellSel,
  completeCells,
  copyCells,
  copyTable,
  deleteColumns,
  deleteRow,
  deleteRows,
  duplicateColumn,
  duplicateRows,
  ensureCell,
  focusCell,
  focusedCell,
  inRange,
  insertColumn,
  insertRow,
  itemsOf,
  moveColumns,
  moveRow,
  moveRows,
  parseGrid,
  parseWidths,
  pasteGrid,
  pasteIntoCells,
  rangeOf,
  selectCells,
  setColumnWidth,
  sortByColumn,
  swapCells,
  tableShape,
  toggleTable,
  WIDTHS,
  type Addr,
  type CellRange,
} from '../../lib/table';
import { cssZoom } from '../../lib/zoom';
import { Markdown } from '../Markdown';
import { attachImages, hasFiles, imageFiles, pastedImages, setImageWidth } from '../../lib/images';
import { caretFromClick, RichText } from '../RichText';
import { Popover, type Anchor } from '../ui';
import { BodyEditor } from './BodyEditor';
import { MetaChips, TaskBox } from './fields';
import { TitleEditor, type EditorKeys } from './TitleEditor';

interface Pos {
  table: string;
  root: string;
  row: number;
  col: number;
}

/** Tastatur in einer Zelle: Tab, Enter, Pfeiltasten am Textrand, Zeilen verschieben und löschen, Zellen auswählen. */
function cellKeys({ table, root, row, col }: Pos, id: string): EditorKeys {
  return (e, ed) => {
    const s = store();
    const { rows, cols } = tableShape(s.nodes, table);
    const mod = e.ctrlKey || e.metaKey;
    const [a, b] = ed.getSelection();
    const len = ed.getText().length;
    const go = (r: number, c: number, caret: 'start' | 'end' = 'end') => {
      e.preventDefault();
      s.commitTitle(id);
      focusCell(table, r, c, caret);
      return true;
    };
    /** Umschalt+Pfeil am Textrand: Zellen von hier bis zur Nachbarzelle auswählen. */
    const select = (anchor: Addr, head: Addr) => {
      e.preventDefault();
      s.commitTitle(id);
      selectCells(table, anchor, head);
      return true;
    };
    const shiftOnly = e.shiftKey && !e.altKey && !mod;
    switch (e.key) {
      case 'Tab':
        if (mod || e.altKey) return false;
        if (e.shiftKey) {
          if (col > 0) return go(row, col - 1);
          if (row > 0) return go(row - 1, cols - 1);
          e.preventDefault();
          return true;
        }
        // Hinter der letzten Zelle: neue Zeile
        return col < cols - 1 ? go(row, col + 1) : go(row + 1, 0);
      case 'Enter':
        // Strg+Enter (Todo), Alt+Enter (hineinzoomen), Umschalt+Enter (Notiz) wie gewohnt
        if (mod || e.altKey || e.shiftKey) return false;
        e.preventDefault();
        s.commitTitle(id);
        insertRow(table, row + 1);
        return true;
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if ((e.altKey || mod) && e.shiftKey) {
          e.preventDefault();
          moveRow(table, row, dir, id);
          return true;
        }
        if (shiftOnly && ed.atEdge(dir)) return select({ row, col }, { row: row + dir, col });
        if (e.shiftKey || e.altKey || mod || !ed.atEdge(dir)) return 'native';
        if (row + dir >= 0 && row + dir < rows.length) return go(row + dir, col, dir < 0 ? 'end' : 'start');
        // Aus der Tabelle heraus: davor bzw. dahinter in der Gliederung
        const last = rows[rows.length - 1];
        const lastCell = itemsOf(s.nodes, last).at(-1) ?? last;
        const target = dir < 0 ? prevVisible(rows[0], root) : nextVisible(lastCell, root);
        e.preventDefault();
        if (target) {
          s.commitTitle(id);
          s.setFocus({ id: target, caret: dir < 0 ? 'end' : 'start' });
        }
        return true;
      }
      case 'ArrowLeft':
        // Cursor am Anfang (oder ganzer Text markiert): Auswahl in die Nachbarzelle
        if (shiftOnly && a === 0 && (b === 0 || b === len)) return select({ row, col }, { row, col: col - 1 });
        if (e.shiftKey || e.altKey || mod || a !== 0 || b !== 0) return e.altKey ? false : 'native';
        if (col > 0) return go(row, col - 1, 'end');
        if (row > 0) return go(row - 1, cols - 1, 'end');
        return 'native';
      case 'ArrowRight':
        if (shiftOnly && b === len && (a === len || a === 0)) return select({ row, col }, { row, col: col + 1 });
        if (e.shiftKey || e.altKey || mod || a !== len || b !== len) return e.altKey ? false : 'native';
        if (col < cols - 1) return go(row, col + 1, 'start');
        if (row < rows.length - 1) return go(row + 1, 0, 'start');
        return 'native';
      case 'Backspace':
      case 'Delete':
        if (mod && e.shiftKey) {
          e.preventDefault();
          deleteRow(table, row);
          return true;
        }
        // Zellen nicht verbinden oder löschen: das würde die Spalten verschieben.
        if ((e.key === 'Backspace' && a === 0 && b === 0) || (e.key === 'Delete' && a === len && b === len)) {
          e.preventDefault();
          return true;
        }
        return 'native';
      case 'a':
      case 'A':
        // Zweites Strg+A (Text schon ganz markiert): die ganze Tabelle
        if (mod && !e.shiftKey && !e.altKey && a === 0 && b === len) return select({ row: 0, col: 0 }, { row: rows.length - 1, col: cols - 1 });
        return false;
      case 'm':
      case 'M':
        // Einzelne Zellen nicht einsortieren (Spalten verrutschen); die Zeile schon.
        if (mod && !e.shiftKey && col > 0) {
          e.preventDefault();
          s.set({ move: { ids: [rows[row]] } });
          return true;
        }
        return false;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------
// Gemeinsamer Zustand: Spaltenbreiten, Ziehen von Spalten und Zellen, Menü, Auswahl
// ---------------------------------------------------------------------------

/** Gerade gezogene Spalte(n) oder Zelle (unabhängig vom Ziehen von Knoten in lib/drag). */
type TableDrag = { kind: 'col'; table: string; col: number; n: number; fromSel: boolean } | { kind: 'cell'; table: string; row: number; col: number };
let tdrag: TableDrag | null = null;

/** Ablagestelle: Spaltengrenze (vor Spalte `edge`) oder Zielzelle. */
type Over = { kind: 'col'; edge: number } | { kind: 'cell'; row: number; col: number } | null;

/** Offenes Menü: Zelle und Position. */
interface MenuAt {
  row: number;
  col: number;
  anchor: Anchor;
}

interface Ctx {
  table: string;
  root: string;
  rows: number;
  cols: number;
  widths: number[];
  over: Over;
  setOver: (o: Over) => void;
  resize: (e: MouseEvent, col: number, th: HTMLElement) => void;
  menu: MenuAt | null;
  openMenu: (row: number, col: number, anchor: Anchor) => void;
  /** Klick auf den Griff einer Zeile oder Spalte: ganz auswählen (Umschalt: Auswahl bis dorthin). */
  selectLine: (kind: 'row' | 'col', index: number, extend: boolean) => void;
}

const TableContext = createContext<Ctx | null>(null);
const useTable = () => useContext(TableContext)!;

/** Spalten und Zellen bleiben in ihrer Tabelle: kein Text, den ein Editor oder ein anderes Programm einfügen könnte. */
function startTableDrag(e: DragEvent, d: TableDrag) {
  e.stopPropagation();
  tdrag = d;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(INTERNAL, d.table);
  if (d.kind === 'col' && d.n > 1) dragGhost(e, `${d.n} Spalten`);
}

/** Ziel einer Spalte: Grenze links oder rechts der Zelle, je nach Mausposition. */
function edgeAt(e: DragEvent, col: number): number {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? col : col + 1;
}

/** Spalten dürfen nicht vor Spalte 1 (Zeilentext) und nicht an ihre eigene Stelle. */
const validEdge = (d: { col: number; n: number }, edge: number) => edge >= 1 && (edge < d.col || edge > d.col + d.n);

/** Klassen einer Zelle in der Auswahl (mit Rand an den Außenkanten). */
function selClass(sel: CellSel | null, table: string, row: number, col: number): string {
  if (!sel || sel.table !== table) return '';
  const rg = rangeOf(sel);
  if (!inRange(rg, row, col)) return '';
  return ` is-sel${row === rg.r0 ? ' sel-t' : ''}${row === rg.r1 ? ' sel-b' : ''}${col === rg.c0 ? ' sel-l' : ''}${col === rg.c1 ? ' sel-r' : ''}`;
}

/** Auswahl nach dem Verschieben mitnehmen. */
function shiftSel(table: string, dr: number, dc: number) {
  const sel = store().cellSel;
  if (sel?.table !== table) return;
  selectCells(table, { row: sel.anchor.row + dr, col: sel.anchor.col + dc }, { row: sel.head.row + dr, col: sel.head.col + dc });
}

/** Nach dem Ziehen ausgewählter Zeilen: Auswahl an ihrer neuen Stelle (andere Zeilen gezogen: Auswahl weg). */
function followRows(table: string, sel: CellSel, before: string[], moved: string[]) {
  const rg = rangeOf(sel);
  const now = itemsOf(store().nodes, table);
  const idx = moved.map((id) => now.indexOf(id));
  const wasSelected = moved.every((id) => inRange(rg, before.indexOf(id), rg.c0));
  if (!wasSelected || idx.some((i) => i < 0)) return clearCellSel();
  selectCells(table, { row: Math.min(...idx), col: rg.c0 }, { row: Math.max(...idx), col: rg.c1 });
}

// ---------------------------------------------------------------------------
// Menü
// ---------------------------------------------------------------------------

/** Menü einer Zelle: Auswahl, Zeile(n), Spalte(n) und ganze Tabelle. Liegt die Zelle in der Auswahl, gilt es für die Auswahl. */
function TableMenu({ row, col, anchor, onClose }: MenuAt & { onClose: () => void }) {
  const { table, rows, cols, widths } = useTable();
  const id = useStore((s) => {
    const r = itemsOf(s.nodes, table)[row];
    return r ? cellOf(s.nodes, r, col) : null;
  });
  const sel = useStore((s) => (s.cellSel?.table === table ? s.cellSel : null));
  const picked = sel ? rangeOf(sel) : null;
  const rg: CellRange = picked && inRange(picked, row, col) ? picked : { r0: row, r1: row, c0: col, c1: col };
  const nr = rg.r1 - rg.r0 + 1;
  const nc = rg.c1 - rg.c0 + 1;
  const multi = nr > 1 || nc > 1;
  const item = (icon: React.ReactNode, label: string, run: () => void, hint?: string, danger?: boolean) => (
    <button
      className={`menu-item${danger ? ' is-danger' : ''}`}
      role="menuitem"
      onClick={() => {
        onClose();
        run();
      }}
    >
      <span className="menu-icon">{icon}</span>
      <span className="menu-label">{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
  // Mehrere Zeilen oder Spalten: Die Auswahl wandert mit. Eine einzelne Zelle behält den Fokus.
  const moveRowsBy = (dir: -1 | 1) => {
    if (moveRows(table, rg.r0, rg.r1, dir, multi ? undefined : (id ?? undefined)) && multi) shiftSel(table, dir, 0);
  };
  const moveColsTo = (edge: number) => {
    const to = moveColumns(table, rg.c0, nc, edge, multi ? -1 : row);
    if (to !== null && multi) shiftSel(table, 0, to - rg.c0);
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={260} className="ot-menu">
      <div className="menu" role="menu">
        {multi && (
          <>
            <div className="menu-section">
              Auswahl · {nr} × {nc}
            </div>
            {item(<ClipboardCopy size={15} />, 'Kopieren', () => void copyCells(table, rg), 'Strg+C')}
            {item(<Scissors size={15} />, 'Ausschneiden', () => void copyCells(table, rg, true), 'Strg+X')}
            {item(<Eraser size={15} />, 'Inhalt löschen', () => clearCells(table, rg), 'Entf')}
            {item(<SquareCheck size={15} />, 'Erledigen', () => completeCells(table, rg), 'Strg+Enter')}
          </>
        )}
        <div className="menu-section">{nr > 1 ? `${nr} Zeilen` : 'Zeile'}</div>
        {rg.r0 > 0 && item(<CornerDownRight size={15} style={{ transform: 'scaleY(-1)' }} />, 'Zeile darüber einfügen', () => insertRow(table, rg.r0))}
        {item(<CornerDownRight size={15} />, 'Zeile darunter einfügen', () => insertRow(table, rg.r1 + 1), multi ? undefined : 'Enter')}
        {rg.r1 > 0 && item(<Copy size={15} />, nr > 1 ? 'Zeilen duplizieren' : 'Zeile duplizieren', () => duplicateRows(table, rg.r0, rg.r1))}
        {rg.r0 > 1 && item(<ArrowUp size={15} />, nr > 1 ? 'Zeilen nach oben' : 'Zeile nach oben', () => moveRowsBy(-1), 'Alt+⇧+↑')}
        {rg.r0 > 0 && rg.r1 < rows - 1 && item(<ArrowDown size={15} />, nr > 1 ? 'Zeilen nach unten' : 'Zeile nach unten', () => moveRowsBy(1), 'Alt+⇧+↓')}
        {item(<Trash2 size={15} />, nr > 1 ? `${nr} Zeilen löschen` : rg.r0 === 0 ? 'Kopfzeile löschen' : 'Zeile löschen', () => deleteRows(table, rg.r0, rg.r1), 'Strg+⇧+⌫', true)}
        <div className="menu-section">{nc > 1 ? `${nc} Spalten` : 'Spalte'}</div>
        {rg.c0 > 0 && item(<Plus size={15} />, 'Spalte links einfügen', () => insertColumn(table, rg.c0))}
        {item(<Plus size={15} />, 'Spalte rechts einfügen', () => insertColumn(table, rg.c1 + 1))}
        {nc === 1 && item(<Copy size={15} />, 'Spalte duplizieren', () => duplicateColumn(table, col, row))}
        {rg.c0 > 1 && item(<ArrowLeft size={15} />, nc > 1 ? 'Spalten nach links' : 'Spalte nach links', () => moveColsTo(rg.c0 - 1))}
        {rg.c0 > 0 && rg.c1 < cols - 1 && item(<ArrowRight size={15} />, nc > 1 ? 'Spalten nach rechts' : 'Spalte nach rechts', () => moveColsTo(rg.c1 + 2))}
        {item(<ArrowDownAZ size={15} />, 'Aufsteigend sortieren', () => sortByColumn(table, col, 1))}
        {item(<ArrowDownZA size={15} />, 'Absteigend sortieren', () => sortByColumn(table, col, -1))}
        {widths[col] > 0 && item(<MoveHorizontal size={15} />, 'Breite automatisch', () => setColumnWidth(table, col, null))}
        {rg.c0 > 0 && item(<Trash2 size={15} />, nc > 1 ? `${nc} Spalten löschen` : 'Spalte löschen', () => deleteColumns(table, rg.c0, rg.c1), undefined, true)}
        <div className="menu-section">Tabelle</div>
        {id && !multi && item(<ZoomIn size={15} />, 'Zelle öffnen', () => store().zoom(id), 'Alt+→')}
        {item(<ClipboardCopy size={15} />, 'Als Markdown kopieren', () => void copyTable(table, 'markdown'))}
        {item(<ClipboardCopy size={15} />, 'Als TSV kopieren', () => void copyTable(table, 'tsv'))}
        {item(<ClipboardCopy size={15} />, 'Als HTML kopieren', () => void copyTable(table, 'html'))}
        {item(<List size={15} />, 'Als Liste anzeigen', () => toggleTable(table))}
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Zelle, Zeile, Tabelle
// ---------------------------------------------------------------------------

function TableCell({ row, col, id }: { row: number; col: number; id: string | null }) {
  const { table, root, cols, widths, over, setOver, resize, menu, openMenu, selectLine } = useTable();
  const node = useStore((s) => (id ? s.nodes[id] : undefined));
  const focused = useStore((s) => !!id && s.focus?.id === id);
  const bodyEdit = useStore((s) => !!id && s.bodyEdit === id);
  const selCls = useStore((s) => selClass(s.cellSel, table, row, col));
  const [fileOver, setFileOver] = useState(false);
  const pos: Pos = { table, root, row, col };
  const head = row === 0;
  const Tag = head ? 'th' : 'td';
  // Spalte 0 ist die Zeile selbst; ihre Kinder sind die Zellen, nicht verschachtelter Inhalt.
  const nested = node && col > 0 ? node.children.length : 0;
  const closed = node?.task === 'done' || node?.task === 'cancelled';
  const w = widths[col] || 0;
  const edge = over?.kind === 'col' ? over.edge : -1;
  const drop = over?.kind === 'cell' && over.row === row && over.col === col ? ' drop-cell' : edge === col ? ' drop-left' : edge === cols && col === cols - 1 ? ' drop-right' : '';

  const edit = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, .chip, .md, .ot-grip-col, .ot-grip-cell, .ot-resize')) return;
    // Text markiert: lassen (zum Kopieren)
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
    if (!id || !node) {
      focusCell(table, row, col);
      return;
    }
    store().setFocus({ id, caret: caretFromClick(e, node.text.length) });
  };
  const onMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'contextmenu' && menu?.row === row && menu.col === col) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(row, col, { left: r.left, top: r.top, bottom: r.bottom });
  };
  const endTableDrag = () => {
    tdrag = null;
    setOver(null);
  };

  return (
    <Tag
      className={`ot-cell${focused ? ' is-focused' : ''}${id ? '' : ' is-missing'}${nested ? ' has-nested' : ''}${closed ? ' is-closed' : ''}${drop}${fileOver ? ' drop-cell' : ''}${selCls}`}
      data-row={row}
      data-col={col}
      style={w ? { width: w, minWidth: w, maxWidth: w } : undefined}
      onClick={edit}
      onContextMenu={onMenu}
      onDragOver={(e) => {
        // Bilder von außen hängen an der Zelle
        if (hasFiles(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          if (!fileOver) setFileOver(true);
          return;
        }
        const d = tdrag;
        // Sonst: Ziehen von Zeilen und Einträgen (an der Tabellenzeile)
        if (!d || d.table !== table) return;
        e.stopPropagation();
        if (d.kind === 'col') {
          const at = edgeAt(e, col);
          if (!validEdge(d, at)) return setOver(null);
          e.preventDefault();
          if (over?.kind !== 'col' || over.edge !== at) setOver({ kind: 'col', edge: at });
        } else {
          if (col < 1 || (d.row === row && d.col === col)) return setOver(null);
          e.preventDefault();
          if (over?.kind !== 'cell' || over.row !== row || over.col !== col) setOver({ kind: 'cell', row, col });
        }
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={(e) => {
        if (fileOver && !e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setFileOver(false);
      }}
      onDrop={(e) => {
        if (hasFiles(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          setFileOver(false);
          const files = imageFiles(e.dataTransfer);
          if (!files.length) return store().toast('Nur Bilder lassen sich hier ablegen', 'info');
          const target = id ?? ensureCell(table, row, col);
          if (target) void attachImages(target, files);
          return;
        }
        const d = tdrag;
        if (!d || d.table !== table) return;
        e.preventDefault();
        e.stopPropagation();
        endTableDrag();
        if (d.kind === 'col') {
          const at = edgeAt(e, col);
          if (!validEdge(d, at)) return;
          // Aus der Auswahl gezogen: Auswahl bleibt an den Spalten; sonst Fokus in die verschobene Zelle
          const to = moveColumns(table, d.col, d.n, at, d.fromSel ? -1 : row);
          if (to !== null && d.fromSel) shiftSel(table, 0, to - d.col);
        } else if (col >= 1 && !(d.row === row && d.col === col)) {
          swapCells(table, { row: d.row, col: d.col }, { row, col });
        }
      }}
    >
      {/* Griffe: in der Kopfzeile die Spalte, sonst die Zelle (Spalte 0 ist die Zeile und bleibt fest). */}
      {col > 0 &&
        (head ? (
          <span
            className="ot-grip-col"
            draggable
            title="Ziehen: Spalte verschieben · Klick: Spalte auswählen"
            onDragStart={(e) => {
              // Spalte in einer Auswahl ganzer Spalten: alle ausgewählten mitnehmen
              const cs = store().cellSel;
              const rg = cs?.table === table ? rangeOf(cs) : null;
              if (rg && rg.c0 >= 1 && col >= rg.c0 && col <= rg.c1) startTableDrag(e, { kind: 'col', table, col: rg.c0, n: rg.c1 - rg.c0 + 1, fromSel: true });
              else startTableDrag(e, { kind: 'col', table, col, n: 1, fromSel: false });
            }}
            onDragEnd={endTableDrag}
            onClick={(e) => {
              e.stopPropagation();
              selectLine('col', col, e.shiftKey);
            }}
          >
            <GripHorizontal size={12} />
          </span>
        ) : (
          <span
            className="ot-grip-cell"
            draggable
            title="Ziehen: Zelle mit einer anderen tauschen"
            onDragStart={(e) => startTableDrag(e, { kind: 'cell', table, row, col })}
            onDragEnd={endTableDrag}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={11} />
          </span>
        ))}
      <div className="ot-cell-inner">
        {node?.task && <TaskBox node={node} size={14} />}
        {focused && id ? (
          <TitleEditor
            id={id}
            root={root}
            className="is-cell"
            placeholder={head ? 'Spaltenname' : undefined}
            keys={cellKeys(pos, id)}
            onPasteText={(text) => {
              const grid = parseGrid(text);
              if (!grid || (grid.length === 1 && grid[0].length === 1)) return false;
              pasteGrid(table, row, col, grid);
              return true;
            }}
          />
        ) : (
          <div className={`ot-text${node?.text ? '' : ' is-empty'}`}>{node?.text ? <RichText text={node.text} source={node} /> : '​'}</div>
        )}
        {node && col > 0 && <MetaChips node={node} />}
        {nested > 0 && (
          <button
            className="ot-nested"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              store().zoom(id!);
            }}
            title={`${nested} ${nested === 1 ? 'Eintrag' : 'Einträge'} darunter – öffnen (Alt+→)`}
          >
            {nested}
          </button>
        )}
        <button className="ot-menu-btn" tabIndex={-1} aria-label="Zeile und Spalte" aria-haspopup="menu" title="Zeile und Spalte (Umschalt+F10)" onMouseDown={(e) => e.preventDefault()} onClick={onMenu}>
          <MoreHorizontal size={13} />
        </button>
      </div>
      {id && bodyEdit ? (
        <div className="ot-body" onClick={(e) => e.stopPropagation()}>
          <BodyEditor
            id={id}
            onClose={(focusTitle) => {
              store().set({ bodyEdit: null });
              if (focusTitle) store().setFocus({ id, caret: 'end' });
            }}
          />
        </div>
      ) : node?.body ? (
        <div className="ot-body">
          <Markdown
            text={node.body}
            source={node}
            onImageResize={(href, k, w) => setImageWidth(id!, href, k, w)}
            onClick={(e) => {
              if (window.getSelection()?.toString()) return;
              e.stopPropagation();
              store().set({ bodyEdit: id });
            }}
          />
        </div>
      ) : null}
      {/* Breite ziehen (Doppelklick: wieder automatisch) */}
      {head && (
        <span
          className="ot-resize"
          title="Ziehen: Spaltenbreite · Doppelklick: automatisch"
          onMouseDown={(e) => resize(e, col, e.currentTarget.parentElement!)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setColumnWidth(table, col, null);
          }}
        />
      )}
    </Tag>
  );
}

function TableRow({ row, index }: { row: string; index: number }) {
  const { table, cols, selectLine } = useTable();
  const cells = useStore((s) => itemsOf(s.nodes, row).join(','));
  const [dropAt, setDropAt] = useState<DropPos | null>(null);
  const ids = cells ? cells.split(',') : [];
  const head = index === 0;
  // Zeilen nur zwischen andere Zeilen ablegen; die Kopfzeile bleibt oben.
  const posOf = (e: DragEvent<HTMLElement>): DropPos => {
    const r = e.currentTarget.getBoundingClientRect();
    return head || e.clientY > r.top + r.height / 2 ? 'after' : 'before';
  };
  return (
    <tr
      className={`ot-row${head ? ' is-head' : ''}${dropAt ? ` drop-${dropAt}` : ''}`}
      onDragOver={(e) => {
        const dragged = draggedIds();
        if (!dragged.length) return;
        const pos = posOf(e);
        if (!canDrop(dragged, row, pos)) return setDropAt(null);
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropAt(pos);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDropAt(null);
      }}
      onDrop={(e) => {
        const dragged = draggedIds();
        if (!dragged.length) return;
        e.preventDefault();
        e.stopPropagation();
        const pos = posOf(e);
        setDropAt(null);
        endDrag();
        if (!canDrop(dragged, row, pos)) return;
        const s = store();
        const sel = s.cellSel?.table === table ? s.cellSel : null;
        const before = itemsOf(s.nodes, table);
        dropOn(dragged, row, pos);
        if (sel) followRows(table, sel, before, dragged);
      }}
    >
      {/* Die ganze Griffspalte ist der Griff (auch bei hohen Zeilen), nicht nur das Symbol. */}
      <td
        className="ot-handle"
        draggable={!head || undefined}
        title={head ? 'Klick: Kopfzeile auswählen' : 'Ziehen: Zeile verschieben · Klick: Zeile auswählen'}
        onClick={(e) => selectLine('row', index, e.shiftKey)}
        onDragStart={(e) => {
          if (head) return;
          // Nur diese Zeile ziehen, nicht (über die umgebende Gliederungszeile) die ganze Tabelle;
          // liegt sie in der Auswahl, alle ausgewählten Zeilen.
          e.stopPropagation();
          const s = store();
          const rg = s.cellSel?.table === table ? rangeOf(s.cellSel) : null;
          const all = itemsOf(s.nodes, table);
          const ids = rg && index >= rg.r0 && index <= rg.r1 ? all.slice(Math.max(1, rg.r0), rg.r1 + 1) : [row];
          startDrag(e, ids, { within: table, noun: 'Zeilen' });
        }}
        onDragEnd={endDrag}
      >
        {!head && (
          <span className="ot-grip">
            <GripVertical size={13} />
          </span>
        )}
      </td>
      {Array.from({ length: cols }, (_, c) => (
        <TableCell key={c} row={index} col={c} id={c === 0 ? row : (ids[c - 1] ?? null)} />
      ))}
      {head ? (
        <th className="ot-add-col">
          <button className="btn btn-ghost btn-icon btn-sm" tabIndex={-1} onClick={() => insertColumn(table, cols)} title="Spalte anfügen" aria-label="Spalte anfügen">
            <Plus size={14} />
          </button>
        </th>
      ) : (
        <td className="ot-add-col" />
      )}
    </tr>
  );
}

const STEP: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** Hier beginnt kein Auswählen per Ziehen (Knöpfe, Griffe, Spaltenrand, Bildbreite). */
const NO_SELECT = 'button, input, .taskbox, .ot-grip-col, .ot-grip-cell, .ot-resize, .md-img-resize';

/** Die Tabelle unter dem Knoten `table`; `root` ist die Wurzel der Ansicht (für die Navigation). */
export const TableBlock = memo(function TableBlock({ table, root }: { table: string; root: string }) {
  const shape = useStore((s) => {
    const { rows, cols } = tableShape(s.nodes, table);
    return `${cols}|${rows.join(',')}`;
  });
  const stored = useStore((s) => s.nodes[table]?.fields.find((f) => f.key.toLowerCase() === WIDTHS)?.value ?? '');
  const active = useStore((s) => s.cellSel?.table === table);
  const [over, setOver] = useState<Over>(null);
  const [live, setLive] = useState<{ col: number; w: number } | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sink = useRef<HTMLTextAreaElement>(null);
  const [colsStr, rowsStr] = shape.split('|');
  const cols = Number(colsStr);
  const rows = rowsStr ? rowsStr.split(',') : [];
  const widths = useMemo(() => {
    const w = parseWidths(stored);
    if (live) {
      while (w.length <= live.col) w.push(0);
      w[live.col] = live.w;
    }
    return w;
  }, [stored, live]);

  // Ausgewählte Zellen: Tastatur und Zwischenablage laufen über ein unsichtbares Eingabefeld.
  // Es bekommt den Fokus, sobald die Auswahl beginnt (der Editor der Zelle ist dann weg) …
  useEffect(() => {
    if (active && !document.activeElement?.closest('.popover, .dialog')) sink.current?.focus({ preventScroll: true });
  }, [active]);
  // … und zurück, wenn ein Klick (etwa auf einen Griff) ihn genommen hat, ohne ihn woanders hinzusetzen.
  useEffect(
    () =>
      useStore.subscribe((st, prev) => {
        if (st.cellSel === prev.cellSel || st.cellSel?.table !== table) return;
        const a = document.activeElement;
        if (!a || a === document.body) sink.current?.focus({ preventScroll: true });
      }),
    [table],
  );

  const resize = (e: MouseEvent, col: number, th: HTMLElement) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const z = cssZoom();
    const x0 = e.clientX;
    const w0 = th.getBoundingClientRect().width / z;
    let w = w0;
    const move = (ev: globalThis.MouseEvent) => {
      w = Math.max(60, Math.min(900, w0 + (ev.clientX - x0) / z));
      setLive({ col, w });
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      document.body.classList.remove('is-col-resizing');
      setLive(null);
      if (Math.abs(w - w0) >= 1) setColumnWidth(table, col, w);
    };
    document.body.classList.add('is-col-resizing');
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

  const openMenu = (row: number, col: number, anchor: Anchor) => {
    // Rechtsklick außerhalb der Auswahl: Menü nur für diese Zelle
    const sel = store().cellSel;
    if (sel && (sel.table !== table || !inRange(rangeOf(sel), row, col))) clearCellSel();
    setMenu({ row, col, anchor });
  };

  const openMenuAt = (a: Addr) => {
    const el = wrap.current?.querySelector<HTMLElement>(`.ot-cell[data-row="${a.row}"][data-col="${a.col}"]`);
    const r = el?.getBoundingClientRect();
    if (r) setMenu({ row: a.row, col: a.col, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
  };

  const selectLine = (kind: 'row' | 'col', i: number, extend: boolean) => {
    const s = store();
    const { rows: rs, cols: cs } = tableShape(s.nodes, table);
    const from = extend ? (s.cellSel?.table === table ? s.cellSel.anchor : focusedCell(table)) : null;
    if (kind === 'row') selectCells(table, { row: from?.row ?? i, col: 0 }, { row: i, col: cs - 1 });
    else selectCells(table, { row: 0, col: from?.col ?? i }, { row: rs.length - 1, col: i });
  };

  /** Ziehen über mehrere Zellen wählt sie aus (in einer Zelle bleibt es Textmarkieren); Umschalt+Klick erweitert. */
  const startCellSelect = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const box = e.currentTarget;
    const t = e.target as HTMLElement;
    const cell = t.closest<HTMLElement>('.ot-cell');
    if (!cell || cell.closest('.ot-wrap') !== box || t.closest(NO_SELECT)) return;
    const s = store();
    const start = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
    let anchor = start;
    let selecting = false;
    let last = '';

    /** Zelle unter dem Mauszeiger; außerhalb der Tabelle die nächstgelegene. */
    const addrAt = (x: number, y: number): Addr | null => {
      const trs = box.querySelectorAll<HTMLElement>(':scope > table > tbody > tr');
      if (!trs.length) return null;
      let row = 0;
      trs.forEach((tr, i) => {
        if (tr.getBoundingClientRect().top <= y) row = i;
      });
      let col = 0;
      trs[0].querySelectorAll<HTMLElement>(':scope > .ot-cell').forEach((th, i) => {
        if (th.getBoundingClientRect().left <= x) col = i;
      });
      return { row, col };
    };
    const select = (head: Addr) => {
      const key = `${head.row}:${head.col}`;
      if (key === last) return;
      last = key;
      selectCells(table, anchor, head);
    };
    const activate = () => {
      selecting = true;
      window.getSelection()?.removeAllRanges();
      (document.activeElement as HTMLElement | null)?.blur?.();
      document.body.classList.add('is-drag-selecting');
    };
    const move = (ev: globalThis.MouseEvent) => {
      // Taste schon losgelassen, ohne dass ein mouseup kam (z. B. außerhalb des Fensters): beenden.
      if (ev.buttons === 0) return finish(false);
      const here = addrAt(ev.clientX, ev.clientY);
      if (!here) return;
      if (!selecting) {
        if (here.row === start.row && here.col === start.col) return;
        activate();
      }
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      select(here);
    };
    const finish = (swallowClick: boolean) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('dragstart', stop, true);
      window.removeEventListener('blur', stop);
      if (!selecting) return;
      document.body.classList.remove('is-drag-selecting');
      if (!swallowClick) return;
      // Der Klick nach dem Loslassen soll keine Zelle zum Bearbeiten öffnen.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, true);
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    };
    const up = () => finish(true);
    const stop = () => finish(false);

    if (e.shiftKey) {
      // Von der Auswahl oder der Zelle mit dem Fokus bis hierher
      anchor = (s.cellSel?.table === table ? s.cellSel.anchor : null) ?? focusedCell(table) ?? start;
      e.preventDefault();
      activate();
      select(start);
    } else if (s.cellSel) {
      clearCellSel();
    }
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('dragstart', stop, true);
    window.addEventListener('blur', stop);
  };

  /** Tasten bei ausgewählten Zellen. */
  const onSinkKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const s = store();
    const sel = s.cellSel;
    if (!sel || sel.table !== table) return;
    const { rows: rs, cols: cs } = tableShape(s.nodes, table);
    const rg = rangeOf(sel);
    const { anchor, head } = sel;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const step = STEP[e.key];
    let handled = true;
    if (step && e.altKey && e.shiftKey && !mod && step[1] === 0) {
      // Alt+Umschalt+↑/↓: ausgewählte Zeilen verschieben
      if (moveRows(table, rg.r0, rg.r1, step[0] as -1 | 1)) shiftSel(table, step[0], 0);
    } else if (step && !e.altKey && !mod) {
      const to = { row: head.row + step[0], col: head.col + step[1] };
      if (e.shiftKey) selectCells(table, anchor, to);
      else focusCell(table, Math.max(0, Math.min(rs.length - 1, to.row)), Math.max(0, Math.min(cs - 1, to.col)));
    } else if (e.key === 'Enter' && mod && !e.altKey) {
      completeCells(table, rg);
    } else if ((e.key === 'Enter' || e.key === 'F2' || e.key === 'Escape') && !mod && !e.altKey && !e.shiftKey) {
      // Bearbeiten bzw. Auswahl aufheben: weiter in der zuletzt erreichten Zelle
      focusCell(table, head.row, head.col);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && mod && e.shiftKey) {
      // Ganze Spalten ausgewählt: Spalten löschen, sonst die Zeilen
      if (rg.r0 === 0 && rg.r1 === rs.length - 1 && rg.c0 >= 1) deleteColumns(table, rg.c0, rg.c1);
      else deleteRows(table, rg.r0, rg.r1);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.altKey) {
      clearCells(table, rg);
    } else if (mod && !e.altKey && !e.shiftKey && (k === 'c' || k === 'x')) {
      void copyCells(table, rg, k === 'x');
    } else if (mod && !e.altKey && !e.shiftKey && k === 'a') {
      selectCells(table, { row: 0, col: 0 }, { row: rs.length - 1, col: cs - 1 });
    } else if (mod && !e.altKey && !e.shiftKey && k === 'z') {
      s.undo();
    } else if (mod && !e.altKey && ((e.shiftKey && k === 'z') || k === 'y')) {
      s.redo();
    } else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && !mod && !e.altKey) {
      openMenuAt(head);
    } else {
      // Strg+V geht als Einfügen-Ereignis weiter; getippte Zeichen landen nicht unsichtbar im Feld.
      handled = e.key.length === 1 && !mod && !e.altKey;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onSinkPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const sel = store().cellSel;
    if (!sel || sel.table !== table) return;
    e.preventDefault();
    const images = pastedImages(e.clipboardData);
    if (images.length) {
      const target = ensureCell(table, sel.head.row, sel.head.col);
      if (target) void attachImages(target, images);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (text) pasteIntoCells(table, rangeOf(sel), text);
  };

  const ctx: Ctx = { table, root, rows: rows.length, cols, widths, over, setOver, resize, menu, openMenu, selectLine };
  return (
    <TableContext.Provider value={ctx}>
      <textarea ref={sink} className="ot-sink" aria-label="Ausgewählte Zellen" tabIndex={-1} value="" onChange={() => undefined} onKeyDown={onSinkKey} onPaste={onSinkPaste} />
      <div
        ref={wrap}
        className="ot-wrap"
        onMouseDown={startCellSelect}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setOver(null);
        }}
      >
        <table className="ot">
          <tbody>
            {rows.map((r, i) => (
              <TableRow key={r} row={r} index={i} />
            ))}
          </tbody>
        </table>
        <button className="ot-add-row" onClick={() => insertRow(table, rows.length)}>
          <Plus size={14} /> Zeile
        </button>
      </div>
      {menu && <TableMenu {...menu} onClose={() => setMenu(null)} />}
    </TableContext.Provider>
  );
});
