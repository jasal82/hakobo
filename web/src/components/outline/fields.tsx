// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Felder eines Knotens: Chips in der Zeile, Formular in der Kopfzeile, Editoren.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AtSign, Bell, CalendarClock, Check, FileText, Link2, Minus, Plus, Repeat, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { humanRemind, humanRepeat, humanWhen, urgency } from '../../lib/dates';
import { plainText, tokenize } from '../../lib/inline';
import { linkTextFor } from '../../lib/links';
import { setFieldValue } from '../../lib/outline';
import { ancestors, field, isViewField, store, typesOf, useStore } from '../../lib/store';
import type { FieldDef, Hit, Node, ParseResult } from '../../lib/types';
import { Highlighted, Popover, useScrollActive, type Anchor } from '../ui';
import { RichText } from '../RichText';
import { L } from '../../i18n';

/** Eingebaute Felder (Schlüssel und Art sind Dateiformat, nur die Beschriftung wechselt). */
function builtin(): Record<string, FieldDef> {
  const f = L.outline.fields;
  return {
    date: { key: 'date', label: f.date, kind: 'date' },
    repeat: { key: 'repeat', label: f.repeat, kind: 'repeat' },
    remind: { key: 'remind', label: f.remind, kind: 'remind' },
    done: { key: 'done', label: f.done, kind: 'text' },
  };
}

/** Feld-Definitionen eines Knotens: eingebaute, aus Typen, dann freie Felder. */
export function fieldDefs(n: Node, types = store().types): FieldDef[] {
  const out: FieldDef[] = [];
  const BUILTIN = builtin();
  const due = L.outline.fields.due;
  const seen = new Set<string>();
  const push = (d: FieldDef) => {
    if (seen.has(d.key.toLowerCase())) return;
    seen.add(d.key.toLowerCase());
    out.push(d);
  };
  for (const t of typesOf(n, types)) for (const f of types[t].fields) push(f.key === 'date' && n.task ? { ...f, label: due } : f);
  for (const f of n.fields) {
    // `layout` und `col-widths` (Tabelle) steuern nur die Darstellung.
    if (f.key === 'tags' || isViewField(f.key)) continue;
    const b = BUILTIN[f.key.toLowerCase()];
    push(b ? { ...b, label: f.key === 'date' && n.task ? due : b.label } : { key: f.key, label: f.key, kind: 'text' });
  }
  return out;
}

export function DateChip({ value, task, onClick }: { value: string; task?: Node['task']; onClick?: (e: React.MouseEvent) => void }) {
  const u = task === 'done' || task === 'cancelled' ? null : urgency(value);
  return (
    <button className={`chip chip-date${u === 'overdue' ? ' is-overdue' : u === 'today' ? ' is-today' : u === 'soon' ? ' is-soon' : ''}`} onClick={onClick} title={value}>
      <CalendarClock />
      {humanWhen(value)}
    </button>
  );
}

/** Kompakte Feldwerte (Links als Text). */
function valueLabel(v: string): string {
  if (!v.includes('[[')) return v;
  const nodes = store().nodes;
  return tokenize(v)
    .map((s) => {
      if (s.t !== 'link') return s.t === 'text' ? s.v : '';
      const id = s.anchor?.startsWith('^') ? s.anchor.slice(1) : null;
      const n = id ? nodes[id] : undefined;
      return n ? plainText(n.text, false) : s.alias || s.target;
    })
    .join('');
}

/** Chips für Datum, Wiederholung, Erinnerung und gefüllte Typfelder in der Zeile. */
export function MetaChips({ node }: { node: Node }) {
  const types = useStore((s) => s.types);
  const [edit, setEdit] = useState<{ def: FieldDef; anchor: Anchor } | null>(null);
  const BUILTIN = builtin();
  const t = L.outline.fields;
  const open = (def: FieldDef) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setEdit({ def, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
  };
  const date = field(node, 'date') ?? field(node, 'due');
  const repeat = field(node, 'repeat');
  const remind = field(node, 'remind');
  const extra = fieldDefs(node, types).filter((d) => !['date', 'due', 'repeat', 'remind', 'done'].includes(d.key.toLowerCase()));
  const shown = extra.filter((d) => field(node, d.key));
  if (!date && !repeat && !remind && !shown.length && !edit) return null;
  return (
    <span className="meta-chips">
      {date && <DateChip value={date} task={node.task} onClick={open({ ...BUILTIN.date, label: node.task ? t.due : t.date })} />}
      {repeat && (
        <button className="chip" onClick={open(BUILTIN.repeat)} title={t.repeat}>
          <Repeat />
          {humanRepeat(repeat)}
        </button>
      )}
      {remind && (
        <button className="chip" onClick={open(BUILTIN.remind)} title={t.remind}>
          <Bell />
          {humanRemind(remind)}
        </button>
      )}
      {shown.map((d) => (
        <button key={d.key} className="chip chip-field" onClick={open(d)} title={d.label}>
          <span className="chip-key">{d.label}</span>
          {d.kind === 'checkbox' ? (field(node, d.key) === 'true' ? t.yes : t.no) : valueLabel(field(node, d.key) ?? '')}
        </button>
      ))}
      {edit && <FieldPopover node={node} def={edit.def} anchor={edit.anchor} onClose={() => setEdit(null)} />}
    </span>
  );
}

/** Formular aller Felder (Kopf einer gezoomten Ansicht). */
export function FieldsForm({ node }: { node: Node }) {
  const types = useStore((s) => s.types);
  const defs = fieldDefs(node, types).filter((d) => d.key !== 'done');
  const [edit, setEdit] = useState<{ def: FieldDef; anchor: Anchor } | null>(null);
  const [adding, setAdding] = useState<Anchor | null>(null);
  const BUILTIN = builtin();
  const t = L.outline.fields;
  const open = (def: FieldDef) => (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setEdit({ def, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
  };
  const builtinsMissing = node.kind === 'item' ? (['date', 'repeat', 'remind'] as const).filter((k) => !defs.some((d) => d.key === k)) : [];
  return (
    <div className="fields-form">
      {defs.map((d) => {
        const v = field(node, d.key) ?? (d.key === 'date' ? field(node, 'due') : undefined);
        return (
          <div className="ff-row" key={d.key}>
            <span className="ff-label">{d.label}</span>
            {d.kind === 'checkbox' ? (
              <label className="switch ff-value">
                <input type="checkbox" checked={v === 'true'} onChange={(e) => setFieldValue(node.id, d.key, e.target.checked ? 'true' : 'false')} />
              </label>
            ) : (
              <button className={`ff-value${v ? '' : ' is-empty'}`} onClick={open(d)}>
                {v ? <FieldValue def={d} value={v} node={node} /> : <span className="faint">{t.empty}</span>}
              </button>
            )}
          </div>
        );
      })}
      <div className="ff-actions">
        {builtinsMissing.map((k) => (
          <button key={k} className="btn btn-ghost btn-sm" onClick={open(BUILTIN[k])}>
            {k === 'date' ? <CalendarClock size={14} /> : k === 'repeat' ? <Repeat size={14} /> : <Bell size={14} />}
            {k === 'date' && node.task ? t.due : BUILTIN[k].label}
          </button>
        ))}
        <button
          className="btn btn-ghost btn-sm"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAdding({ left: r.left, top: r.top, bottom: r.bottom });
          }}
        >
          <Plus size={14} /> {t.addField}
        </button>
      </div>
      {edit && <FieldPopover node={node} def={edit.def} anchor={edit.anchor} onClose={() => setEdit(null)} />}
      {adding && <NewFieldPopover node={node} anchor={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function FieldValue({ def, value, node }: { def: FieldDef; value: string; node: Node }) {
  switch (def.kind) {
    case 'date':
      return <>{humanWhen(value)}</>;
    case 'repeat':
      return <>{humanRepeat(value)}</>;
    case 'remind':
      return <>{humanRemind(value)}</>;
    case 'url':
      return <span className="url">{value.replace(/^https?:\/\/(www\.)?/, '')}</span>;
    case 'ref':
      return <RichText text={value} source={node} />;
    default:
      return <RichText text={value} source={node} stripHeading={false} />;
  }
}

function NewFieldPopover({ node, anchor, onClose }: { node: Node; anchor: Anchor; onClose: () => void }) {
  const [key, setKey] = useState('');
  const valid = /^[\p{L}\p{N}_-]+$/u.test(key);
  return (
    <Popover anchor={anchor} onClose={onClose} className="field-pop" width={260}>
      <form
        className="fp-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          setFieldValue(node.id, key, '');
          onClose();
        }}
      >
        <div className="fp-title">{L.outline.fields.newField}</div>
        <input className="input" autoFocus placeholder={L.outline.fields.newFieldPlaceholder} value={key} onChange={(e) => setKey(e.target.value.trim())} />
        <div className="fp-hint">{L.outline.fields.newFieldHint}</div>
      </form>
    </Popover>
  );
}

/** Editor für ein Feld (Popover). */
export function FieldPopover({ node, def, anchor, onClose }: { node: Node; def: FieldDef; anchor: Anchor; onClose: () => void }) {
  const current = field(node, def.key) ?? (def.key === 'date' ? field(node, 'due') : undefined) ?? '';
  const save = (v: string | null) => {
    setFieldValue(node.id, def.key, v);
    if (def.key === 'date' && field(node, 'due') !== undefined) setFieldValue(node.id, 'due', null);
    onClose();
  };
  let body: ReactNode;
  switch (def.kind) {
    case 'date':
    case 'repeat':
    case 'remind':
      body = <ParsedInput kind={def.kind} current={current} onSave={save} task={!!node.task} />;
      break;
    case 'select':
      body = (
        <div className="menu">
          {(def.options ?? []).map((o) => (
            <button key={o} className={`menu-item${o === current ? ' is-active' : ''}`} onClick={() => save(o)}>
              <span className="menu-label">{o}</span>
            </button>
          ))}
          {current && (
            <button className="menu-item" onClick={() => save(null)}>
              <span className="menu-icon">
                <X size={14} />
              </span>
              <span className="menu-label">{L.outline.fields.clear}</span>
            </button>
          )}
        </div>
      );
      break;
    case 'ref':
      body = <RefInput def={def} node={node} current={current} onSave={save} />;
      break;
    default:
      body = <PlainInput def={def} current={current} onSave={save} />;
  }
  return (
    <Popover anchor={anchor} onClose={onClose} className="field-pop" width={def.kind === 'ref' ? 340 : 300}>
      <div className="fp-title">{def.label}</div>
      {body}
    </Popover>
  );
}

function PlainInput({ def, current, onSave }: { def: FieldDef; current: string; onSave: (v: string | null) => void }) {
  const [v, setV] = useState(current);
  const type = def.kind === 'number' ? 'number' : def.kind === 'email' ? 'email' : def.kind === 'url' ? 'url' : def.kind === 'phone' ? 'tel' : 'text';
  return (
    <form
      className="fp-body"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v.trim() ? v.trim() : null);
      }}
    >
      <input className="input" type={type} autoFocus value={v} onChange={(e) => setV(e.target.value)} />
      <div className="fp-actions">
        {current && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSave(null)}>
            <Trash2 size={14} /> {L.common.remove}
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-primary btn-sm">{L.outline.fields.apply}</button>
      </div>
    </form>
  );
}

/** Schnellwahl: Eingabe für den Server (versteht Deutsch und Englisch) und Beschriftung. */
function quick(kind: 'date' | 'repeat' | 'remind'): [string, string][] {
  const q = L.outline.fields.quick;
  switch (kind) {
    case 'date':
      return [
        ['heute', L.common.today],
        ['morgen', L.common.tomorrow],
        ['nächste woche', q.nextWeek],
        ['in 1 monat', q.inOneMonth],
      ];
    case 'repeat':
      return [
        ['täglich', q.daily],
        ['werktags', q.weekdays],
        ['wöchentlich', q.weekly],
        ['monatlich', q.monthly],
        ['jährlich', q.yearly],
      ];
    case 'remind':
      return [
        ['0', q.atStart],
        ['10m', q.min10],
        ['1h', q.hour1],
        ['1d', q.day1],
      ];
  }
}

/** Eingabe in natürlicher Sprache mit Live-Vorschau des Servers. */
export function ParsedInput({ kind, current, onSave, task }: { kind: 'date' | 'repeat' | 'remind'; current: string; onSave: (v: string | null) => void; task?: boolean }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState<ParseResult | null>(null);
  useEffect(() => {
    if (!q.trim()) {
      setR(null);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      api.parse(kind, q, ac.signal).then(setR, () => undefined);
    }, 60);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [q, kind]);
  const pick = async (text: string) => {
    const res = await api.parse(kind, text);
    if (res) onSave(res.value);
  };
  const t = L.outline.fields;
  const currentHuman = kind === 'date' ? humanWhen(current) : kind === 'repeat' ? humanRepeat(current) : humanRemind(current);
  return (
    <form
      className="fp-body"
      onSubmit={(e) => {
        e.preventDefault();
        if (r?.complete) onSave(r.value);
      }}
    >
      {current && <div className="fp-current">{t.current(currentHuman)}</div>}
      <input className="input" autoFocus placeholder={t.placeholder[kind]} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className={`fp-preview${r?.complete ? ' is-ok' : q ? ' is-bad' : ''}`}>{q ? (r?.complete ? `↵ ${r.human}` : r ? `… ${r.human}` : t.notRecognized) : kind === 'date' && task ? t.dueOfTodo : ' '}</div>
      <div className="fp-quick">
        {quick(kind).map(([v, label]) => (
          <button type="button" key={v} className="chip" onClick={() => void pick(v)}>
            {label}
          </button>
        ))}
      </div>
      {current && (
        <div className="fp-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSave(null)}>
            <Trash2 size={14} /> {L.common.remove}
          </button>
        </div>
      )}
    </form>
  );
}

/** Referenzfeld: Links auf Knoten (optional eines Typs). */
function RefInput({ def, node, current, onSave }: { def: FieldDef; node: Node; current: string; onSave: (v: string | null) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollActive(listRef, active);
  const values = useMemo(() => (current ? current.split(/,\s*(?=\[\[)/).map((v) => v.trim()).filter(Boolean) : []), [current]);
  useEffect(() => {
    const ac = new AbortController();
    const query = `${def.target ? `#${def.target} ` : ''}${q}`.trim() || 'is:page';
    const t = window.setTimeout(() => {
      api.search(query, 12, ac.signal).then((r) => {
        setHits(r.hits.filter((h) => h.id !== node.id));
        setActive(0);
      }, () => undefined);
    }, 60);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [q, def.target, node.id]);
  const add = async (id: string) => {
    const link = await linkTextFor(store().nodes, id, api.link);
    const next = def.multiple ? [...values.filter((v) => v !== link), link] : [link];
    onSave(next.join(', '));
  };
  const remove = (v: string) => {
    const next = values.filter((x) => x !== v);
    setFieldValue(node.id, def.key, next.length ? next.join(', ') : null);
  };
  const nodes = store().nodes;
  return (
    <div className="fp-body">
      {values.length > 0 && (
        <div className="fp-refs">
          {values.map((v) => (
            <span className="chip" key={v}>
              <RichText text={v} source={node} />
              <button className="chip-x" onClick={() => remove(v)} aria-label={L.common.remove}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="input"
        autoFocus
        placeholder={def.target ? L.outline.fields.searchType(store().types[def.target]?.label ?? def.target) : L.outline.fields.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (hits[active]) void add(hits[active].id);
          }
        }}
      />
      <div className="menu fp-list" ref={listRef}>
        {hits.map((h, i) => {
          const n = nodes[h.id];
          if (!n) return null;
          return (
            <button key={h.id} className={`menu-item${i === active ? ' is-active' : ''}`} onClick={() => void add(h.id)} onMouseMove={() => setActive(i)}>
              <span className="menu-icon">{n.kind === 'page' ? <FileText size={14} /> : n.tags.includes('person') ? <AtSign size={14} /> : <Link2 size={14} />}</span>
              <span className="menu-label">
                <Highlighted text={n.kind === 'item' ? plainText(n.text) : n.text} ranges={h.titleRanges} />
                <span className="menu-path">{ancestors(nodes, n.id).map((a) => (a.kind === 'item' ? plainText(a.text, false) : a.text)).join(' › ')}</span>
              </span>
            </button>
          );
        })}
        {!hits.length && <div className="menu-empty">{L.outline.fields.nothingFound}</div>}
      </div>
    </div>
  );
}

export function TaskBox({ node, size = 16, tabIndex }: { node: Node; size?: number; tabIndex?: number }) {
  const t = node.task;
  if (!t) return null;
  return (
    <button
      className={`taskbox is-${t}`}
      style={{ width: size, height: size }}
      tabIndex={tabIndex}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        store().commit([{ op: 'update', id: node.id, task: t === 'done' || t === 'cancelled' ? 'open' : 'done' }]);
      }}
      aria-label={t === 'done' ? L.outline.fields.reopen : L.outline.fields.complete}
      title={field(node, 'repeat') ? L.outline.fields.repeats(humanRepeat(field(node, 'repeat')!)) : undefined}
    >
      {t === 'done' && <Check size={size - 4} strokeWidth={3} />}
      {t === 'cancelled' && <X size={size - 4} strokeWidth={3} />}
      {t === 'doing' && <Minus size={size - 4} strokeWidth={3} />}
    </button>
  );
}
