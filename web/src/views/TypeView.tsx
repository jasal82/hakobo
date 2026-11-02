// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Tabelle aller Einträge eines Typs; Zellen direkt bearbeitbar.

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, FileText, Hash, Plus, Search, Settings2, Table2 } from 'lucide-react';
import { compareText, L } from '../i18n';
import { humanRemind, humanRepeat } from '../lib/dates';
import { plainText } from '../lib/inline';
import { typeHome } from '../lib/outline';
import { createOp, field, pageOf, store, useStore } from '../lib/store';
import type { FieldDef, Node } from '../lib/types';
import { RichText } from '../components/RichText';
import { DateChip, FieldPopover, TaskBox } from '../components/outline/fields';
import { ensureTypeHome } from '../components/outline/suggest';
import { RouteLink, type Anchor } from '../components/ui';
import { crumbTitle, pathOf } from './parts/common';
import { TypeEditor } from './parts/TypeEditor';
import { setFieldValue } from '../lib/outline';

type Sort = { key: string; dir: 1 | -1 } | null;

/** Feldwert eines Knotens (beim Datum auch `due`). */
function valueOf(n: Node, def: FieldDef): string {
  return field(n, def.key) ?? (def.key === 'date' ? field(n, 'due') : undefined) ?? '';
}

/** Vergleichswert für die Sortierung. */
function sortValue(n: Node, key: string, defs: FieldDef[]): string {
  if (key === '__title') return plainText(n.text, false).toLowerCase();
  const def = defs.find((d) => d.key === key);
  if (!def) return '';
  const v = valueOf(n, def);
  if (def.kind === 'ref' && v.includes('[[')) return plainText(v, false).toLowerCase();
  return v.toLowerCase();
}

/** Gemeinsame Eigenschaften einer per Pfeiltasten erreichbaren Zelle (nur eine ist per Tab erreichbar). */
type CellNav = { tabIndex: number; 'data-r': number; 'data-c': number; onFocus: () => void };

/** Enter oder F2 bearbeitet, die Leertaste schaltet um. */
function cellKeys(activate: () => void, space: () => void = activate) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      activate();
    } else if (e.key === ' ') {
      e.preventDefault();
      space();
    }
  };
}

function Cell({ n, def, onEdit, nav }: { n: Node; def: FieldDef; onEdit: (def: FieldDef, a: Anchor) => void; nav: CellNav }) {
  const v = valueOf(n, def);
  const openAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onEdit(def, { left: r.left, top: r.top, bottom: r.bottom });
  };
  const open = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a')) return;
    openAt(e.currentTarget);
  };
  if (def.kind === 'checkbox') {
    const toggle = () => setFieldValue(n.id, def.key, v === 'true' ? 'false' : 'true');
    return (
      <td className="ty-cell is-check" {...nav} aria-label={`${def.label}: ${v === 'true' ? L.types.view.yes : L.types.view.no}`} onKeyDown={cellKeys(toggle)}>
        <button className={`ty-check${v === 'true' ? ' is-on' : ''}`} tabIndex={-1} onClick={toggle} aria-label={v === 'true' ? L.types.view.yes : L.types.view.no}>
          {v === 'true' && <Check size={12} strokeWidth={3} />}
        </button>
      </td>
    );
  }
  let content: React.ReactNode = <span className="ty-empty">–</span>;
  if (v) {
    switch (def.kind) {
      case 'date':
        content = <DateChip value={v} task={n.task} />;
        break;
      case 'select':
        content = <span className="chip">{v}</span>;
        break;
      case 'url':
        content = <span className="url">{v.replace(/^https?:\/\/(www\.)?/, '')}</span>;
        break;
      case 'repeat':
        content = humanRepeat(v);
        break;
      case 'remind':
        content = humanRemind(v);
        break;
      default:
        content = <RichText text={v} source={n} stripHeading={false} />;
    }
  }
  return (
    <td className={`ty-cell is-${def.kind}`} {...nav} onClick={open} onKeyDown={(e) => cellKeys(() => openAt(e.currentTarget))(e)}>
      <div className="ty-cell-inner">{content}</div>
    </td>
  );
}

/** Pfeiltasten, Pos1/Ende (mit Strg: erste/letzte Zeile) und Bild↑/↓ zwischen den Zellen. */
function gridKeys(e: React.KeyboardEvent<HTMLElement>, rows: number, cols: number) {
  const td = e.target as HTMLElement;
  if (!td.matches('td[data-r]') || e.altKey || e.metaKey || e.shiftKey) return;
  let r = Number(td.dataset.r);
  let c = Number(td.dataset.c);
  switch (e.key) {
    case 'ArrowUp':
      r--;
      break;
    case 'ArrowDown':
      r++;
      break;
    case 'ArrowLeft':
      c--;
      break;
    case 'ArrowRight':
      c++;
      break;
    case 'Home':
      c = 0;
      if (e.ctrlKey) r = 0;
      break;
    case 'End':
      c = cols - 1;
      if (e.ctrlKey) r = rows - 1;
      break;
    case 'PageUp':
      r -= 10;
      break;
    case 'PageDown':
      r += 10;
      break;
    default:
      return;
  }
  if (e.ctrlKey && e.key.startsWith('Arrow')) return;
  e.preventDefault();
  const table = e.currentTarget;
  // Unter der letzten Zeile: Eingabe für einen neuen Eintrag.
  if (r >= rows && e.key === 'ArrowDown') {
    table.querySelector<HTMLElement>('.ty-new input')?.focus();
    return;
  }
  r = Math.max(0, Math.min(rows - 1, r));
  c = Math.max(0, Math.min(cols - 1, c));
  const next = table.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);
  next?.focus();
  next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function TypeView({ type }: { type: string }) {
  const t = type.toLowerCase();
  const types = useStore((s) => s.types);
  const nodes = useStore((s) => s.nodes);
  const def = types[t];
  const [sort, setSort] = useState<Sort>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; def: FieldDef; anchor: Anchor } | null>(null);
  const [editor, setEditor] = useState(false);
  const [title, setTitle] = useState('');
  // Zelle, die per Tab erreichbar ist (Zeile, Spalte; Spalte 0 = Titel).
  const [cur, setCur] = useState({ r: 0, c: 0 });

  const defs = def?.fields ?? [];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = Object.values(nodes).filter((n) => n.kind !== 'root' && n.tags.includes(t));
    if (q) list = list.filter((n) => `${plainText(n.text)} ${n.fields.map((f) => f.value).join(' ')}`.toLowerCase().includes(q));
    if (sort) {
      list.sort((a, b) => {
        const va = sortValue(a, sort.key, defs);
        const vb = sortValue(b, sort.key, defs);
        // Leere Werte immer ans Ende
        if (!va !== !vb) return va ? -1 : 1;
        return compareText(va, vb) * sort.dir;
      });
    } else {
      list.sort((a, b) => compareText(plainText(a.text, false), plainText(b.text, false)));
    }
    return list;
  }, [nodes, t, query, sort, defs]);

  const toggleSort = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  const home = typeHome(t);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    const parent = await ensureTypeHome(t);
    if (!parent) return;
    const op = createOp(parent, undefined, `${text} #${t}`);
    if (store().commit([op])) {
      setTitle('');
      store().toast(L.types.view.created(text, store().nodes[parent]?.text ?? L.common.inbox), 'success', { label: L.common.open, run: () => store().reveal(op.id) });
    }
  };

  if (!def) {
    return (
      <div className="view">
        <div className="view-inner">
          <div className="empty">
            <Table2 size={28} />
            <h3>{L.types.view.notFound(t)}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => store().navigate({ view: 'tag', tag: t })}>
                <Hash size={14} /> {L.types.view.entriesWith(t)}
              </button>
              <button className="btn btn-primary" onClick={() => setEditor(true)}>
                {L.types.view.create}
              </button>
            </div>
          </div>
        </div>
        {editor && <TypeEditor typeKey={t} isNew onClose={() => setEditor(false)} />}
      </div>
    );
  }

  const sortIcon = (key: string) => (sort?.key === key ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null);
  const sortLabel = (key: string) => (sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined);
  const node = editing ? nodes[editing.id] : undefined;
  const cols = defs.length + 1;
  const curR = Math.min(cur.r, rows.length - 1);
  const curC = Math.min(cur.c, cols - 1);
  const nav = (r: number, c: number): CellNav => ({ tabIndex: r === curR && c === curC ? 0 : -1, 'data-r': r, 'data-c': c, onFocus: () => setCur({ r, c }) });

  return (
    <div className="view ty-view">
      <div className="view-inner ty-inner">
        <div className="view-head">
          <span className="type-dot ty-dot" style={{ ['--type-color' as string]: `var(--t-${def.color ?? 'gray'})` }} />
          <h1>{def.label}</h1>
          <RouteLink className="tag" route={{ view: 'tag', tag: t }} title={L.types.view.asList}>
            #{t}
          </RouteLink>
          <span className="ty-count">{rows.length}</span>
          <label className="tg-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L.types.filter} />
          </label>
          <button className="btn btn-sm" onClick={() => setEditor(true)}>
            <Settings2 size={14} /> {L.types.view.edit}
          </button>
        </div>

        <div className="ty-table-wrap">
          <table className="ty-table">
            <thead>
              <tr>
                <th className="ty-title-col" onClick={() => toggleSort('__title')} aria-sort={sortLabel('__title')}>
                  <button
                    className="ty-sort"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSort('__title');
                    }}
                  >
                    <span>{L.types.view.title}</span>
                    {sortIcon('__title')}
                  </button>
                </th>
                {defs.map((d) => (
                  <th key={d.key} onClick={() => toggleSort(d.key)} title={`${d.key} · ${d.kind}`} aria-sort={sortLabel(d.key)}>
                    <button
                      className="ty-sort"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSort(d.key);
                      }}
                    >
                      <span>{d.label}</span>
                      {sortIcon(d.key)}
                    </button>
                  </th>
                ))}
                <th className="ty-page-col" title={L.types.view.whereTitle}>
                  {L.common.page}
                </th>
              </tr>
            </thead>
            <tbody onKeyDown={(e) => gridKeys(e, rows.length, cols)}>
              {rows.map((n, r) => {
                const page = pageOf(nodes, n.id);
                const place = n.kind === 'page' ? (n.path?.split('/').slice(0, -1).join(' › ') ?? '') : pathOf(nodes, n.id);
                return (
                  <tr key={n.id} className={n.task === 'done' || n.task === 'cancelled' ? 'is-closed' : ''}>
                    <td
                      className="ty-cell ty-title-col"
                      {...nav(r, 0)}
                      onKeyDown={cellKeys(
                        () => store().reveal(n.id, { edit: n.kind !== 'page' }),
                        // Leertaste: Todo erledigen bzw. wieder öffnen
                        () => n.task && store().commit([{ op: 'update', id: n.id, task: n.task === 'done' || n.task === 'cancelled' ? 'open' : 'done' }]),
                      )}
                    >
                      <div className="ty-title">
                        {n.kind === 'page' ? <FileText size={13} className="faint" /> : n.task ? <TaskBox node={n} size={14} tabIndex={-1} /> : null}
                        <a className="ty-title-link" onClick={() => store().reveal(n.id, { edit: n.kind !== 'page' })}>
                          {n.text ? <RichText text={n.text.replace(new RegExp(`(^|\\s)#${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i'), '$1').trim() || n.text} source={n} /> : <span className="faint">{L.types.empty}</span>}
                        </a>
                      </div>
                    </td>
                    {defs.map((d, i) => (
                      <Cell key={d.key} n={n} def={d} nav={nav(r, i + 1)} onEdit={(fd, anchor) => setEditing({ id: n.id, def: fd, anchor })} />
                    ))}
                    <td className="ty-cell ty-page-col">
                      <span className="ty-place" title={place}>
                        {place || (page ? crumbTitle(page) : '')}
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr className="ty-new">
                <td colSpan={defs.length + 2}>
                  <form onSubmit={(e) => void add(e)}>
                    <Plus size={14} />
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => {
                        // ↑ zurück in die Tabelle.
                        if (e.key !== 'ArrowUp' || !rows.length) return;
                        e.preventDefault();
                        e.currentTarget.closest('tbody')?.querySelector<HTMLElement>(`td[data-r="${rows.length - 1}"][data-c="${curC}"]`)?.focus();
                      }}
                      placeholder={L.types.view.newPlaceholder(def.label, def.page || home?.text || L.common.inbox)} />
                  </form>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {rows.length === 0 && !query && (
          <div className="ty-hint">
            {L.types.view.hintA(def.label)}
            <span className="tag">#{t}</span>
            {L.types.view.hintB}
            <kbd>/</kbd>
            {L.types.view.hintC(def.label)}
          </div>
        )}
      </div>
      {editing && node && <FieldPopover node={node} def={editing.def} anchor={editing.anchor} onClose={() => setEditing(null)} />}
      {editor && <TypeEditor typeKey={t} onClose={() => setEditor(false)} />}
    </div>
  );
}
