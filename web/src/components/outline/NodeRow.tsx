// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Eine Zeile der Gliederung (rekursiv mit Kindern).

import { memo, useState, type DragEvent, type MouseEvent } from 'react';
import { ChevronRight, CircleCheck, CircleDot, Copy, FileOutput, FileText, FolderInput, History, MoreHorizontal, Plus, StickyNote, Tag, Trash2, ZoomIn } from 'lucide-react';
import { createSubpage, cycleTask, deleteNode, moveInto, selectRange, toggleSelected, toggleTodo, toPage } from '../../lib/outline';
import { isAncestor, isCollapsed, store, typesOf, useStore } from '../../lib/store';
import type { Node } from '../../lib/types';
import { isCodeNode } from '../../lib/code';
import { Markdown } from '../Markdown';
import { caretFromClick, RichText } from '../RichText';
import { Popover, type Anchor } from '../ui';
import { BodyEditor } from './BodyEditor';
import { CodeBlock } from './CodeBlock';
import { MetaChips, TaskBox } from './fields';
import { copyLink, TitleEditor } from './TitleEditor';

let dragId: string | null = null;

type DropPos = 'before' | 'after' | 'into';

function dropPosition(e: DragEvent, el: HTMLElement): DropPos {
  const r = el.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (y < 0.3) return 'before';
  if (y > 0.7) return 'after';
  return 'into';
}

function canDrop(drag: string, target: string, pos: DropPos): boolean {
  const { nodes } = store();
  const d = nodes[drag];
  const t = nodes[target];
  if (!d || !t || drag === target || isAncestor(nodes, drag, target)) return false;
  const parent = pos === 'into' ? t : nodes[t.parent ?? ''];
  if (!parent) return false;
  if (d.kind === 'page') return parent.kind !== 'item' && pos === 'into';
  return parent.kind !== 'root';
}

function drop(drag: string, target: string, pos: DropPos) {
  const s = store();
  const t = s.nodes[target];
  if (pos === 'into') {
    moveInto([drag], target);
    if (t.kind === 'item') s.setCollapsed(target, false);
    return;
  }
  const parent = s.nodes[t.parent!];
  const items = parent.children.filter((c) => s.nodes[c]?.kind === 'item' && c !== drag);
  const idx = items.indexOf(target) + (pos === 'after' ? 1 : 0);
  s.commit([{ op: 'move', id: drag, parent: parent.id, index: idx }]);
}

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

  const startEdit = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, .chip')) return;
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

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ left: r.left, top: r.top, bottom: r.bottom });
  };

  return (
    <div className={`row${flash ? ' is-flash' : ''}${closed ? ' is-closed' : ''}`} data-id={id}>
      <div
        className={`row-line${focused ? ' is-focused' : ''}${selected ? ' is-selected' : ''}${dropAt ? ` drop-${dropAt}` : ''}${heading ? ` is-h${heading}` : ''}${isPage ? ' is-page' : ''}${code ? ' is-code' : ''}`}
        onDragOver={(e) => {
          if (!dragId) return;
          const pos = dropPosition(e, e.currentTarget);
          if (!canDrop(dragId, id, pos)) {
            setDropAt(null);
            return;
          }
          e.preventDefault();
          setDropAt(pos);
        }}
        onDragLeave={() => setDropAt(null)}
        onDrop={(e) => {
          e.preventDefault();
          const pos = dropAt;
          setDropAt(null);
          if (dragId && pos) drop(dragId, id, pos);
          dragId = null;
        }}
        onContextMenu={openMenu}
      >
        <span className="row-gutter">
          {hasKids && (
            <button className={`row-fold${collapsed ? '' : ' is-open'}`} onMouseDown={(e) => e.preventDefault()} onClick={() => store().setCollapsed(id, !collapsed)} aria-label={collapsed ? 'Aufklappen' : 'Zuklappen'}>
              <ChevronRight size={14} />
            </button>
          )}
          <a
            className={`bullet${hasKids && collapsed ? ' has-hidden' : ''}${isPage ? ' is-page' : ''}`}
            style={color ? { ['--type-color' as string]: `var(--t-${color})` } : undefined}
            draggable
            onDragStart={(e) => {
              dragId = id;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', node.text);
            }}
            onDragEnd={() => (dragId = null)}
            onClick={(e) => {
              e.preventDefault();
              store().zoom(id);
            }}
            title={isPage ? 'Seite öffnen' : 'Hineinzoomen'}
          >
            {isPage ? <FileText size={14} /> : <span className="dot" />}
          </a>
        </span>
        {node.task && <TaskBox node={node} />}
        <div className="row-content" onClick={code ? undefined : startEdit}>
          {code ? (
            <CodeBlock id={id} root={root} focused={focused} />
          ) : focused ? (
            <TitleEditor id={id} root={root} placeholder={isPage ? 'Seitentitel' : undefined} />
          ) : (
            <div className={`row-text${node.text ? '' : ' is-empty'}`}>{node.text ? <RichText text={node.text} source={node} /> : '​'}</div>
          )}
          {!isPage && !code && <MetaChips node={node} />}
        </div>
        <span className="row-actions">
          {inbox && !isPage && !code && (
            <button className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => store().set({ move: { ids: [id] } })} title="Einsortieren (Strg+M)">
              <FolderInput size={14} /> Einsortieren
            </button>
          )}
          {inbox && !isPage && !code && (
            <button className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => store().set({ assign: { id } })} title="Zuordnen: Tag oder Link vergeben">
              <Tag size={14} /> Zuordnen
            </button>
          )}
          <button className="btn btn-ghost btn-icon btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={openMenu} aria-label="Aktionen">
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
            onClick={(e) => {
              // Im Code darf man markieren und kopieren; Doppelklick bearbeitet trotzdem.
              if ((e.target as HTMLElement).closest('pre') && e.detail < 2) return;
              if (window.getSelection()?.toString()) return;
              store().set({ bodyEdit: id });
            }}
          />
        </div>
      ) : null}
      {hasKids && !collapsed && <Children parent={id} root={root} />}
      {menu && <RowMenu node={node} root={root} anchor={menu} onClose={() => setMenu(null)} />}
    </div>
  );
});

export function RowMenu({ node, root, anchor, onClose }: { node: Node; root: string; anchor: Anchor; onClose: () => void }) {
  const s = store();
  const id = node.id;
  const item = (icon: React.ReactNode, label: string, run: () => void, hint?: string, danger?: boolean) => (
    <button
      className={`menu-item${danger ? ' is-danger' : ''}`}
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
    <Popover anchor={anchor} onClose={onClose} width={240}>
      <div className="menu">
        {item(<ZoomIn size={15} />, node.kind === 'page' ? 'Seite öffnen' : 'Hineinzoomen', () => s.zoom(id), 'Alt+→')}
        {node.kind === 'item' && item(<StickyNote size={15} />, node.body ? 'Notiz bearbeiten' : 'Notiz hinzufügen', () => s.set({ bodyEdit: id }), 'Umschalt+↵')}
        {node.kind === 'item' && item(node.task ? <CircleCheck size={15} /> : <CircleDot size={15} />, node.task ? (node.task === 'done' ? 'Wieder öffnen' : 'Erledigen') : 'Als Todo', () => (node.task ? cycleTask(id) : toggleTodo(id)), 'Strg+↵')}
        {node.task && node.kind === 'item' && item(<CircleDot size={15} />, 'Kein Todo mehr', () => toggleTodo(id))}
        {item(<FolderInput size={15} />, 'Einsortieren …', () => s.set({ move: { ids: [id] } }), 'Strg+M')}
        {node.kind === 'item' && item(<Tag size={15} />, 'Zuordnen …', () => s.set({ assign: { id } }))}
        {item(<Copy size={15} />, 'Link kopieren', () => void copyLink(id), 'Strg+L')}
        {node.kind === 'item' && item(<FileOutput size={15} />, 'Als Seite auslagern', () => void toPage(id))}
        {node.kind === 'page' && item(<Plus size={15} />, 'Unterseite anlegen', () => createSubpage(id))}
        {node.kind === 'page' && item(<History size={15} />, 'Versionen …', () => s.set({ history: id }))}
        {(node.kind === 'item' || id !== s.inbox) && item(<Trash2 size={15} />, 'Löschen', () => deleteNode(id, root), node.kind === 'item' ? 'Strg+⇧+⌫' : undefined, true)}
      </div>
    </Popover>
  );
}
