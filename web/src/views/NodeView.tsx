// Gezoomte Ansicht eines Knotens (Seite, Eintrag oder Notizbuch-Wurzel).

import { useEffect, useMemo } from 'react';
import { ChevronRight, FilePlus2, FileText, FolderInput, History, Inbox as InboxIcon, Link2, MoreHorizontal, Plus, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { plainText } from '../lib/inline';
import { clearSelection, completeMany, createChild, createSubpage, deleteMany, extendSelection, indentMany, outdentMany, selectRange, toMarkdown, topLevel, visibleList } from '../lib/outline';
import { ancestors, store, typesOf, useStore } from '../lib/store';
import type { Node } from '../lib/types';
import { Markdown } from '../components/Markdown';
import { RichText } from '../components/RichText';
import { BodyEditor } from '../components/outline/BodyEditor';
import { FieldsForm, TaskBox } from '../components/outline/fields';
import { Children, NodeRow, RowMenu } from '../components/outline/NodeRow';
import { TitleEditor } from '../components/outline/TitleEditor';
import type { Anchor } from '../components/ui';

export function Breadcrumbs({ id }: { id: string }) {
  const nodes = useStore((s) => s.nodes);
  const root = useStore((s) => s.root);
  const trail = ancestors(nodes, id);
  return (
    <nav className="crumbs">
      <a onClick={() => store().navigate({ view: 'node', id: root })}>Notizbuch</a>
      {trail.map((a) => (
        <span key={a.id} className="crumb">
          <ChevronRight size={13} />
          <a onClick={() => store().navigate({ view: 'node', id: a.id })}>{a.kind === 'item' ? plainText(a.text, false) || 'Unbenannt' : a.text}</a>
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
  const typed = typesOf(node, types).length > 0 || node.fields.some((f) => f.key !== 'tags');

  const addItem = () => {
    if (isRoot) createSubpage(root);
    else createChild(id, items.length);
  };

  return (
    <div
      className="view node-view"
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('.row-line') && !e.shiftKey && !e.ctrlKey) clearSelection();
      }}
    >
      <div className="view-inner">
        {!isRoot && <Breadcrumbs id={id} />}
        <header className="zoom-head">
          {isRoot ? (
            <h1 className="zoom-title-static">Notizbuch</h1>
          ) : (
            <div className="zoom-title-row">
              {node.kind === 'item' && node.task && <TaskBox node={node} size={20} />}
              {inbox && <InboxIcon className="zoom-icon" size={22} />}
              {node.kind === 'page' && !inbox && <FileText className="zoom-icon" size={22} />}
              <div
                className="zoom-title"
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('a') && id !== store().inbox) store().setFocus({ id, caret: 'end' });
                }}
              >
                {focused && id !== store().inbox ? (
                  <TitleEditor id={id} root={id} className="is-zoom" placeholder={node.kind === 'page' ? 'Seitentitel' : 'Ohne Titel'} />
                ) : (
                  <h1>{node.text ? <RichText text={node.text} source={node} /> : <span className="faint">{node.kind === 'page' ? 'Unbenannt' : 'Ohne Titel'}</span>}</h1>
                )}
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ left: r.left - 200, top: r.top, bottom: r.bottom });
                }}
                aria-label="Aktionen"
              >
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
                  onClose={() => {
                    store().set({ bodyEdit: null });
                  }}
                />
              ) : (
                <Markdown
                  text={node.body}
                  source={node}
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
