// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Tabelle aller Einträge eines Typs; Zellen direkt bearbeitbar.

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, FileText, Hash, Plus, Search, Settings2, Table2 } from 'lucide-react';
import { humanRemind, humanRepeat } from '../lib/dates';
import { plainText } from '../lib/inline';
import { typeHome } from '../lib/outline';
import { createOp, field, pageOf, store, useStore } from '../lib/store';
import type { FieldDef, Node } from '../lib/types';
import { RichText } from '../components/RichText';
import { DateChip, FieldPopover, TaskBox } from '../components/outline/fields';
import { ensureTypeHome } from '../components/outline/suggest';
import type { Anchor } from '../components/ui';
import { crumbTitle, pathOf } from './parts/common';
import { TypeEditor } from './parts/TypeEditor';
import { setFieldValue } from '../lib/outline';

type Sort = { key: string; dir: 1 | -1 } | null;

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

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

function Cell({ n, def, onEdit }: { n: Node; def: FieldDef; onEdit: (def: FieldDef, a: Anchor) => void }) {
  const v = valueOf(n, def);
  const open = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onEdit(def, { left: r.left, top: r.top, bottom: r.bottom });
  };
  if (def.kind === 'checkbox') {
    return (
      <td className="ty-cell is-check">
        <button className={`ty-check${v === 'true' ? ' is-on' : ''}`} onClick={() => setFieldValue(n.id, def.key, v === 'true' ? 'false' : 'true')} aria-label={v === 'true' ? 'ja' : 'nein'}>
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
    <td className={`ty-cell is-${def.kind}`} onClick={open}>
      <div className="ty-cell-inner">{content}</div>
    </td>
  );
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
        return collator.compare(va, vb) * sort.dir;
      });
    } else {
      list.sort((a, b) => collator.compare(plainText(a.text, false), plainText(b.text, false)));
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
      store().toast(`„${text}“ angelegt unter ${store().nodes[parent]?.text ?? 'Inbox'}`, 'success', { label: 'Öffnen', run: () => store().reveal(op.id) });
    }
  };

  if (!def) {
    return (
      <div className="view">
        <div className="view-inner">
          <div className="empty">
            <Table2 size={28} />
            <h3>Den Typ „{t}“ gibt es nicht (mehr)</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => store().navigate({ view: 'tag', tag: t })}>
                <Hash size={14} /> Einträge mit #{t}
              </button>
              <button className="btn btn-primary" onClick={() => setEditor(true)}>
                Typ anlegen
              </button>
            </div>
          </div>
        </div>
        {editor && <TypeEditor typeKey={t} isNew onClose={() => setEditor(false)} />}
      </div>
    );
  }

  const sortIcon = (key: string) => (sort?.key === key ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null);
  const node = editing ? nodes[editing.id] : undefined;

  return (
    <div className="view ty-view">
      <div className="view-inner ty-inner">
        <div className="view-head">
          <span className="type-dot ty-dot" style={{ ['--type-color' as string]: `var(--t-${def.color ?? 'gray'})` }} />
          <h1>{def.label}</h1>
          <a className="tag" onClick={() => store().navigate({ view: 'tag', tag: t })} title="Als Liste">
            #{t}
          </a>
          <span className="ty-count">{rows.length}</span>
          <label className="tg-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtern …" />
          </label>
          <button className="btn btn-sm" onClick={() => setEditor(true)}>
            <Settings2 size={14} /> Typ bearbeiten
          </button>
        </div>

        <div className="ty-table-wrap">
          <table className="ty-table">
            <thead>
              <tr>
                <th className="ty-title-col" onClick={() => toggleSort('__title')}>
                  <span>Titel</span>
                  {sortIcon('__title')}
                </th>
                {defs.map((d) => (
                  <th key={d.key} onClick={() => toggleSort(d.key)} title={`${d.key} · ${d.kind}`}>
                    <span>{d.label}</span>
                    {sortIcon(d.key)}
                  </th>
                ))}
                <th className="ty-page-col" title="Wo der Eintrag steht">Seite</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const page = pageOf(nodes, n.id);
                const place = n.kind === 'page' ? (n.path?.split('/').slice(0, -1).join(' › ') ?? '') : pathOf(nodes, n.id);
                return (
                  <tr key={n.id} className={n.task === 'done' || n.task === 'cancelled' ? 'is-closed' : ''}>
                    <td className="ty-cell ty-title-col">
                      <div className="ty-title">
                        {n.kind === 'page' ? <FileText size={13} className="faint" /> : n.task ? <TaskBox node={n} size={14} /> : null}
                        <a className="ty-title-link" onClick={() => store().reveal(n.id, { edit: n.kind !== 'page' })}>
                          {n.text ? <RichText text={n.text.replace(new RegExp(`(^|\\s)#${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i'), '$1').trim() || n.text} source={n} /> : <span className="faint">(leer)</span>}
                        </a>
                      </div>
                    </td>
                    {defs.map((d) => (
                      <Cell key={d.key} n={n} def={d} onEdit={(fd, anchor) => setEditing({ id: n.id, def: fd, anchor })} />
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
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Neu: ${def.label} … (landet in ${def.page || home?.text || 'Inbox'})`} />
                  </form>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {rows.length === 0 && !query && (
          <div className="ty-hint">
            Noch keine Einträge vom Typ {def.label}. Schreibe <span className="tag">#{t}</span> in einen beliebigen Eintrag, wähle im Editor <kbd>/</kbd> → „Typ: {def.label}“ oder lege oben direkt einen an.
          </div>
        )}
      </div>
      {editing && node && <FieldPopover node={node} def={editing.def} anchor={editing.anchor} onClose={() => setEditing(null)} />}
      {editor && <TypeEditor typeKey={t} onClose={() => setEditor(false)} />}
    </div>
  );
}
