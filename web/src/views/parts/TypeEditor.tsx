// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Dialog zum Anlegen und Bearbeiten eines Typs (Tag mit Feldern).

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { L } from '../../i18n';
import { api } from '../../lib/api';
import { store, useStore } from '../../lib/store';
import type { FieldDef, TypeDef, Types } from '../../lib/types';
import { Dialog } from '../../components/ui';

export const COLORS = ['violet', 'blue', 'green', 'orange', 'red', 'pink', 'teal', 'yellow', 'gray'] as const;

/** Feldarten (gespeicherte Werte; die Beschriftung steht in `L.types.kinds`). */
const KINDS = ['text', 'number', 'date', 'select', 'ref', 'url', 'email', 'phone', 'checkbox'] as const;

interface DraftField {
  uid: number;
  key: string;
  label: string;
  kind: string;
  options: string;
  target: string;
  multiple: boolean;
}

let uid = 0;

function toDraft(f: FieldDef): DraftField {
  return { uid: ++uid, key: f.key, label: f.label, kind: f.kind, options: (f.options ?? []).join(', '), target: f.target ?? '', multiple: !!f.multiple };
}

const KEY_RE = /^[\p{L}\p{N}_-]+$/u;
const RESERVED = ['repeat', 'remind', 'done', 'tags', 'due'];

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function TypeEditor({ typeKey, isNew, onClose, onSaved }: { typeKey: string; isNew?: boolean; onClose: () => void; onSaved?: () => void }) {
  const types = useStore((s) => s.types);
  const existing = types[typeKey];
  const lastSegment = typeKey.split('/').pop() ?? typeKey;
  const [label, setLabel] = useState(existing?.label ?? capitalize(lastSegment));
  const [color, setColor] = useState<string>(existing?.color ?? 'gray');
  const [page, setPage] = useState(existing?.page ?? '');
  const [fields, setFields] = useState<DraftField[]>(() => (existing?.fields ?? []).map(toDraft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherTypes = useMemo(() => Object.entries(types).filter(([k]) => k !== typeKey), [types, typeKey]);

  const problems = useMemo(() => {
    const T = L.types.editor;
    const out: string[] = [];
    if (!label.trim()) out.push(T.labelMissing);
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      const k = f.key.trim();
      const name = T.fieldN(i + 1);
      if (!k) out.push(T.keyMissing(name));
      else if (!KEY_RE.test(k)) out.push(T.keyInvalid(name, k));
      else if (RESERVED.includes(k.toLowerCase())) out.push(T.keyReserved(name, k));
      else if (seen.has(k.toLowerCase())) out.push(T.keyDuplicate(name, k));
      seen.add(k.toLowerCase());
      if (f.kind === 'select' && !f.options.split(',').some((o) => o.trim())) out.push(T.selectNeedsOption(name));
    });
    return out;
  }, [label, fields]);

  const update = (i: number, patch: Partial<DraftField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((fs) => {
      const j = i + d;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const persist = async (next: Types, message: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.saveTypes(next);
      useStore.setState({ types: r.types, typesError: r.error });
      store().toast(message, 'success');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (problems.length) return;
    const def: TypeDef = {
      label: label.trim(),
      color,
      ...(existing?.icon ? { icon: existing.icon } : {}),
      ...(page.trim() ? { page: page.trim() } : {}),
      fields: fields.map((f) => {
        const key = f.key.trim();
        const out: FieldDef = { key, label: f.label.trim() || capitalize(key), kind: f.kind };
        if (f.kind === 'select') out.options = f.options.split(',').map((o) => o.trim()).filter(Boolean);
        if (f.kind === 'ref') {
          if (f.target) out.target = f.target;
          if (f.multiple) out.multiple = true;
        }
        return out;
      }),
    };
    if (await persist({ ...store().types, [typeKey]: def }, isNew ? L.types.editor.created(def.label) : L.types.editor.saved(def.label))) {
      onClose();
      onSaved?.();
    }
  };

  const remove = async () => {
    if (!confirm(L.types.editor.confirmDelete(existing?.label ?? typeKey, typeKey))) return;
    const next = { ...store().types };
    delete next[typeKey];
    if (await persist(next, L.types.editor.deleted)) {
      onClose();
      store().navigate({ view: 'tag', tag: typeKey });
    }
  };

  const T = L.types.editor;
  return (
    <Dialog
      title={isNew ? T.createTitle(typeKey) : T.editTitle(existing?.label ?? typeKey)}
      onClose={onClose}
      width={720}
      className="te-dialog"
      footer={
        <>
          {!isNew && existing && (
            <button className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={14} /> {T.deleteType}
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {L.common.cancel}
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || problems.length > 0} title={problems[0]}>
            {isNew ? T.create : L.common.save}
          </button>
        </>
      }
    >
      <p className="te-intro">
        {T.introA}
        <span className="tag">#{typeKey}</span>
        {T.introB}
        <code>date</code>
        {T.introC}
      </p>
      <div className="te-grid">
        <label className="field">
          {T.label}
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus={isNew} />
        </label>
        <label className="field">
          {T.defaultPage}
          <input className="input" value={page} onChange={(e) => setPage(e.target.value)} placeholder={T.defaultPagePlaceholder} />
          <span className="field-hint">{T.defaultPageHint}</span>
        </label>
        <div className="field">
          {T.color}
          <div className="te-colors" role="radiogroup">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={`te-color${color === c ? ' is-active' : ''}`}
                style={{ ['--type-color' as string]: `var(--t-${c})` }}
                title={L.types.colors[c]}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="te-fields-head">
        <h3>{T.fields}</h3>
        <button
          className="btn btn-sm"
          onClick={() => setFields((fs) => [...fs, { uid: ++uid, key: '', label: '', kind: 'text', options: '', target: '', multiple: false }])}
        >
          <Plus size={14} /> {T.addField}
        </button>
      </div>
      {fields.length === 0 ? (
        <div className="te-nofields">{T.noFields}</div>
      ) : (
        <div className="te-fields">
          <div className="te-row te-row-head">
            <span>{T.key}</span>
            <span>{T.label}</span>
            <span>{T.kind}</span>
            <span>{T.options}</span>
            <span />
          </div>
          {fields.map((f, i) => (
            <div className="te-row" key={f.uid}>
              <input className="input mono" value={f.key} placeholder={T.keyPlaceholder} onChange={(e) => update(i, { key: e.target.value.trim() })} />
              <input className="input" value={f.label} placeholder={capitalize(f.key) || T.label} onChange={(e) => update(i, { label: e.target.value })} />
              <select className="select" value={f.kind} onChange={(e) => update(i, { kind: e.target.value })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {L.types.kinds[k]}
                  </option>
                ))}
              </select>
              <div className="te-opts">
                {f.kind === 'select' && <input className="input" value={f.options} placeholder={T.optionsPlaceholder} onChange={(e) => update(i, { options: e.target.value })} />}
                {f.kind === 'ref' && (
                  <>
                    <select className="select" value={f.target} onChange={(e) => update(i, { target: e.target.value })} title={T.targetTitle}>
                      <option value="">{T.anyTarget}</option>
                      {otherTypes.map(([k, t]) => (
                        <option key={k} value={k}>
                          {t.label}
                        </option>
                      ))}
                      {fields.length > 0 && <option value={typeKey}>{T.thisType(label || typeKey)}</option>}
                    </select>
                    <label className="te-multi" title={T.multipleTitle}>
                      <input type="checkbox" checked={f.multiple} onChange={(e) => update(i, { multiple: e.target.checked })} /> {T.multiple}
                    </label>
                  </>
                )}
                {f.kind === 'date' && f.key !== 'date' && <span className="te-note">{T.dateTip}</span>}
              </div>
              <div className="te-actions">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={T.moveUp}>
                  <ArrowUp size={14} />
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label={T.moveDown}>
                  <ArrowDown size={14} />
                </button>
                <button className="btn btn-ghost btn-icon btn-sm btn-danger" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} aria-label={T.removeField}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {(problems.length > 0 || error) && (
        <ul className="te-problems">
          {error && <li>{error}</li>}
          {problems.slice(0, 4).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
