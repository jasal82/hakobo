// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Suche (Strg+K): Fuzzy-Treffer links, Vorschau des aktiven Treffers rechts.

import { isCodeNode } from '../lib/code';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Clock, CornerDownLeft, FileText, Link2, Search } from 'lucide-react';
import { api } from '../lib/api';
import { humanWhen, urgency } from '../lib/dates';
import { linkTextFor } from '../lib/links';
import { field, store, useStore } from '../lib/store';
import type { Hit, Node } from '../lib/types';
import { Markdown } from './Markdown';
import { RichText } from './RichText';
import { MetaChips, TaskBox } from './outline/fields';
import { NodeIcon, nodeTitle, PathLine, pathTitles, pushRecent, readRecent, trackRecent, useListKeys } from './search/common';
import { Dialog, Highlighted, useScrollActive } from './ui';

trackRecent();

const QUERY_HINTS: [string, string, string][] = [
  ['#', '#tag', 'mit Tag (auch Unter-Tags)'],
  ['-#', '-#tag', 'ohne Tag'],
  ['is:open ', 'is:open', 'offene Todos'],
  ['is:done ', 'is:done', 'erledigte Todos'],
  ['has:date ', 'has:date', 'mit Datum'],
  ['date:heute ', 'date:heute', 'heute fällig'],
  ['date:woche ', 'date:woche', 'nächste 7 Tage'],
  ['in:', 'in:Seite', 'unterhalb einer Seite'],
  ['"', '"genaue Phrase"', 'wörtlich'],
];

function emptyHit(id: string): Hit {
  return { id, score: 0, titleRanges: [], pathRanges: [], snippet: null, matchedTags: [] };
}

async function copyLinkTo(id: string) {
  const link = await linkTextFor(store().nodes, id, api.link);
  await navigator.clipboard.writeText(link);
  store().toast(`Link kopiert: ${link}`, 'success');
}

export function SearchPalette() {
  const [q, setQ] = useState(() => store().searchQuery);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nodes = useStore((s) => s.nodes);
  const inbox = useStore((s) => s.inbox);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (store().searchQuery) store().set({ searchQuery: '' });
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Sofort bei jeder Eingabe suchen; veraltete Anfragen abbrechen.
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      api.search(q, 60, ac.signal).then(
        (r) => {
          setHits(r.hits);
          setLoading(false);
          setError(null);
        },
        (e: Error) => {
          if (e.name !== 'AbortError') {
            setError(e.message);
            setLoading(false);
          }
        },
      );
    }, 10);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [q]);

  const recent = useMemo(() => readRecent().filter((id) => nodes[id] && nodes[id].kind !== 'root').slice(0, 12), [nodes]);
  const list: Hit[] = (q.trim() ? hits : recent.map(emptyHit)).filter((h) => nodes[h.id]);
  const { active, setActive, onKey } = useListKeys(list.length, [q, hits]);
  useScrollActive(listRef, active);
  const current = list[active];

  const close = () => store().set({ searchOpen: false });
  const open = (id: string, zoom = false) => {
    pushRecent(id);
    close();
    if (zoom) store().zoom(id);
    else store().reveal(id, { edit: nodes[id]?.kind === 'item' });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onKey(e)) return;
    if (e.key === 'Enter' && current) {
      e.preventDefault();
      if (e.altKey) {
        void copyLinkTo(current.id);
        return;
      }
      open(current.id, e.ctrlKey || e.metaKey);
    }
  };

  const insertHint = (text: string) => {
    const base = q && !/\s$/.test(q) ? `${q} ` : q;
    setQ(base + text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const pos = text === '"' ? el.value.length : el.value.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <Dialog onClose={close} width={1000} className="search-dialog">
      <div className="sp">
        <div className="sp-left">
          <div className="sp-input">
            <Search size={17} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Suchen … z. B. rechnung #kunde is:open"
              spellCheck={false}
              autoComplete="off"
            />
            {loading && <span className="spinner" />}
          </div>
          <div className="sp-list" ref={listRef}>
            {!q.trim() && (
              <>
                <div className="sp-hints">
                  {QUERY_HINTS.map(([insert, label, title]) => (
                    <button key={label} className="chip sp-hint" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => insertHint(insert)}>
                      {label}
                    </button>
                  ))}
                </div>
                {list.length > 0 && (
                  <div className="menu-section">
                    <Clock size={11} /> Zuletzt geöffnet
                  </div>
                )}
              </>
            )}
            {list.map((h, i) => (
              <HitRow key={h.id} hit={h} node={nodes[h.id]} nodes={nodes} inbox={inbox} active={i === active} onHover={() => setActive(i)} onOpen={(zoom) => open(h.id, zoom)} />
            ))}
            {q.trim() && !loading && !list.length && !error && (
              <div className="sp-empty">
                <b>Keine Treffer.</b>
                <span>Tipp: Wörter dürfen unvollständig sein („rech kund“), Tippfehler werden toleriert, Filter wie #tag oder is:open grenzen ein.</span>
              </div>
            )}
            {error && <div className="sp-empty is-error">{error}</div>}
            {!q.trim() && !list.length && <div className="sp-empty">Tippen, um Seiten, Einträge, Notizen und Code zu durchsuchen.</div>}
          </div>
          <div className="sp-foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> wählen
            </span>
            <span>
              <kbd>↵</kbd> öffnen
            </span>
            <span>
              <kbd>Strg</kbd>
              <kbd>↵</kbd> hineinzoomen
            </span>
            <span>
              <kbd>Alt</kbd>
              <kbd>↵</kbd> Link kopieren
            </span>
            <span className="spacer" />
            {q.trim() && list.length > 0 && <span className="faint">{list.length >= 60 ? '60+' : list.length} Treffer</span>}
          </div>
        </div>
        <div className="sp-preview">{current ? <Preview id={current.id} onOpen={open} /> : <div className="sp-preview-empty">Keine Vorschau</div>}</div>
      </div>
    </Dialog>
  );
}

const HitRow = memo(function HitRow({
  hit,
  node,
  nodes,
  inbox,
  active,
  onHover,
  onOpen,
}: {
  hit: Hit;
  node: Node;
  nodes: Record<string, Node>;
  inbox: string;
  active: boolean;
  onHover: () => void;
  onOpen: (zoom: boolean) => void;
}) {
  const date = field(node, 'date') ?? field(node, 'due');
  const u = node.task === 'done' || node.task === 'cancelled' ? null : urgency(date);
  const closed = node.task === 'done' || node.task === 'cancelled';
  const title = nodeTitle(node);
  return (
    <button
      className={`sp-row${active ? ' is-active' : ''}${closed ? ' is-closed' : ''}`}
      onMouseMove={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onOpen(e.ctrlKey || e.metaKey)}
    >
      <span className="sp-icon">
        <NodeIcon n={node} inbox={inbox} />
      </span>
      <span className="sp-main">
        <span className="sp-title">
          {title ? <Highlighted text={title} ranges={hit.titleRanges} /> : <span className="faint">(leer)</span>}
          {date && <span className={`chip sp-date${u === 'overdue' ? ' is-overdue' : u === 'today' ? ' is-today' : u === 'soon' ? ' is-soon' : ''}`}>{humanWhen(date)}</span>}
        </span>
        <PathLine parts={pathTitles(nodes, node.id)} ranges={hit.pathRanges} />
        {hit.snippet && (
          <span className="sp-snippet">
            <Highlighted text={hit.snippet.text} ranges={hit.snippet.ranges} />
          </span>
        )}
        {hit.matchedTags.length > 0 && (
          <span className="sp-tags">
            {hit.matchedTags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </span>
        )}
      </span>
      {active && <CornerDownLeft size={14} className="sp-enter" />}
    </button>
  );
});

/** Lesende Darstellung der ersten Kinder (2 Ebenen, max. `limit` Zeilen). */
function PreviewChildren({ ids, nodes, depth, budget, onOpen }: { ids: string[]; nodes: Record<string, Node>; depth: number; budget: { left: number }; onOpen: (id: string) => void }) {
  const rows: React.ReactNode[] = [];
  for (const id of ids) {
    if (budget.left <= 0) break;
    const n = nodes[id];
    if (!n) continue;
    budget.left--;
    const closed = n.task === 'done' || n.task === 'cancelled';
    const kids = n.children.filter((c) => nodes[c]);
    rows.push(
      <div key={id} className="pv-child">
        <div className={`pv-line${closed ? ' is-closed' : ''}`} onClick={() => onOpen(id)}>
          <span className="pv-bullet">{n.kind === 'page' ? <FileText size={12} /> : n.task ? <span className={`pv-box is-${n.task}`} /> : <span className={`pv-dot${kids.length ? ' has-kids' : ''}`} />}</span>
          <span className="pv-text">{n.text ? <RichText text={n.text} source={n} /> : <span className="faint">(leer)</span>}</span>
          {(field(n, 'date') ?? field(n, 'due')) && <span className="chip pv-date">{humanWhen(field(n, 'date') ?? field(n, 'due'))}</span>}
        </div>
        {depth < 1 && kids.length > 0 && n.kind === 'item' && (
          <div className="pv-children">
            <PreviewChildren ids={kids} nodes={nodes} depth={depth + 1} budget={budget} onOpen={onOpen} />
          </div>
        )}
      </div>,
    );
  }
  return <>{rows}</>;
}

function Preview({ id, onOpen }: { id: string; onOpen: (id: string, zoom?: boolean) => void }) {
  const nodes = useStore((s) => s.nodes);
  const n = nodes[id];
  const backlinks = useMemo(() => Object.values(nodes).filter((x) => x.id !== id && x.links?.some((l) => l.id === id)).length, [nodes, id]);
  if (!n) return null;
  const path = pathTitles(nodes, id);
  const budget = { left: 40 };
  const total = n.children.length;
  return (
    <div className="pv">
      {path.length > 0 && (
        <div className="pv-crumbs">
          {path.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="sp-sep"> › </span>}
              {p}
            </span>
          ))}
        </div>
      )}
      <div className="pv-head">
        {n.kind === 'item' && n.task && <TaskBox node={n} size={17} />}
        {n.kind === 'page' && <FileText size={18} className="pv-page-icon" />}
        <h2 className={n.task === 'done' || n.task === 'cancelled' ? 'is-closed' : undefined}>{n.text ? <RichText text={n.text} source={n} /> : <span className="faint">{isCodeNode(n) ? 'Codeblock' : 'Ohne Titel'}</span>}</h2>
      </div>
      {n.kind !== 'root' && (
        <div className="pv-meta">
          <MetaChips node={n} />
          {n.tags
            .filter((t) => !n.text.toLowerCase().includes(`#${t}`))
            .map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
        </div>
      )}
      {n.body && (
        <div className="pv-body">
          <Markdown text={n.body} source={n} />
        </div>
      )}
      {total > 0 && (
        <div className="pv-kids">
          <PreviewChildren ids={n.children} nodes={nodes} depth={0} budget={budget} onOpen={(cid) => onOpen(cid)} />
          {budget.left <= 0 && <div className="pv-more">… weitere Einträge</div>}
        </div>
      )}
      {!n.body && !total && <div className="pv-empty">Keine Notiz und keine Unterpunkte.</div>}
      <div className="pv-foot">
        {backlinks > 0 && (
          <span className="pv-backlinks">
            <Link2 size={13} /> {backlinks} {backlinks === 1 ? 'Verweis' : 'Verweise'}
          </span>
        )}
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onOpen(id, true)}>
          Hineinzoomen <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
