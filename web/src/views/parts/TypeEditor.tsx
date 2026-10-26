// Dialog zum Anlegen und Bearbeiten eines Typs (Tag mit Feldern).

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { store, useStore } from '../../lib/store';
import type { FieldDef, TypeDef, Types } from '../../lib/types';
import { Dialog } from '../../components/ui';

export const COLORS = ['violet', 'blue', 'green', 'orange', 'red', 'pink', 'teal', 'yellow', 'gray'] as const;

const COLOR_NAMES: Record<string, string> = {
  violet: 'Violett',
  blue: 'Blau',
  green: 'Grün',
  orange: 'Orange',
  red: 'Rot',
  pink: 'Pink',
  teal: 'Petrol',
  yellow: 'Gelb',
  gray: 'Grau',
};

const KINDS: [string, string][] = [
  ['text', 'Text'],
  ['number', 'Zahl'],
  ['date', 'Datum'],
  ['select', 'Auswahl'],
  ['ref', 'Verweis'],
  ['url', 'Link (URL)'],
  ['email', 'E-Mail'],
  ['phone', 'Telefon'],
  ['checkbox', 'Ja/Nein'],
];

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
    const out: string[] = [];
    if (!label.trim()) out.push('Bitte eine Bezeichnung angeben.');
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      const k = f.key.trim();
      const name = `Feld ${i + 1}`;
      if (!k) out.push(`${name}: Schlüssel fehlt.`);
      else if (!KEY_RE.test(k)) out.push(`${name}: Schlüssel „${k}“ darf nur Buchstaben, Ziffern, _ und - enthalten.`);
      else if (RESERVED.includes(k.toLowerCase())) out.push(`${name}: „${k}“ ist für eingebaute Felder reserviert.`);
      else if (seen.has(k.toLowerCase())) out.push(`${name}: Schlüssel „${k}“ kommt doppelt vor.`);
      seen.add(k.toLowerCase());
      if (f.kind === 'select' && !f.options.split(',').some((o) => o.trim())) out.push(`${name}: Auswahl braucht mindestens eine Option.`);
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
    if (await persist({ ...store().types, [typeKey]: def }, isNew ? `Typ „${def.label}“ angelegt` : `Typ „${def.label}“ gespeichert`)) {
      onClose();
      onSaved?.();
    }
  };

  const remove = async () => {
    if (!confirm(`Typ „${existing?.label ?? typeKey}“ löschen? Die Tags #${typeKey} und alle Feldwerte in den Notizen bleiben erhalten.`)) return;
    const next = { ...store().types };
    delete next[typeKey];
    if (await persist(next, 'Typ gelöscht')) {
      onClose();
      store().navigate({ view: 'tag', tag: typeKey });
    }
  };

  return (
    <Dialog
      title={isNew ? `Typ für #${typeKey} anlegen` : `Typ „${existing?.label ?? typeKey}“ bearbeiten`}
      onClose={onClose}
      width={720}
      className="te-dialog"
      footer={
        <>
          {!isNew && existing && (
            <button className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={14} /> Typ löschen
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || problems.length > 0} title={problems[0]}>
            {isNew ? 'Anlegen' : 'Speichern'}
          </button>
        </>
      }
    >
      <p className="te-intro">
        Jeder Eintrag mit <span className="tag">#{typeKey}</span> bekommt diese Felder. Ein Feld mit dem Schlüssel <code>date</code> ist das eingebaute Datum und erscheint in der Agenda.
      </p>
      <div className="te-grid">
        <label className="field">
          Bezeichnung
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus={isNew} />
        </label>
        <label className="field">
          Standardseite
          <input className="input" value={page} onChange={(e) => setPage(e.target.value)} placeholder="z. B. Personen" />
          <span className="field-hint">Hier landen neue Einträge dieses Typs.</span>
        </label>
        <div className="field">
          Farbe
          <div className="te-colors" role="radiogroup">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={`te-color${color === c ? ' is-active' : ''}`}
                style={{ ['--type-color' as string]: `var(--t-${c})` }}
                title={COLOR_NAMES[c]}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="te-fields-head">
        <h3>Felder</h3>
        <button
          className="btn btn-sm"
          onClick={() => setFields((fs) => [...fs, { uid: ++uid, key: '', label: '', kind: 'text', options: '', target: '', multiple: false }])}
        >
          <Plus size={14} /> Feld hinzufügen
        </button>
      </div>
      {fields.length === 0 ? (
        <div className="te-nofields">Noch keine Felder. Auch ohne Felder färbt ein Typ die Aufzählungspunkte und bekommt eine Tabellenansicht.</div>
      ) : (
        <div className="te-fields">
          <div className="te-row te-row-head">
            <span>Schlüssel</span>
            <span>Bezeichnung</span>
            <span>Art</span>
            <span>Optionen</span>
            <span />
          </div>
          {fields.map((f, i) => (
            <div className="te-row" key={f.uid}>
              <input className="input mono" value={f.key} placeholder="z. B. kunde" onChange={(e) => update(i, { key: e.target.value.trim() })} />
              <input className="input" value={f.label} placeholder={capitalize(f.key) || 'Bezeichnung'} onChange={(e) => update(i, { label: e.target.value })} />
              <select className="select" value={f.kind} onChange={(e) => update(i, { kind: e.target.value })}>
                {KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <div className="te-opts">
                {f.kind === 'select' && <input className="input" value={f.options} placeholder="offen, aktiv, fertig" onChange={(e) => update(i, { options: e.target.value })} />}
                {f.kind === 'ref' && (
                  <>
                    <select className="select" value={f.target} onChange={(e) => update(i, { target: e.target.value })} title="Nur Einträge dieses Typs vorschlagen">
                      <option value="">beliebig</option>
                      {otherTypes.map(([k, t]) => (
                        <option key={k} value={k}>
                          {t.label}
                        </option>
                      ))}
                      {fields.length > 0 && <option value={typeKey}>{label || typeKey} (dieser)</option>}
                    </select>
                    <label className="te-multi" title="Mehrere Verweise erlauben">
                      <input type="checkbox" checked={f.multiple} onChange={(e) => update(i, { multiple: e.target.checked })} /> mehrere
                    </label>
                  </>
                )}
                {f.kind === 'date' && f.key !== 'date' && <span className="te-note">Tipp: Schlüssel „date“ erscheint in der Agenda</span>}
              </div>
              <div className="te-actions">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Nach oben">
                  <ArrowUp size={14} />
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label="Nach unten">
                  <ArrowDown size={14} />
                </button>
                <button className="btn btn-ghost btn-icon btn-sm btn-danger" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} aria-label="Feld entfernen">
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
