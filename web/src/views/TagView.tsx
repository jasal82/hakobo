// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Alle Knoten mit einem Tag (inklusive Unter-Tags), gruppiert nach Seite.

import { useMemo, useState } from 'react';
import { ChevronRight, FileText, Hash, Search, Table2, Wand2 } from 'lucide-react';
import { compareText, L } from '../i18n';
import { plainText } from '../lib/inline';
import { pageOf, store, useStore } from '../lib/store';
import type { Node } from '../lib/types';
import { RichText } from '../components/RichText';
import { MetaChips, TaskBox } from '../components/outline/fields';
import { activateKeys, moveFocus, RouteLink } from '../components/ui';
import { pathOf } from './parts/common';
import { TypeEditor } from './parts/TypeEditor';

type Filter = 'all' | 'open' | 'done';

function matches(n: Node, tag: string): boolean {
  return n.tags.some((t) => t === tag || t.startsWith(tag + '/'));
}

/** Reihenfolge im Dokument (Tiefensuche ab der Wurzel). */
function documentOrder(nodes: Record<string, Node>, root: string): Map<string, number> {
  const order = new Map<string, number>();
  let i = 0;
  const stack = [root];
  while (stack.length) {
    const id = stack.pop()!;
    order.set(id, i++);
    const kids = nodes[id]?.children ?? [];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return order;
}

function TagRow({ n, page }: { n: Node; page: Node | undefined }) {
  const nodes = useStore((s) => s.nodes);
  const isPage = n.kind === 'page';
  const path = page && !isPage ? pathOf(nodes, n.id, page.id) : '';
  return (
    <div
      className={`tg-row${n.task === 'done' || n.task === 'cancelled' ? ' is-closed' : ''}`}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button, .chip')) return;
        store().reveal(n.id, { edit: !isPage });
      }}
      onKeyDown={activateKeys(() => store().reveal(n.id, { edit: !isPage }))}
    >
      {path && <div className="tg-path">{path}</div>}
      <div className="tg-line">
        {isPage ? <FileText size={14} className="tg-page-icon" /> : n.task ? <TaskBox node={n} /> : <span className="tg-bullet" />}
        <span className="tg-text">{n.text ? <RichText text={n.text} source={n} /> : <span className="faint">{L.types.empty}</span>}</span>
        {!isPage && <MetaChips node={n} />}
      </div>
      {n.body && <div className="tg-body">{plainText(n.body.split('\n').find((l) => l.trim() && !l.startsWith('```')) ?? '').slice(0, 180)}</div>}
    </div>
  );
}

export function TagView({ tag }: { tag: string }) {
  const nodes = useStore((s) => s.nodes);
  const root = useStore((s) => s.root);
  const types = useStore((s) => s.types);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState(false);
  const t = tag.toLowerCase();
  const segments = t.split('/');

  const all = useMemo(() => Object.values(nodes).filter((n) => n.kind !== 'root' && matches(n, t)), [nodes, t]);

  const subTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of Object.values(nodes)) {
      for (const x of n.tags) {
        if (!x.startsWith(t + '/')) continue;
        const next = x.slice(t.length + 1).split('/')[0];
        if (next) counts.set(next, (counts.get(next) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => compareText(a[0], b[0]));
  }, [nodes, t]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order = documentOrder(nodes, root);
    const list = all.filter((n) => {
      if (filter === 'open' && !(n.task === 'open' || n.task === 'doing')) return false;
      if (filter === 'done' && !(n.task === 'done' || n.task === 'cancelled')) return false;
      if (q && !`${plainText(n.text)} ${n.body}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const byPage = new Map<string, { page: Node | undefined; items: Node[] }>();
    for (const n of list) {
      const p = pageOf(nodes, n.id);
      const key = p?.id ?? '';
      if (!byPage.has(key)) byPage.set(key, { page: p, items: [] });
      byPage.get(key)!.items.push(n);
    }
    return [...byPage.values()];
  }, [all, filter, query, nodes, root]);

  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const openCount = all.filter((n) => n.task === 'open' || n.task === 'doing').length;
  const doneCount = all.filter((n) => n.task === 'done' || n.task === 'cancelled').length;
  const isType = !!types[t];

  return (
    <div
      className="view tg-view"
      onKeyDown={(e) => {
        // ↑ ↓ zwischen den Einträgen.
        if ((e.target as HTMLElement).matches('.tg-row')) moveFocus(e, e.currentTarget, '.tg-row');
      }}
    >
      <div className="view-inner">
        <div className="tg-head">
          <h1 className="tg-title">
            <Hash size={22} className="tg-hash" />
            {segments.map((s, i) => {
              const full = segments.slice(0, i + 1).join('/');
              const last = i === segments.length - 1;
              return (
                <span key={full} className="tg-seg">
                  {i > 0 && <ChevronRight size={16} className="tg-sep" />}
                  {last ? <span>{s}</span> : <RouteLink route={{ view: 'tag', tag: full }}>{s}</RouteLink>}
                </span>
              );
            })}
          </h1>
          <span className="tg-count">{L.types.tag.count(all.length)}</span>
          <span className="spacer" />
          {isType ? (
            <button className="btn btn-sm" onClick={() => store().navigate({ view: 'type', type: t })}>
              <Table2 size={14} /> {L.types.tag.asTable}
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditor(true)} title={L.types.tag.makeTypeTitle}>
              <Wand2 size={14} /> {L.types.tag.makeType}
            </button>
          )}
        </div>

        {subTags.length > 0 && (
          <div className="tg-subtags">
            {subTags.map(([name, count]) => (
              <button key={name} className="chip tg-subtag" onClick={() => store().navigate({ view: 'tag', tag: `${t}/${name}` })}>
                <Hash size={11} />
                {name}
                <span className="faint">{count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="tg-filters">
          <div className="tabs">
            <button className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
              {L.types.tag.all}
            </button>
            <button className={filter === 'open' ? 'is-active' : ''} onClick={() => setFilter('open')}>
              {L.types.tag.open} {openCount > 0 && <span className="faint">{openCount}</span>}
            </button>
            <button className={filter === 'done' ? 'is-active' : ''} onClick={() => setFilter('done')}>
              {L.common.done} {doneCount > 0 && <span className="faint">{doneCount}</span>}
            </button>
          </div>
          <label className="tg-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L.types.filter} />
          </label>
        </div>

        {all.length === 0 ? (
          <div className="empty">
            <Hash size={28} />
            <h3>{L.types.tag.nothing(t)}</h3>
            <p>{L.types.tag.help(t)}</p>
          </div>
        ) : shown === 0 ? (
          <div className="empty">
            <h3>{L.types.tag.noMatches}</h3>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.page?.id ?? 'none'} className="tg-group">
              <h2 className="tg-group-head">
                <FileText size={13} />
                {g.page ? <RouteLink route={{ view: 'node', id: g.page.id }}>{g.page.path ?? g.page.text}</RouteLink> : L.types.tag.noPage}
                <span className="faint">{g.items.length}</span>
              </h2>
              {g.items.map((n) => (
                <TagRow key={n.id} n={n} page={g.page} />
              ))}
            </section>
          ))
        )}
      </div>
      {editor && <TypeEditor typeKey={t} isNew onClose={() => setEditor(false)} onSaved={() => store().navigate({ view: 'type', type: t })} />}
    </div>
  );
}
