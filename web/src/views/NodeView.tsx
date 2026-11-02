// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Gezoomte Ansicht eines Knotens (Seite, Eintrag oder Notizbuch-Wurzel).

import { isCodeNode } from '../lib/code';
import { useEffect, useMemo, useRef } from 'react';
import { ChevronRight, FilePlus2, FileText, FolderInput, History, Inbox as InboxIcon, Link2, MoreHorizontal, Plus, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { plainText } from '../lib/inline';
import { clearSelection, completeMany, createChild, createSubpage, deleteMany, extendSelection, indentMany, outdentMany, selectRange, toMarkdown, topLevel, visibleList } from '../lib/outline';
import { ancestors, isTable, isViewField, store, typesOf, useStore } from '../lib/store';
import { TableBlock } from '../components/outline/Table';
import type { Node } from '../lib/types';
import { Markdown } from '../components/Markdown';
import { hasFiles, imageFiles, imagesToInbox, insertImageNodes, setImageWidth } from '../lib/images';
import { RichText } from '../components/RichText';
import { BodyEditor } from '../components/outline/BodyEditor';
import { FieldsForm, TaskBox } from '../components/outline/fields';
import { Children, NodeRow, RowMenu } from '../components/outline/NodeRow';
import { TitleEditor } from '../components/outline/TitleEditor';
import { startDragSelect } from '../components/outline/dragSelect';
import { RouteLink, type Anchor } from '../components/ui';

export function Breadcrumbs({ id }: { id: string }) {
  const nodes = useStore((s) => s.nodes);
  const root = useStore((s) => s.root);
  const trail = ancestors(nodes, id);
  return (
    <nav className="crumbs" aria-label="Pfad">
      <RouteLink route={{ view: 'node', id: root }}>Notizbuch</RouteLink>
      {trail.map((a) => (
        <span key={a.id} className="crumb">
          <ChevronRight size={13} />
          <RouteLink route={{ view: 'node', id: a.id }}>{a.kind === 'item' ? plainText(a.text, false) || 'Unbenannt' : a.text}</RouteLink>
        </span>
      ))}
    </nav>
  );
}

/** Knoten, die auf `id` verweisen. */
function useBacklinks(id: string): Node[] {
  const nodes = useStore((s) => s.nodes);
  return useMemo(() => {
    const out: Node[] = [];
    for (const n of Object.values(nodes)) {
      if (n.id === id) continue;
      if (n.links?.some((l) => l.id === id)) out.push(n);
    }
    return out.sort((a, b) => a.text.localeCompare(b.text));
  }, [nodes, id]);
}

function Backlinks({ id }: { id: string }) {
  const refs = useBacklinks(id);
  const nodes = useStore((s) => s.nodes);
  if (!refs.length) return null;
  return (
    <section className="backlinks">
      <h3>
        <Link2 size={14} /> Verweise <span className="faint">{refs.length}</span>
      </h3>
      {refs.map((n) => (
        <button key={n.id} className="backlink" onClick={() => store().reveal(n.id)}>
          <span className="backlink-path">
            {ancestors(nodes, n.id)
              .map((a) => (a.kind === 'item' ? plainText(a.text, false) : a.text))
              .join(' › ')}
          </span>
          <span className="backlink-text">
            <RichText text={n.text || '(leer)'} source={n} />
          </span>
        </button>
      ))}
    </section>
  );
}

function isEditable(el: Element | null): boolean {
  return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable || !!el.closest('.cm-editor'));
}

/** Tastatur für mehrere ausgewählte Knoten. */
function useSelectionKeys(root: string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store();
      const sel = s.selection;
      if (!sel.length || isEditable(document.activeElement) || document.querySelector('.overlay')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      let handled = true;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (e.shiftKey) extendSelection(root, dir);
        else {
          const target = dir < 0 ? sel[0] : sel[sel.length - 1];
          clearSelection();
          s.setFocus({ id: target, caret: 'end' });
        }
      } else if (e.key === 'Tab') {
        if (e.shiftKey) outdentMany(sel, root);
        else indentMany(sel);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteMany(sel, root);
      } else if (e.key === 'Escape') {
        clearSelection();
      } else if (e.key === 'Enter') {
        if (mod) completeMany(sel);
        else {
          clearSelection();
          s.setFocus({ id: sel[0], caret: 'end' });
        }
      } else if (mod && k === 'm') {
        s.set({ move: { ids: topLevel(sel) } });
      } else if (mod && (k === 'c' || k === 'x')) {
        void navigator.clipboard.writeText(toMarkdown(sel));
        if (k === 'x') deleteMany(sel, root);
        else s.toast(`${topLevel(sel).length} Einträge kopiert`, 'success');
      } else if (mod && k === 'a') {
        const list = visibleList(root);
        if (list.length) selectRange(root, list[0], list[list.length - 1]);
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [root]);
}

export function NodeView({ id, inbox }: { id: string; inbox?: boolean }) {
  const node = useStore((s) => s.nodes[id]);
  const root = useStore((s) => s.root);
  const focused = useStore((s) => s.focus?.id === id);
  const bodyEdit = useStore((s) => s.bodyEdit === id);
  const types = useStore((s) => s.types);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  useSelectionKeys(id);

  if (!node) {
    return (
      <div className="view">
        <div className="empty">
          <h3>Diesen Eintrag gibt es nicht mehr.</h3>
          <button className="btn" onClick={() => store().navigate({ view: 'node', id: root })}>
            Zum Notizbuch
          </button>
        </div>
      </div>
    );
  }

  const isRoot = node.kind === 'root';
  const items = node.children.filter((c) => store().nodes[c]?.kind === 'item');
  const typed = typesOf(node, types).length > 0 || node.fields.some((f) => f.key !== 'tags' && !isViewField(f.key));
  const table = isTable(node);

  const addItem = () => {
    if (isRoot) createSubpage(root);
    else createChild(id, items.length);
  };
  const editableTitle = id !== store().inbox;
  const openMenu = () => {
    const r = menuBtn.current?.getBoundingClientRect();
    if (r) setMenu({ left: r.left - 200, top: r.top, bottom: r.bottom });
  };

  return (
    <div
      className="view node-view"
      onMouseDown={(e) => {
        // Klick neben die Einträge (auch in eine Tabelle) hebt die Auswahl auf.
        const t = e.target as HTMLElement;
        if ((!t.closest('.row-line') || t.closest('.ot-wrap')) && !e.shiftKey && !e.ctrlKey) clearSelection();
        // Ziehen über mehrere Einträge wählt sie aus (innerhalb eines Eintrags: Text).
        startDragSelect(e, id, e.currentTarget);
      }}
      // Bilder neben die Einträge gezogen: als neue Einträge am Ende (im Notizbuch: in die Inbox)
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const files = imageFiles(e.dataTransfer);
        if (!files.length) return store().toast('Nur Bilder lassen sich hier ablegen', 'info');
        if (isRoot) void imagesToInbox(files);
        else void insertImageNodes(id, undefined, files);
      }}
    >
      <div className="view-inner">
        {!isRoot && <Breadcrumbs id={id} />}
        <header className="zoom-head">
          {isRoot ? (
            <h1 className="zoom-title-static">Notizbuch</h1>
          ) : (
            <div
              className="zoom-title-row"
              onContextMenu={(e) => {
                // Auch Umschalt+F10 und die Menütaste im Titel.
                e.preventDefault();
                openMenu();
              }}
            >
              {node.kind === 'item' && node.task && <TaskBox node={node} size={20} />}
              {inbox && <InboxIcon className="zoom-icon" size={22} />}
              {node.kind === 'page' && !inbox && <FileText className="zoom-icon" size={22} />}
              <div
                className="zoom-title"
                // Per Tab erreichbar; der Fokus öffnet den Titel zum Bearbeiten.
                tabIndex={editableTitle && !focused ? 0 : undefined}
                aria-label={editableTitle && !focused ? 'Titel bearbeiten' : undefined}
                onFocus={(e) => {
                  if (e.target === e.currentTarget && e.currentTarget.matches(':focus-visible') && editableTitle && !focused) store().setFocus({ id, caret: 'end' });
                }}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('a') && editableTitle) store().setFocus({ id, caret: 'end' });
                }}
              >
                {focused && editableTitle ? (
                  <TitleEditor id={id} root={id} className="is-zoom" placeholder={node.kind === 'page' ? 'Seitentitel' : 'Ohne Titel'} />
                ) : (
                  <h1>{node.text ? <RichText text={node.text} source={node} /> : <span className="faint">{node.kind === 'page' ? 'Unbenannt' : isCodeNode(node) ? 'Codeblock' : 'Ohne Titel'}</span>}</h1>
                )}
              </div>
              <button ref={menuBtn} className="btn btn-ghost btn-icon" onClick={openMenu} aria-label="Aktionen" title="Aktionen (Umschalt+F10)" aria-haspopup="menu">
                <MoreHorizontal size={17} />
              </button>
            </div>
          )}
          {!isRoot && typed && <FieldsForm node={node} />}
          {!isRoot && (bodyEdit || node.body) && (
            <div className="zoom-body">
              {bodyEdit ? (
                <BodyEditor
                  id={id}
                  onClose={(focusTitle) => {
                    store().set({ bodyEdit: null });
                    // Esc bzw. Umschalt+Enter: zurück in den Titel.
                    if (focusTitle && editableTitle) store().setFocus({ id, caret: 'end' });
                  }}
                />
              ) : (
                <Markdown
                  text={node.body}
                  source={node}
                  onImageResize={(href, k, w) => setImageWidth(id, href, k, w)}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('pre') && e.detail < 2) return;
                    if (window.getSelection()?.toString()) return;
                    store().set({ bodyEdit: id });
                  }}
                />
              )}
            </div>
          )}
          {!isRoot && !bodyEdit && !node.body && (
            <div className="zoom-tools">
              <button className="btn btn-ghost btn-sm" onClick={() => store().set({ bodyEdit: id })}>
                <StickyNote size={14} /> Notiz
              </button>
              {node.kind === 'page' && (
                <button className="btn btn-ghost btn-sm" onClick={() => createSubpage(id)}>
                  <FilePlus2 size={14} /> Unterseite
                </button>
              )}
              {node.kind === 'page' && (
                <button className="btn btn-ghost btn-sm" onClick={() => store().set({ history: id })}>
                  <History size={14} /> Versionen
                </button>
              )}
              {node.kind === 'item' && (
                <button className="btn btn-ghost btn-sm" onClick={() => store().set({ move: { ids: [id] } })}>
                  <FolderInput size={14} /> Einsortieren
                </button>
              )}
            </div>
          )}
        </header>

        {inbox && items.length > 0 && (
          <div className="inbox-hint">
            Alles Neue landet hier. <b>Einsortieren</b> verschiebt einen Eintrag an seinen Platz (<kbd>Strg</kbd> <kbd>M</kbd>), <b>Zuordnen</b> vergibt Tags oder Links (<kbd>#</kbd> <kbd>@</kbd>), <kbd>/</kbd> setzt Termine.
          </div>
        )}

        <div className={`outline${isRoot ? ' is-root' : ''}`}>
          {inbox ? (
            node.children.map((c) => <NodeRow key={c} id={c} root={id} inbox />)
          ) : table ? (
            <>
              <TableBlock table={id} root={id} />
              {/* Unterseiten einer Tabellen-Seite stehen darunter. */}
              {node.children
                .filter((c) => store().nodes[c]?.kind === 'page')
                .map((c) => (
                  <NodeRow key={c} id={c} root={id} />
                ))}
            </>
          ) : (
            <Children parent={id} root={id} />
          )}
          {node.children.length === 0 && (
            <button className="outline-empty" onClick={addItem}>
              {inbox ? 'Die Inbox ist leer. Neue Ideen mit Strg+Umschalt+Leertaste, Strg+N oder hier.' : isRoot ? 'Noch keine Seiten. Klicke hier, um die erste anzulegen.' : 'Leer. Klicke hier oder drücke Enter im Titel, um zu schreiben.'}
            </button>
          )}
          <button className="outline-add" onClick={addItem}>
            <Plus size={14} /> {isRoot ? 'Neue Seite' : 'Neuer Eintrag'}
          </button>
        </div>

        {!isRoot && <Backlinks id={id} />}
      </div>
      {menu && <RowMenu node={node} root={node.parent ?? root} anchor={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
