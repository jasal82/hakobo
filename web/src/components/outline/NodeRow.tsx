// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Eine Zeile der Gliederung (rekursiv mit Kindern).

import { memo, useState, type DragEvent, type MouseEvent } from 'react';
import { ChevronRight, CircleCheck, CircleDot, CodeXml, Copy, FileOutput, FileText, FolderInput, History, ImagePlus, List, MoreHorizontal, Plus, StickyNote, Table2, Tag, Trash2, Type, ZoomIn } from 'lucide-react';
import { canDrop, draggedIds, dropOn, dropPosition, endDrag, startDrag, type DropPos } from '../../lib/drag';
import { createSubpage, cycleTask, deleteNode, selectRange, toggleSelected, toggleTodo, toPage } from '../../lib/outline';
import { isCollapsed, isTable, store, typesOf, useStore } from '../../lib/store';
import { toggleTable } from '../../lib/table';
import type { Node } from '../../lib/types';
import { isCodeNode } from '../../lib/code';
import { Markdown } from '../Markdown';
import { attachImages, chooseImages, hasFiles, imageFiles, insertImageNodes, setImageWidth } from '../../lib/images';
import { caretFromClick, RichText } from '../RichText';
import { Popover, type Anchor } from '../ui';
import { L } from '../../i18n';
import { BodyEditor } from './BodyEditor';
import { CodeBlock } from './CodeBlock';
import { MetaChips, TaskBox } from './fields';
import { TableBlock } from './Table';
import { copyLink, TitleEditor } from './TitleEditor';

export const Children = memo(function Children({ parent, root }: { parent: string; root: string }) {
  const children = useStore((s) => s.nodes[parent]?.children);
  if (!children?.length) return null;
  return (
    <div className="children">
      {children.map((c) => (
        <NodeRow key={c} id={c} root={root} />
      ))}
    </div>
  );
});

export const NodeRow = memo(function NodeRow({ id, root, inbox }: { id: string; root: string; inbox?: boolean }) {
  const node = useStore((s) => s.nodes[id]);
  const collapsed = useStore((s) => isCollapsed(s.collapsed, s.nodes[id]));
  const focused = useStore((s) => s.focus?.id === id);
  const bodyEdit = useStore((s) => s.bodyEdit === id);
  const flash = useStore((s) => s.flash === id);
  const selected = useStore((s) => s.selection.includes(id));
  const types = useStore((s) => s.types);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [dropAt, setDropAt] = useState<DropPos | null>(null);
  if (!node) return null;

  const isPage = node.kind === 'page';
  const code = isCodeNode(node);
  const hasKids = node.children.length > 0;
  const typeKeys = typesOf(node, types);
  const color = typeKeys.length ? types[typeKeys[0]].color : undefined;
  const heading = /^(#{1,3}) /.exec(node.text)?.[1].length ?? 0;
  const closed = node.task === 'done' || node.task === 'cancelled';
  const table = isTable(node);
  // Tabelle ohne Titel und Notiz rückt hoch; beim Bearbeiten des Titels steht sie wieder darunter.
  const inlineTable = table && !node.text.trim() && !node.body && !focused && !bodyEdit && !collapsed;

  const startEdit = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, .chip')) return;
    // Text per Ziehen markiert: Markierung lassen (z. B. zum Kopieren), nicht bearbeiten.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
    const st = store();
    if (e.shiftKey) {
      const anchor = st.focus?.id ?? st.selection[0] ?? id;
      selectRange(root, anchor === root ? id : anchor, id);
      window.getSelection()?.removeAllRanges();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (st.focus && st.focus.id !== id && !st.selection.length) toggleSelected(st.focus.id);
      toggleSelected(id);
      return;
    }
    const caret = caretFromClick(e, node.text.length);
    store().setFocus({ id, caret });
  };

  /** Wohin von außen gezogene Bilder kommen: Seiten nehmen sie auf, Codeblöcke nicht (dort davor/dahinter). */
  const filePos = (e: DragEvent): DropPos => {
    if (isPage) return 'into';
    const pos = dropPosition(e, e.currentTarget as HTMLElement);
    if (pos !== 'into' || !code) return pos;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const dropFiles = (e: DragEvent) => {
    const files = imageFiles(e.dataTransfer);
    if (!files.length) {
      store().toast(L.editor.onlyImages, 'info');
      return;
    }
    const pos = filePos(e);
    if (pos === 'into') {
      if (!isPage) void attachImages(id, files);
      // In eine Seite (z. B. in der Notizbuch-Ansicht): als neue Einträge am Ende
      else void insertImageNodes(id, undefined, files).then((ids) => ids && store().toast(L.outline.row.insertedInto(node.text), 'success', { label: L.common.open, run: () => store().reveal(ids[0]) }));
      return;
    }
    const parent = node.parent ? store().nodes[node.parent] : undefined;
    if (!parent) return;
    void insertImageNodes(parent.id, parent.children.indexOf(id) + (pos === 'after' ? 1 : 0), files);
  };

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Schon per Tastatur (Umschalt+F10) geöffnet – das nachfolgende Kontextmenü-Ereignis ignorieren.
    if (menu && e.type === 'contextmenu') return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ left: r.left, top: r.top, bottom: r.bottom });
  };

  return (
    <div className={`row${flash ? ' is-flash' : ''}${closed ? ' is-closed' : ''}`} data-id={id}>
      <div
        className={`row-line${focused ? ' is-focused' : ''}${selected ? ' is-selected' : ''}${dropAt ? ` drop-${dropAt}` : ''}${heading ? ` is-h${heading}` : ''}${isPage ? ' is-page' : ''}${code ? ' is-code' : ''}`}
        // Ausgewählte Zeilen lassen sich als Ganzes ziehen, sonst nur am Aufzählungspunkt.
        // Nicht bei einer Tabelle in der Zeile: Dort gehört das Ziehen den Zeilen, Spalten und Zellen.
        draggable={(selected && !inlineTable) || undefined}
        onDragStart={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest('.ot-wrap')) return;
          // Markierten Text oder Links im Editor nicht als Zeile ziehen.
          if (!selected && !t.closest('.bullet')) return;
          const sel = store().selection;
          startDrag(e, selected && sel.length > 1 ? sel : [id]);
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          // Bilder von außen: auf den Eintrag (anhängen) oder davor/dahinter (neuer Eintrag)
          if (hasFiles(e.dataTransfer)) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            setDropAt(filePos(e));
            return;
          }
          const ids = draggedIds();
          if (!ids.length) return;
          const pos = dropPosition(e, e.currentTarget);
          if (!canDrop(ids, id, pos)) {
            setDropAt(null);
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropAt(pos);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDropAt(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (hasFiles(e.dataTransfer)) {
            e.stopPropagation();
            setDropAt(null);
            dropFiles(e);
            return;
          }
          // Position aus dem Ereignis selbst (der Zustand von dragover kann noch ausstehen).
          const pos = dropPosition(e, e.currentTarget);
          const ids = draggedIds();
          setDropAt(null);
          endDrag();
          // In eine Seite: Ziel verschwindet aus dem Blick, daher mit Meldung.
          if (pos && canDrop(ids, id, pos)) dropOn(ids, id, pos, { quiet: !isPage });
        }}
        onContextMenu={openMenu}
      >
        <span className="row-gutter">
          {hasKids && (
            <button className={`row-fold${collapsed ? '' : ' is-open'}`} onMouseDown={(e) => e.preventDefault()} onClick={() => store().setCollapsed(id, !collapsed)} aria-label={collapsed ? L.outline.row.expand : L.outline.row.collapse}>
              <ChevronRight size={14} />
            </button>
          )}
          <a
            className={`bullet${hasKids && collapsed ? ' has-hidden' : ''}${isPage ? ' is-page' : ''}`}
            style={color ? { ['--type-color' as string]: `var(--t-${color})` } : undefined}
            // Das Ziehen übernimmt die Zeile (bei Auswahl alle ausgewählten).
            draggable
            onClick={(e) => {
              e.preventDefault();
              store().zoom(id);
            }}
            title={isPage ? L.outline.row.openPage : L.outline.row.zoomIn}
          >
            {isPage ? <FileText size={14} /> : <span className="dot" />}
          </a>
        </span>
        {node.task && <TaskBox node={node} />}
        {inlineTable ? (
          // Tabelle ohne Titel: direkt neben dem Aufzählungspunkt statt unter einer leeren Zeile.
          <div className="row-table">
            <TableBlock table={id} root={root} />
          </div>
        ) : (
          <div className="row-content" onClick={code ? undefined : startEdit}>
            {code ? (
              <CodeBlock id={id} root={root} focused={focused} />
            ) : focused ? (
              <TitleEditor id={id} root={root} placeholder={isPage ? L.outline.row.pageTitle : table ? L.outline.row.tableTitle : undefined} />
            ) : (
              <div className={`row-text${node.text ? '' : ' is-empty'}`}>{node.text ? <RichText text={node.text} source={node} /> : table ? <span className="faint">{L.outline.row.table}</span> : '​'}</div>
            )}
            {!isPage && !code && <MetaChips node={node} />}
          </div>
        )}
        <span className="row-actions">
          {inbox && !isPage && !code && (
            <button className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => store().set({ move: { ids: [id] } })} title={L.outline.row.moveTitle}>
              <FolderInput size={14} /> {L.outline.row.move}
            </button>
          )}
          {inbox && !isPage && !code && (
            <button className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => store().set({ assign: { id } })} title={L.outline.row.assignTitle}>
              <Tag size={14} /> {L.outline.row.assign}
            </button>
          )}
          <button className="btn btn-ghost btn-icon btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={openMenu} aria-label={L.outline.row.actions} title={L.outline.row.actionsTitle} aria-haspopup="menu">
            <MoreHorizontal size={15} />
          </button>
        </span>
      </div>
      {code ? null : bodyEdit ? (
        <div className="row-body">
          <BodyEditor
            id={id}
            onClose={(focusTitle) => {
              store().set({ bodyEdit: null });
              if (focusTitle) store().setFocus({ id, caret: 'end' });
            }}
          />
        </div>
      ) : node.body ? (
        <div className="row-body">
          <Markdown
            text={node.body}
            source={node}
            onImageResize={(href, k, w) => setImageWidth(id, href, k, w)}
            onClick={(e) => {
              // Im Code darf man markieren und kopieren; Doppelklick bearbeitet trotzdem.
              if ((e.target as HTMLElement).closest('pre') && e.detail < 2) return;
              if (window.getSelection()?.toString()) return;
              store().set({ bodyEdit: id });
            }}
          />
        </div>
      ) : null}
      {!collapsed && !inlineTable && (table ? <TableBlock table={id} root={root} /> : hasKids && <Children parent={id} root={root} />)}
      {menu && <RowMenu node={node} root={root} anchor={menu} onClose={() => setMenu(null)} />}
    </div>
  );
});

export function RowMenu({ node, root, anchor, onClose }: { node: Node; root: string; anchor: Anchor; onClose: () => void }) {
  const s = store();
  const id = node.id;
  const m = L.outline.menu;
  const k = L.outline.keys;
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
  const code = isCodeNode(node);
  // Knöpfe im Kopf des Codeblocks (Sprache, Kopieren) – auch per Tastatur über dieses Menü.
  const codeButton = (cls: string) => document.querySelector<HTMLButtonElement>(`.row[data-id="${CSS.escape(id)}"] ${cls}`);
  return (
    <Popover anchor={anchor} onClose={onClose} width={240}>
      <div className="menu" role="menu">
        {item(<ZoomIn size={15} />, node.kind === 'page' ? L.outline.row.openPage : L.outline.row.zoomIn, () => s.zoom(id), k.altRight)}
        {code && item(<CodeXml size={15} />, m.language, () => codeButton('.code-lang')?.click())}
        {code && item(<Copy size={15} />, m.copyCode, () => codeButton('.code-copy')?.click())}
        {node.kind === 'item' && item(<StickyNote size={15} />, node.body ? m.editNote : m.addNote, () => s.set({ bodyEdit: id }), k.shiftEnter)}
        {!code && (node.kind === 'item' || node.kind === 'page') && item(<ImagePlus size={15} />, m.insertImage, () => void chooseImages(id), m.imageCmd)}
        {node.kind === 'item' && item(node.task ? <CircleCheck size={15} /> : <CircleDot size={15} />, node.task ? (node.task === 'done' ? m.reopen : m.complete) : m.makeTodo, () => (node.task ? cycleTask(id) : toggleTodo(id)), k.ctrlEnter)}
        {node.task && node.kind === 'item' && item(<CircleDot size={15} />, m.noTodo, () => toggleTodo(id))}
        {item(<FolderInput size={15} />, m.move, () => s.set({ move: { ids: [id] } }), k.ctrlM)}
        {node.kind === 'item' && item(<Tag size={15} />, m.assign, () => s.set({ assign: { id } }))}
        {item(<Copy size={15} />, m.copyLink, () => void copyLink(id), k.ctrlL)}
        {node.kind === 'item' && item(<FileOutput size={15} />, m.toPage, () => void toPage(id))}
        {!code && id !== s.inbox && item(isTable(node) ? <List size={15} /> : <Table2 size={15} />, isTable(node) ? m.showAsList : m.showAsTable, () => toggleTable(id), m.tableCmd)}
        {isTable(node) && node.kind === 'item' && !node.text.trim() && item(<Type size={15} />, m.addTitle, () => s.setFocus({ id, caret: 'end' }))}
        {node.kind === 'page' && item(<Plus size={15} />, m.newSubpage, () => createSubpage(id))}
        {node.kind === 'page' && item(<History size={15} />, m.versions, () => s.set({ history: id }))}
        {(node.kind === 'item' || id !== s.inbox) && item(<Trash2 size={15} />, L.common.delete, () => deleteNode(id, root), node.kind === 'item' ? k.ctrlShiftBackspace : undefined, true)}
      </div>
    </Popover>
  );
}
