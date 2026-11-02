// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Alle Todos: nach Fälligkeit gruppiert, undatierte nach Seite.

import { useMemo, useState } from 'react';
import { CheckCircle2, ListTodo, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { addDays, parseWhen, startOfDay } from '../lib/dates';
import { plainText } from '../lib/inline';
import { ancestors, field, pageOf, store, useStore } from '../lib/store';
import type { Node } from '../lib/types';
import { RichText } from '../components/RichText';
import { MetaChips, TaskBox } from '../components/outline/fields';
import { moveFocus } from '../components/ui';
import { L } from '../i18n';

type Group = { key: string; title: string; tone?: 'danger' | 'warn' | 'accent'; items: Node[] };

function dueOf(n: Node): Date | null {
  const w = parseWhen(field(n, 'date') ?? field(n, 'due'));
  return w ? startOfDay(w.start) : null;
}

function TodoRow({ n }: { n: Node }) {
  const nodes = useStore((s) => s.nodes);
  const path = ancestors(nodes, n.id)
    .map((a) => (a.kind === 'item' ? plainText(a.text, false) : a.text))
    .join(' › ');
  return (
    <div className={`todo-row${n.task === 'done' || n.task === 'cancelled' ? ' is-closed' : ''}`}>
      <TaskBox node={n} />
      <button className="todo-main" onClick={() => store().reveal(n.id, { edit: true })}>
        <span className="todo-text">
          <RichText text={n.text || L.views.todo.noText} source={n} />
        </span>
        <span className="todo-path">{path}</span>
      </button>
      <MetaChips node={n} />
    </div>
  );
}

export function TodoView() {
  const nodes = useStore((s) => s.nodes);
  const [show, setShow] = useState<'open' | 'done'>('open');
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState('');

  const groups = useMemo<Group[]>(() => {
    const today = startOfDay();
    const tomorrow = addDays(today, 1);
    const week = addDays(today, 7);
    const q = filter.trim().toLowerCase();
    const tagFilters = q.split(/\s+/).filter((w) => w.startsWith('#')).map((w) => w.slice(1));
    const words = q.split(/\s+/).filter((w) => w && !w.startsWith('#'));
    const match = (n: Node) => {
      if (tagFilters.some((t) => !n.tags.some((x) => x === t || x.startsWith(t + '/')))) return false;
      const text = (plainText(n.text) + ' ' + (pageOf(nodes, n.id)?.text ?? '')).toLowerCase();
      return words.every((w) => text.includes(w));
    };
    const todos = Object.values(nodes).filter((n) => n.kind === 'item' && n.task && match(n));
    if (show === 'done') {
      const cutoff = addDays(today, -14);
      const done = todos
        .filter((n) => n.task === 'done' || n.task === 'cancelled')
        .map((n) => ({ n, at: parseWhen(field(n, 'done'))?.start ?? null }))
        .filter((x) => !x.at || x.at >= cutoff)
        .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
      return [{ key: 'done', title: L.views.todo.doneRecent, items: done.map((x) => x.n) }];
    }
    const open = todos.filter((n) => n.task === 'open' || n.task === 'doing');
    const g: Record<string, Group> = {
      overdue: { key: 'overdue', title: L.views.todo.overdue, tone: 'danger', items: [] },
      doing: { key: 'doing', title: L.views.todo.doing, tone: 'accent', items: [] },
      today: { key: 'today', title: L.common.today, tone: 'warn', items: [] },
      tomorrow: { key: 'tomorrow', title: L.common.tomorrow, items: [] },
      week: { key: 'week', title: L.views.todo.next7, items: [] },
      later: { key: 'later', title: L.views.todo.later, items: [] },
    };
    const undated = new Map<string, Group>();
    for (const n of open) {
      const due = dueOf(n);
      if (due && due < today) g.overdue.items.push(n);
      else if (due && due.getTime() === today.getTime()) g.today.items.push(n);
      else if (n.task === 'doing') g.doing.items.push(n);
      else if (due && due.getTime() === tomorrow.getTime()) g.tomorrow.items.push(n);
      else if (due && due <= week) g.week.items.push(n);
      else if (due) g.later.items.push(n);
      else {
        const page = pageOf(nodes, n.id);
        const key = page?.id ?? 'none';
        if (!undated.has(key)) undated.set(key, { key: `p:${key}`, title: page?.text ?? L.views.todo.noPage, items: [] });
        undated.get(key)!.items.push(n);
      }
    }
    for (const k of ['overdue', 'today', 'tomorrow', 'week', 'later']) g[k].items.sort((a, b) => (dueOf(a)?.getTime() ?? 0) - (dueOf(b)?.getTime() ?? 0));
    const dated = Object.values(g).filter((x) => x.items.length);
    const rest = [...undated.values()].sort((a, b) => a.title.localeCompare(b.title));
    for (const r of rest) r.title = L.views.todo.undated(r.title);
    return [...dated, ...rest];
  }, [nodes, show, filter]);

  const total = groups.reduce((s, g) => s + g.items.length, 0);

  const add = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    try {
      await api.capture(`[] ${t}`);
      store().toast(L.views.todo.created, 'success');
    } catch (e) {
      store().toast((e as Error).message, 'error');
    }
  };

  return (
    <div
      className="view todo-view"
      onKeyDown={(e) => {
        // ↑ ↓ zwischen den Todos.
        if ((e.target as HTMLElement).matches('.todo-main')) moveFocus(e, e.currentTarget, '.todo-main');
      }}
    >
      <div className="view-inner">
        <div className="view-head">
          <ListTodo size={22} className="faint" />
          <h1>{L.common.todos}</h1>
          <div className="tabs">
            <button className={show === 'open' ? 'is-active' : ''} onClick={() => setShow('open')}>
              {L.views.todo.open}
            </button>
            <button className={show === 'done' ? 'is-active' : ''} onClick={() => setShow('done')}>
              {L.common.done}
            </button>
          </div>
        </div>
        <div className="todo-tools">
          <form
            className="todo-add"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Plus size={15} className="faint" />
            <input className="input" placeholder={L.views.todo.newPlaceholder} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </form>
          <input className="input todo-filter" placeholder={L.views.todo.filterPlaceholder} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {total === 0 && (
          <div className="empty">
            <CheckCircle2 size={28} />
            <h3>{show === 'open' ? L.views.todo.nothingOpen : L.views.todo.nothingDone}</h3>
            <p>{L.views.todo.emptyHint}</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.key} className={`todo-group${g.tone ? ` is-${g.tone}` : ''}`}>
            <h2>
              {g.title} <span className="faint">{g.items.length}</span>
            </h2>
            {g.items.map((n) => (
              <TodoRow key={n.id} n={n} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
