// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Tabellenansicht eines Knotens (`layout:: table`, siehe lib/table.ts).

import { createContext, memo, useContext, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
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
  GripHorizontal,
  GripVertical,
  List,
  MoreHorizontal,
  MoveHorizontal,
  Plus,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import { canDrop, draggedIds, dropOn, endDrag, INTERNAL, startDrag, type DropPos } from '../../lib/drag';
import { nextVisible, prevVisible } from '../../lib/outline';
import { store, useStore } from '../../lib/store';
import {
  copyTable,
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  ensureCell,
  focusCell,
  insertColumn,
  insertRow,
  itemsOf,
  moveColumn,
  moveColumnTo,
  moveRow,
  parseGrid,
  parseWidths,
  pasteGrid,
  setColumnWidth,
  sortByColumn,
  swapCells,
  tableShape,
  toggleTable,
  WIDTHS,
} from '../../lib/table';
import { cssZoom } from '../../lib/zoom';
import { Markdown } from '../Markdown';
import { attachImages, hasFiles, imageFiles, setImageWidth } from '../../lib/images';
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

/** Tastatur in einer Zelle: Tab, Enter, Pfeiltasten am Textrand, Zeilen verschieben und löschen. */
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
        if (e.shiftKey || e.altKey || mod || a !== 0 || b !== 0) return e.altKey ? false : 'native';
        if (col > 0) return go(row, col - 1, 'end');
        if (row > 0) return go(row - 1, cols - 1, 'end');
        return 'native';
      case 'ArrowRight':
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
// Gemeinsamer Zustand: Spaltenbreiten, Ziehen von Spalten und Zellen
// ---------------------------------------------------------------------------

/** Gerade gezogene Spalte oder Zelle (unabhängig vom Ziehen von Knoten in lib/drag). */
type TableDrag = { kind: 'col'; table: string; col: number } | { kind: 'cell'; table: string; row: number; col: number };
let tdrag: TableDrag | null = null;

/** Ablagestelle: Spaltengrenze (vor Spalte `edge`) oder Zielzelle. */
type Over = { kind: 'col'; edge: number } | { kind: 'cell'; row: number; col: number } | null;

interface Ctx {
  table: string;
  root: string;
  rows: number;
  cols: number;
  widths: number[];
  over: Over;
  setOver: (o: Over) => void;
  resize: (e: MouseEvent, col: number, th: HTMLElement) => void;
}

const TableContext = createContext<Ctx | null>(null);
const useTable = () => useContext(TableContext)!;

/** Spalten und Zellen bleiben in ihrer Tabelle: kein Text, den ein Editor oder ein anderes Programm einfügen könnte. */
function startTableDrag(e: DragEvent, d: TableDrag) {
  e.stopPropagation();
  tdrag = d;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(INTERNAL, d.table);
}

/** Ziel einer Spalte: Grenze links oder rechts der Zelle, je nach Mausposition. */
function edgeAt(e: DragEvent, col: number): number {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? col : col + 1;
}

/** Eine Spalte darf nicht vor Spalte 1 (Zeilentext) und nicht an ihre eigene Stelle. */
const validEdge = (d: { col: number }, edge: number) => edge >= 1 && edge !== d.col && edge !== d.col + 1;

// ---------------------------------------------------------------------------
// Menü
// ---------------------------------------------------------------------------

/** Menü einer Zelle: Zeile, Spalte und ganze Tabelle. */
function TableMenu({ row, col, id, anchor, onClose }: { row: number; col: number; id: string | null; anchor: Anchor; onClose: () => void }) {
  const { table, rows, cols, widths } = useTable();
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
  return (
    <Popover anchor={anchor} onClose={onClose} width={260} className="ot-menu">
      <div className="menu" role="menu">
        <div className="menu-section">Zeile</div>
        {row > 0 && item(<CornerDownRight size={15} style={{ transform: 'scaleY(-1)' }} />, 'Zeile darüber einfügen', () => insertRow(table, row))}
        {item(<CornerDownRight size={15} />, 'Zeile darunter einfügen', () => insertRow(table, row + 1), 'Enter')}
        {row > 0 && item(<Copy size={15} />, 'Zeile duplizieren', () => duplicateRow(table, row))}
        {row > 1 && item(<ArrowUp size={15} />, 'Zeile nach oben', () => moveRow(table, row, -1, id ?? undefined), 'Alt+⇧+↑')}
        {row > 0 && row < rows - 1 && item(<ArrowDown size={15} />, 'Zeile nach unten', () => moveRow(table, row, 1, id ?? undefined), 'Alt+⇧+↓')}
        {item(<Trash2 size={15} />, row === 0 ? 'Kopfzeile löschen' : 'Zeile löschen', () => deleteRow(table, row), 'Strg+⇧+⌫', true)}
        <div className="menu-section">Spalte</div>
        {col > 0 && item(<Plus size={15} />, 'Spalte links einfügen', () => insertColumn(table, col))}
        {item(<Plus size={15} />, 'Spalte rechts einfügen', () => insertColumn(table, col + 1))}
        {item(<Copy size={15} />, 'Spalte duplizieren', () => duplicateColumn(table, col, row))}
        {col > 1 && item(<ArrowLeft size={15} />, 'Spalte nach links', () => moveColumn(table, col, -1, row))}
        {col > 0 && col < cols - 1 && item(<ArrowRight size={15} />, 'Spalte nach rechts', () => moveColumn(table, col, 1, row))}
        {item(<ArrowDownAZ size={15} />, 'Aufsteigend sortieren', () => sortByColumn(table, col, 1))}
        {item(<ArrowDownZA size={15} />, 'Absteigend sortieren', () => sortByColumn(table, col, -1))}
        {widths[col] > 0 && item(<MoveHorizontal size={15} />, 'Breite automatisch', () => setColumnWidth(table, col, null))}
        {col > 0 && item(<Trash2 size={15} />, 'Spalte löschen', () => deleteColumn(table, col), undefined, true)}
        <div className="menu-section">Tabelle</div>
        {id && item(<ZoomIn size={15} />, 'Zelle öffnen', () => store().zoom(id), 'Alt+→')}
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
  const { table, root, cols, widths, over, setOver, resize } = useTable();
  const node = useStore((s) => (id ? s.nodes[id] : undefined));
  const focused = useStore((s) => !!id && s.focus?.id === id);
  const bodyEdit = useStore((s) => !!id && s.bodyEdit === id);
  const [menu, setMenu] = useState<Anchor | null>(null);
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
  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu && e.type === 'contextmenu') return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ left: r.left, top: r.top, bottom: r.bottom });
  };
  const endTableDrag = () => {
    tdrag = null;
    setOver(null);
  };

  return (
    <Tag
      className={`ot-cell${focused ? ' is-focused' : ''}${id ? '' : ' is-missing'}${nested ? ' has-nested' : ''}${closed ? ' is-closed' : ''}${drop}${fileOver ? ' drop-cell' : ''}`}
      style={w ? { width: w, minWidth: w, maxWidth: w } : undefined}
      onClick={edit}
      onContextMenu={openMenu}
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
          if (validEdge(d, at)) moveColumnTo(table, d.col, at > d.col ? at - 1 : at, row);
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
            title="Ziehen: Spalte verschieben"
            onDragStart={(e) => startTableDrag(e, { kind: 'col', table, col })}
            onDragEnd={endTableDrag}
            onClick={(e) => e.stopPropagation()}
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
        <button className="ot-menu-btn" tabIndex={-1} aria-label="Zeile und Spalte" aria-haspopup="menu" title="Zeile und Spalte (Umschalt+F10)" onMouseDown={(e) => e.preventDefault()} onClick={openMenu}>
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
      {menu && <TableMenu row={row} col={col} id={id} anchor={menu} onClose={() => setMenu(null)} />}
    </Tag>
  );
}

function TableRow({ row, index }: { row: string; index: number }) {
  const { table, cols } = useTable();
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
        if (canDrop(dragged, row, pos)) dropOn(dragged, row, pos);
      }}
    >
      {/* Die ganze Griffspalte ist der Griff (auch bei hohen Zeilen), nicht nur das Symbol. */}
      <td
        className="ot-handle"
        draggable={!head || undefined}
        title={head ? undefined : 'Ziehen: Zeile verschieben'}
        onDragStart={(e) => {
          if (head) return;
          // Nur diese Zeile ziehen, nicht (über die umgebende Gliederungszeile) die ganze Tabelle.
          e.stopPropagation();
          startDrag(e, [row], { within: table });
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

/** Die Tabelle unter dem Knoten `table`; `root` ist die Wurzel der Ansicht (für die Navigation). */
export const TableBlock = memo(function TableBlock({ table, root }: { table: string; root: string }) {
  const shape = useStore((s) => {
    const { rows, cols } = tableShape(s.nodes, table);
    return `${cols}|${rows.join(',')}`;
  });
  const stored = useStore((s) => s.nodes[table]?.fields.find((f) => f.key.toLowerCase() === WIDTHS)?.value ?? '');
  const [over, setOver] = useState<Over>(null);
  const [live, setLive] = useState<{ col: number; w: number } | null>(null);
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

  const ctx: Ctx = { table, root, rows: rows.length, cols, widths, over, setOver, resize };
  return (
    <TableContext.Provider value={ctx}>
      <div
        className="ot-wrap"
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
    </TableContext.Provider>
  );
});
