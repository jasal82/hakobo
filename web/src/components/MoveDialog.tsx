// Einsortieren (Knoten verschieben) und Zuordnen (Tags/Links vergeben).

import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, FilePlus2, FolderInput, Hash, Link2, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { newId } from '../lib/ids';
import { tokenize } from '../lib/inline';
import { linkLabel, linkTextFor, resolveKey } from '../lib/links';
import { addTag, moveInto } from '../lib/outline';
import { field, isAncestor, store, useStore } from '../lib/store';
import type { Node, TagHit } from '../lib/types';
import { allPages, NodeIcon, nodeTitle, PathLine, pathTitles, pushList, readList, useCandidates, useListKeys } from './search/common';
import { Dialog, Highlighted, useScrollActive } from './ui';

const MOVE_TARGETS = 'sqizzo-move-targets';

/** Darf `ids` unter `target` verschoben werden? */
function validTarget(nodes: Record<string, Node>, ids: string[], target: string): boolean {
  const t = nodes[target];
  if (!t) return false;
  for (const id of ids) {
    const n = nodes[id];
    if (!n || id === target || isAncestor(nodes, id, target)) return false;
    if (n.kind === 'item' && t.kind === 'root') return false;
    if (n.kind === 'page' && t.kind === 'item') return false;
  }
  return true;
}

export function MoveDialog() {
  const move = useStore((s) => s.move);
  const nodes = useStore((s) => s.nodes);
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const ids = useMemo(() => (move?.ids ?? []).filter((id) => nodes[id]), [move, nodes]);
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const movingPages = ids.some((id) => nodes[id]?.kind === 'page');

  const { list: raw, loading } = useCandidates(q, () => {
    const recent = readList(MOVE_TARGETS);
    const pages = allPages(nodes, inbox);
    const out = [...recent, ...(movingPages ? [root] : []), ...pages];
    return [...new Set(out)];
  });
  const list = raw.filter((c) => validTarget(nodes, ids, c.id)).slice(0, 40);
  const newPage = q.trim();
  const count = list.length + (newPage ? 1 : 0);
  const { active, setActive, onKey } = useListKeys(count, [q]);
  useScrollActive(listRef, active);

  const close = () => store().set({ move: null });
  const parents = new Set(ids.map((id) => nodes[id]?.parent));

  const go = (target: string, open: boolean) => {
    if (!validTarget(store().nodes, ids, target)) return;
    pushList(MOVE_TARGETS, target, 12);
    close();
    moveInto(ids, target);
    if (open && ids[0]) window.setTimeout(() => store().reveal(ids[0]), 30);
  };

  const createAndGo = (open: boolean) => {
    const id = newId();
    if (!store().commit([{ op: 'create', id, parent: root, page: true, text: newPage }])) return;
    go(id, open);
  };

  const pick = (i: number, open: boolean) => {
    if (i < list.length) go(list[i].id, open);
    else if (newPage) createAndGo(open);
  };

  if (!ids.length) return null;
  const first = nodes[ids[0]];
  const label = nodeTitle(first) || 'Eintrag';

  return (
    <Dialog onClose={close} width={620} className="pick-dialog">
      <div className="pick-head">
        <FolderInput size={16} />
        <span className="pick-title">
          Einsortieren: <b>{label.length > 60 ? `${label.slice(0, 60)}…` : label}</b>
          {ids.length > 1 && <span className="faint"> und {ids.length - 1} weitere</span>}
        </span>
      </div>
      <div className="sp-input pick-input">
        <input
          autoFocus
          value={q}
          placeholder="Ziel suchen: Seite oder Eintrag …"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (onKey(e)) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              pick(active, e.shiftKey);
            }
          }}
          spellCheck={false}
        />
        {loading && <span className="spinner" />}
      </div>
      <div className="pick-list" ref={listRef}>
        {!q.trim() && <div className="menu-section">Seiten und zuletzt genutzte Ziele</div>}
        {list.map((c, i) => {
          const n = nodes[c.id];
          return (
            <button key={c.id} className={`sp-row${i === active ? ' is-active' : ''}`} onMouseMove={() => setActive(i)} onClick={(e) => go(c.id, e.shiftKey)}>
              <span className="sp-icon">
                <NodeIcon n={n} inbox={inbox} />
              </span>
              <span className="sp-main">
                <span className="sp-title">
                  <Highlighted text={nodeTitle(n)} ranges={c.hit?.titleRanges} />
                  {parents.has(c.id) && <span className="chip">aktueller Ort</span>}
                </span>
                <PathLine parts={pathTitles(nodes, c.id)} ranges={c.hit?.pathRanges} />
              </span>
              {i === active && <CornerDownLeft size={14} className="sp-enter" />}
            </button>
          );
        })}
        {newPage && (
          <button className={`sp-row${active === list.length ? ' is-active' : ''}`} onMouseMove={() => setActive(list.length)} onClick={(e) => createAndGo(e.shiftKey)}>
            <span className="sp-icon">
              <FilePlus2 size={15} />
            </span>
            <span className="sp-main">
              <span className="sp-title">Neue Seite „{newPage}“</span>
              <span className="sp-path">in der obersten Ebene anlegen und hineinschieben</span>
            </span>
          </button>
        )}
        {q.trim() && !loading && !list.length && <div className="sp-empty">Kein passendes Ziel.</div>}
      </div>
      <div className="sp-foot">
        <span>
          <kbd>↵</kbd> verschieben
        </span>
        <span>
          <kbd>Umschalt</kbd>
          <kbd>↵</kbd> verschieben und hinspringen
        </span>
        <span>
          <kbd>Esc</kbd> abbrechen
        </span>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Zuordnen
// ---------------------------------------------------------------------------

type AssignItem = { kind: 'tag'; tag: string; hit?: TagHit; isNew?: boolean } | { kind: 'node'; id: string; ranges?: [number, number][]; pathRanges?: [number, number, number][] };

/** Tags und Links im Text eines Knotens (mit Position zum Entfernen). */
function refsOf(n: Node): { kind: 'tag' | 'link'; key: string; label: string; s: number; e: number; id?: string | null }[] {
  const nodes = store().nodes;
  const out: { kind: 'tag' | 'link'; key: string; label: string; s: number; e: number; id?: string | null }[] = [];
  const walk = (segs: ReturnType<typeof tokenize>) => {
    for (const s of segs) {
      if (s.t === 'tag') out.push({ kind: 'tag', key: `#${s.tag.toLowerCase()}`, label: s.raw, s: s.s, e: s.e });
      else if (s.t === 'link') {
        const id = resolveKey(nodes, n, s.key);
        out.push({ kind: 'link', key: s.raw, label: linkLabel(nodes, id, s.alias, s.target), s: s.s, e: s.e, id });
      } else if ('children' in s) walk(s.children);
    }
  };
  walk(tokenize(n.text));
  return out;
}

function cut(text: string, s: number, e: number): string {
  return (text.slice(0, s).replace(/\s+$/, '') + ' ' + text.slice(e).replace(/^\s+/, '')).trim();
}

export function AssignDialog() {
  const assign = useStore((s) => s.assign);
  const node = useStore((s) => (assign ? s.nodes[assign.id] : undefined));
  const nodes = useStore((s) => s.nodes);
  const inbox = useStore((s) => s.inbox);
  const types = useStore((s) => s.types);
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<TagHit[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isTagQuery = q.startsWith('#');
  const isPersonQuery = q.startsWith('@');
  const term = q.replace(/^[#@]/, '').trim();

  useEffect(() => {
    if (isPersonQuery) {
      setTags([]);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      api.tags(term, 8, ac.signal).then(setTags, () => undefined);
    }, 15);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [term, isPersonQuery]);

  const nodeQuery = isTagQuery ? '' : isPersonQuery ? `#person ${term}` : term;
  const { list: cands } = useCandidates(nodeQuery, () => (isPersonQuery ? Object.values(store().nodes).filter((n) => n.tags.includes('person')).map((n) => n.id).slice(0, 12) : []), 10);

  const existing = node ? refsOf(node) : [];
  const existingKeys = new Set(existing.map((r) => (r.kind === 'tag' ? r.key : r.id ?? r.key)));
  const items: AssignItem[] = [];
  if (!isPersonQuery) {
    // Verschachtelte Tags: auch die Elternebenen anbieten (projekte, projekte/sqonto).
    const all: TagHit[] = [...tags];
    const lower = term.toLowerCase();
    for (const t of tags) {
      const parts = t.tag.split('/');
      for (let i = parts.length - 1; i > 0; i--) {
        const parent = parts.slice(0, i).join('/');
        if (all.some((x) => x.tag === parent) || (lower && !parent.includes(lower))) continue;
        const at = lower ? parent.indexOf(lower) : -1;
        all.push({ tag: parent, count: 0, ranges: at >= 0 ? [[at, at + lower.length]] : [] });
      }
    }
    for (const t of all) if (!existingKeys.has(`#${t.tag}`)) items.push({ kind: 'tag', tag: t.tag, hit: t });
    const clean = term.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-/]/gu, '').replace(/^\/+|\/+$/g, '');
    if (clean && /[\p{L}_-]/u.test(clean) && !all.some((t) => t.tag === clean.toLowerCase())) items.push({ kind: 'tag', tag: clean, isNew: true });
  }
  if (!isTagQuery) {
    for (const c of cands) {
      if (!node || c.id === node.id || existingKeys.has(c.id) || !nodes[c.id] || nodes[c.id].kind === 'root') continue;
      items.push({ kind: 'node', id: c.id, ranges: c.hit?.titleRanges, pathRanges: c.hit?.pathRanges });
    }
  }
  const { active, setActive, onKey } = useListKeys(items.length, [q, tags.length]);
  useScrollActive(listRef, active);

  const close = () => store().set({ assign: null });
  if (!node) return null;

  const refocus = () => {
    setQ('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const apply = async (it: AssignItem, andMove: boolean) => {
    if (it.kind === 'tag') {
      addTag(node.id, it.tag);
      refocus();
      return;
    }
    const link = await linkTextFor(store().nodes, it.id, api.link);
    const cur = store().nodes[node.id];
    if (!cur) return;
    if (cur.kind === 'page') store().commit([{ op: 'update', id: cur.id, body: cur.body ? `${cur.body}\n\n${link}` : link }]);
    else store().commit([{ op: 'update', id: cur.id, text: `${cur.text.trimEnd()}${cur.text.trim() ? ' ' : ''}${link}` }]);
    if (andMove) {
      close();
      moveInto([node.id], it.id);
      return;
    }
    refocus();
  };

  const remove = (r: (typeof existing)[number]) => {
    const cur = store().nodes[node.id];
    if (!cur) return;
    if (cur.kind === 'page' && r.kind === 'tag') {
      const rest = (field(cur, 'tags') ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && `#${t.replace(/^#/, '').toLowerCase()}` !== r.key);
      store().commit([{ op: 'update', id: cur.id, fields: rest.length ? cur.fields.map((f) => (f.key === 'tags' ? { ...f, value: rest.join(', ') } : f)) : cur.fields.filter((f) => f.key !== 'tags') }]);
      return;
    }
    store().commit([{ op: 'update', id: cur.id, text: cut(cur.text, r.s, r.e) }]);
  };

  const pageTags = node.kind === 'page' ? (field(node, 'tags') ?? '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean) : [];
  const chips = [...existing, ...pageTags.map((t) => ({ kind: 'tag' as const, key: `#${t.toLowerCase()}`, label: `#${t}`, s: 0, e: 0 }))];

  return (
    <Dialog onClose={close} width={620} className="pick-dialog">
      <div className="pick-head">
        <Hash size={16} />
        <span className="pick-title">
          Zuordnen: <b>{nodeTitle(node).slice(0, 70) || 'Eintrag'}</b>
        </span>
        <button className="btn btn-ghost btn-sm" onClick={close}>
          Fertig
        </button>
      </div>
      <div className="assign-current">
        {chips.length ? (
          chips.map((r) => (
            <span key={r.key + r.s} className={`chip assign-chip${r.kind === 'tag' ? ' is-tag' : ''}`}>
              {r.kind === 'link' && <Link2 size={12} />}
              {r.label}
              <button className="chip-x" onClick={() => remove(r)} aria-label="Entfernen" title="Entfernen">
                <X size={12} />
              </button>
            </span>
          ))
        ) : (
          <span className="faint">Noch keine Tags oder Links.</span>
        )}
      </div>
      <div className="sp-input pick-input">
        <input
          ref={inputRef}
          autoFocus
          value={q}
          placeholder="Tag, Projekt, Person oder Seite … (# nur Tags, @ nur Personen)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (onKey(e)) return;
            if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              void apply(items[active], e.altKey);
            }
          }}
          spellCheck={false}
        />
      </div>
      <div className="pick-list" ref={listRef}>
        {items.map((it, i) => {
          const isActive = i === active;
          if (it.kind === 'tag') {
            const t = types[it.tag.toLowerCase()];
            return (
              <button key={`t:${it.tag}`} className={`sp-row${isActive ? ' is-active' : ''}`} onMouseMove={() => setActive(i)} onClick={(e) => void apply(it, e.altKey)}>
                <span className="sp-icon">{it.isNew ? <Plus size={15} /> : t ? <span className="ni-dot" style={{ ['--type-color' as string]: `var(--t-${t.color ?? 'gray'})` }} /> : <Hash size={15} />}</span>
                <span className="sp-main">
                  <span className="sp-title">
                    {it.isNew ? `Neuer Tag #${it.tag}` : <span>#<Highlighted text={it.tag} ranges={it.hit?.ranges} /></span>}
                    {t && <span className="chip">Typ {t.label}</span>}
                  </span>
                </span>
                {it.hit && it.hit.count > 0 && <span className="faint sp-count">{it.hit.count}</span>}
              </button>
            );
          }
          const n = nodes[it.id];
          return (
            <button key={`n:${it.id}`} className={`sp-row${isActive ? ' is-active' : ''}`} onMouseMove={() => setActive(i)} onClick={(e) => void apply(it, e.altKey)}>
              <span className="sp-icon">
                <NodeIcon n={n} inbox={inbox} />
              </span>
              <span className="sp-main">
                <span className="sp-title">
                  <Highlighted text={nodeTitle(n)} ranges={it.ranges} />
                </span>
                <PathLine parts={pathTitles(nodes, n.id)} ranges={it.pathRanges} />
              </span>
              <Link2 size={14} className="faint" />
            </button>
          );
        })}
        {!items.length && <div className="sp-empty">{q ? 'Nichts gefunden.' : 'Tippen, um Tags (auch verschachtelt wie projekte/sqonto) oder Seiten zu finden.'}</div>}
      </div>
      <div className="sp-foot">
        <span>
          <kbd>↵</kbd> zuordnen
        </span>
        <span>
          <kbd>Alt</kbd>
          <kbd>↵</kbd> verlinken und dorthin einsortieren
        </span>
        <span>
          <kbd>Esc</kbd> fertig
        </span>
      </div>
    </Dialog>
  );
}
