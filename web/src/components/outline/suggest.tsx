// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Vorschläge beim Tippen: Slash-Befehle, #Tags, @Erwähnungen, [[Links.

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AtSign, Bell, CalendarClock, CalendarDays, CheckSquare, Code2, FileText, FolderInput, Hash, Heading1, Heading2, Heading3, ImagePlus, Link2, Plus, Repeat, StickyNote, Table2, Text, ZoomIn } from 'lucide-react';
import { api } from '../../lib/api';
import { humanWhen } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { plainText } from '../../lib/inline';
import { languageLabel } from '../../lib/code';
import { linkTextFor } from '../../lib/links';
import { typeHome } from '../../lib/outline';
import { ancestors, store, whenSaved } from '../../lib/store';
import type { CommandResult, Hit, Node } from '../../lib/types';
import { caretAnchor, Highlighted, Popover, useScrollActive, type Anchor } from '../ui';
import { L, lang } from '../../i18n';

export type TriggerKind = 'slash' | 'tag' | 'mention' | 'link';

export interface Trigger {
  kind: TriggerKind;
  /** Position des Auslösers (`/`, `#`, `@`, `[[`) im Text. */
  start: number;
  query: string;
}

/** Erkennt einen offenen Auslöser direkt vor dem Cursor. */
export function detectTrigger(text: string, caret: number, kinds: TriggerKind[] = ['slash', 'tag', 'mention', 'link']): Trigger | null {
  const before = text.slice(0, caret);
  let m: RegExpExecArray | null;
  if (kinds.includes('link') && (m = /\[\[([^\]\n[]{0,80})$/.exec(before))) return { kind: 'link', start: m.index, query: m[1] };
  if (kinds.includes('slash') && (m = /(?:^|\s)\/([^\n/]{0,60})$/.exec(before))) {
    const q = m[1];
    if (!/\s{2}$/.test(q)) return { kind: 'slash', start: before.length - q.length - 1, query: q };
  }
  if (kinds.includes('tag') && (m = /(?:^|[\s(])#([\p{L}\p{N}_\-/]{0,60})$/u.exec(before))) return { kind: 'tag', start: before.length - m[1].length - 1, query: m[1] };
  if (kinds.includes('mention') && (m = /(?:^|[\s(])@([\p{L}\p{N}_.\-]+(?: [\p{L}\p{N}_.\-]+)?)?$/u.exec(before))) {
    const q = m[1] ?? '';
    return { kind: 'mention', start: before.length - q.length - 1, query: q };
  }
  return null;
}

export interface SuggestItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  path?: ReactNode;
  section?: string;
  /** Führt die Auswahl aus; `text`/`caret` ersetzen den Feldinhalt. */
  run: () => Promise<{ text: string; caret: number } | null | void> | { text: string; caret: number } | null | void;
}

export interface SuggestContext {
  /** Knoten, der bearbeitet wird (nicht in der Schnellerfassung). */
  nodeId?: string;
  text: string;
  caret: number;
  /** Text ohne den Auslöser bis zum Cursor. */
  without: () => { text: string; caret: number };
  /** Ersetzt den Auslöser durch `insert`. */
  replace: (insert: string) => { text: string; caret: number };
  onCommand?: (r: CommandResult, rest: { text: string; caret: number }) => void;
  onAction?: (action: string, arg?: string, rest?: { text: string; caret: number }) => void;
  /** Befehle, die in diesem Feld angeboten werden. */
  commands?: 'full' | 'capture';
}

interface Cmd {
  id: string;
  label: string;
  words: string[];
  icon: ReactNode;
  hint?: string;
  /** Fügt einen Befehl mit Argument ein (`/termin `) statt sofort auszuführen. */
  insert?: string;
  capture?: boolean;
}

/**
 * Suchwörter der Befehle – Deutsch und Englisch gelten immer, unabhängig von
 * der Sprache der Oberfläche. Die Wörter mit Argument (`termin`, `due` …)
 * versteht auch der Server (src/capture.rs).
 */
const WORDS: Record<string, { de: string[]; en: string[] }> = {
  today: { de: ['heute'], en: ['today'] },
  tomorrow: { de: ['morgen'], en: ['tomorrow'] },
  nextweek: { de: ['nächste woche', 'naechste woche'], en: ['next week'] },
  date: { de: ['termin', 'datum', 'am', 'um'], en: ['date', 'event'] },
  due: { de: ['fällig', 'faellig', 'bis'], en: ['due', 'deadline'] },
  repeat: { de: ['wiederholung', 'wdh', 'jeden', 'alle'], en: ['repeat', 'every'] },
  remind: { de: ['erinnerung', 'alarm'], en: ['remind', 'reminder'] },
  todo: { de: ['todo', 'aufgabe'], en: ['todo', 'task'] },
  h1: { de: ['h1', 'überschrift'], en: ['h1', 'heading'] },
  h2: { de: ['h2', 'überschrift'], en: ['h2', 'heading'] },
  h3: { de: ['h3', 'überschrift'], en: ['h3', 'heading'] },
  text: { de: ['text', 'normal'], en: ['text', 'normal', 'paragraph'] },
  note: { de: ['notiz', 'beschreibung'], en: ['note', 'description'] },
  code: { de: ['code', 'codeblock'], en: ['code', 'codeblock', 'snippet'] },
  image: { de: ['bild', 'foto', 'grafik', 'datei'], en: ['image', 'picture', 'photo', 'file'] },
  table: { de: ['tabelle', 'raster'], en: ['table', 'grid'] },
  move: { de: ['einsortieren', 'verschieben'], en: ['move'] },
  page: { de: ['seite', 'auslagern'], en: ['page'] },
  zoom: { de: ['zoom', 'öffnen', 'fokus'], en: ['zoom', 'open', 'focus'] },
  type: { de: ['typ'], en: ['type'] },
};

/** Suchwörter eines Befehls, die der gewählten Sprache zuerst. */
function words(id: string, extra: string[] = []): string[] {
  const w = WORDS[id];
  const [first, second] = lang() === 'en' ? [w.en, w.de] : [w.de, w.en];
  return [...new Set([...extra, ...first, ...second])];
}

function commands(): Cmd[] {
  const types = store().types;
  const t = L.outline.suggest.cmd;
  const ins = L.outline.suggest.insert;
  const keys = L.outline.keys;
  const base: Cmd[] = [
    { id: 'today', label: t.today, words: words('today'), icon: <CalendarDays size={15} />, capture: true },
    { id: 'tomorrow', label: t.tomorrow, words: words('tomorrow'), icon: <CalendarDays size={15} />, capture: true },
    { id: 'nextweek', label: t.nextweek, words: words('nextweek'), icon: <CalendarDays size={15} />, capture: true },
    { id: 'date', label: t.date, words: words('date'), icon: <CalendarClock size={15} />, hint: t.dateHint, insert: ins.date, capture: true },
    { id: 'due', label: t.due, words: words('due'), icon: <CheckSquare size={15} />, hint: t.dueHint, insert: ins.due, capture: true },
    { id: 'repeat', label: t.repeat, words: words('repeat'), icon: <Repeat size={15} />, hint: t.repeatHint, insert: ins.repeat, capture: true },
    { id: 'remind', label: t.remind, words: words('remind'), icon: <Bell size={15} />, hint: t.remindHint, insert: ins.remind, capture: true },
    { id: 'todo', label: t.todo, words: words('todo'), icon: <CheckSquare size={15} />, capture: true },
    { id: 'h1', label: t.h1, words: words('h1'), icon: <Heading1 size={15} /> },
    { id: 'h2', label: t.h2, words: words('h2'), icon: <Heading2 size={15} /> },
    { id: 'h3', label: t.h3, words: words('h3'), icon: <Heading3 size={15} /> },
    { id: 'text', label: t.text, words: words('text'), icon: <Text size={15} /> },
    { id: 'note', label: t.note, words: words('note'), icon: <StickyNote size={15} />, hint: keys.shiftEnterText },
    { id: 'code', label: t.code, words: words('code'), icon: <Code2 size={15} /> },
    { id: 'image', label: t.image, words: words('image'), icon: <ImagePlus size={15} />, hint: t.imageHint },
    { id: 'table', label: t.table, words: words('table'), icon: <Table2 size={15} />, hint: t.tableHint },
    { id: 'move', label: t.move, words: words('move'), icon: <FolderInput size={15} />, hint: keys.ctrlM },
    { id: 'page', label: t.page, words: words('page'), icon: <FileText size={15} /> },
    { id: 'zoom', label: t.zoom, words: words('zoom'), icon: <ZoomIn size={15} />, hint: keys.altRight },
  ];
  for (const [key, ty] of Object.entries(types)) {
    base.push({ id: `type:${key}`, label: t.type(ty.label), words: words('type', [key, ty.label.toLowerCase()]), icon: <span className="type-dot" style={{ ['--type-color' as string]: `var(--t-${ty.color ?? 'gray'})` }} />, capture: true });
  }
  return base;
}

function matchCmd(c: Cmd, q: string): boolean {
  if (!q) return true;
  const l = q.toLowerCase();
  return c.words.some((w) => w.startsWith(l) || l.startsWith(w + ' ')) || c.label.toLowerCase().startsWith(l);
}

function pathOf(n: Node | undefined): string {
  if (!n) return '';
  const { nodes } = store();
  return ancestors(nodes, n.id)
    .map((a) => (a.kind === 'item' ? plainText(a.text, false) : a.text))
    .join(' › ');
}

function hitItem(hit: Hit, run: (n: Node) => ReturnType<SuggestItem['run']>, section?: string): SuggestItem | null {
  const n = store().nodes[hit.id];
  if (!n) return null;
  const title = n.kind === 'item' ? plainText(n.text) : n.text;
  return {
    key: hit.id,
    section,
    icon: n.kind === 'page' ? <FileText size={15} /> : n.tags.includes('person') ? <AtSign size={15} /> : <span className="menu-bullet" />,
    label: <Highlighted text={title} ranges={hit.titleRanges} />,
    path: pathOf(n),
    run: () => run(n),
  };
}

const today = () => new Date();

/** Lädt Vorschläge für den aktuellen Auslöser. */
export function useSuggestions(trigger: Trigger | null, ctx: SuggestContext): { items: SuggestItem[]; loading: boolean } {
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const kind = trigger?.kind;
  const query = trigger?.query;

  useEffect(() => {
    if (!kind || query === undefined) {
      setItems([]);
      return;
    }
    const ac = new AbortController();
    const c = () => ctxRef.current;
    let alive = true;
    const finish = (list: SuggestItem[]) => {
      if (alive) {
        setItems(list);
        setLoading(false);
      }
    };
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        if (kind === 'slash') {
          const capture = c().commands === 'capture';
          const list: SuggestItem[] = [];
          const q = query.trim();
          let parsed: CommandResult | null = null;
          if (q) parsed = await api.parseCommand(query, ac.signal).catch(() => null);
          if (parsed && parsed.consumed > 0) {
            const r = parsed;
            const icon = r.kind === 'repeat' ? <Repeat size={15} /> : r.kind === 'remind' ? <Bell size={15} /> : r.kind === 'todo' ? <CheckSquare size={15} /> : <CalendarClock size={15} />;
            list.push({
              key: 'parsed',
              icon,
              label: r.human,
              hint: r.kind === 'date' || r.kind === 'due' ? humanWhen(r.value) : undefined,
              run: () => {
                const rest = c().without();
                c().onCommand?.(r, rest);
                return rest;
              },
            });
          }
          const firstWord = q.split(/\s+/)[0] ?? '';
          const hasArgs = /\s/.test(query.trimStart());
          for (const cmd of commands()) {
            if (capture && !cmd.capture) continue;
            if (hasArgs ? !cmd.words.some((w) => w === firstWord.toLowerCase() || w.startsWith(q.toLowerCase())) : !matchCmd(cmd, q)) continue;
            if (hasArgs && cmd.insert) continue;
            const arg = hasArgs ? q.slice(firstWord.length).trim() : '';
            list.push({
              key: cmd.id,
              icon: cmd.icon,
              label: cmd.id === 'code' && arg ? L.outline.suggest.cmd.codeWith(languageLabel(arg)) : cmd.label,
              hint: cmd.id === 'code' && !arg ? L.outline.suggest.cmd.codeHint : cmd.hint,
              run: async () => {
                if (cmd.insert) return c().replace('/' + cmd.insert);
                const rest = c().without();
                const quick = { today: 'heute', tomorrow: 'morgen', nextweek: 'nächste woche' }[cmd.id as 'today'];
                if (quick) {
                  const r = await api.parseCommand(quick);
                  if (r) c().onCommand?.(r, rest);
                  return rest;
                }
                if (cmd.id === 'todo') {
                  c().onCommand?.({ kind: 'todo', field: '', value: '', human: 'Todo', consumed: 4 }, rest);
                  return rest;
                }
                if (cmd.id.startsWith('type:')) {
                  const tag = cmd.id.slice(5);
                  const t = rest.text.slice(0, rest.caret);
                  const sep = t && !/\s$/.test(t) ? ' ' : '';
                  const text = t + sep + '#' + tag + ' ' + rest.text.slice(rest.caret).replace(/^\s+/, '');
                  return { text, caret: t.length + sep.length + tag.length + 2 };
                }
                c().onAction?.(cmd.id, arg, rest);
                return rest;
              },
            });
          }
          if (!list.length && q) list.push({ key: 'none', label: <span className="subtle">{L.outline.suggest.noCommand}</span>, run: () => null });
          finish(list);
          return;
        }
        if (kind === 'tag') {
          const tags = await api.tags(query, 12, ac.signal);
          const types = store().types;
          const list: SuggestItem[] = tags.map((t) => ({
            key: t.tag,
            icon: types[t.tag] ? <span className="type-dot" style={{ ['--type-color' as string]: `var(--t-${types[t.tag].color ?? 'gray'})` }} /> : <Hash size={15} />,
            label: <Highlighted text={t.tag} ranges={t.ranges} />,
            hint: types[t.tag] ? types[t.tag].label : t.count ? String(t.count) : undefined,
            run: () => c().replace(`#${t.tag} `),
          }));
          const q = query.replace(/\/+$/, '');
          if (q && !tags.some((t) => t.tag === q.toLowerCase())) list.push({ key: 'new', icon: <Plus size={15} />, label: L.outline.suggest.newTag(q), run: () => c().replace(`#${q} `) });
          finish(list);
          return;
        }
        if (kind === 'mention' || kind === 'link') {
          const link = async (n: Node) => {
            const text = await linkTextFor(store().nodes, n.id, api.link);
            return c().replace(text + (kind === 'link' ? '' : ' '));
          };
          const list: SuggestItem[] = [];
          const seen = new Set<string>();
          if (kind === 'mention') {
            const people = await api.search(`#person ${query}`, 8, ac.signal);
            for (const h of people.hits) {
              const it = hitItem(h, link, L.outline.suggest.people);
              if (it && it.key !== c().nodeId) {
                list.push(it);
                seen.add(h.id);
              }
            }
          }
          if (query.trim() || kind === 'link') {
            const all = await api.search(kind === 'link' ? query || 'is:page' : query, 10, ac.signal);
            for (const h of all.hits) {
              if (seen.has(h.id) || h.id === c().nodeId) continue;
              const it = hitItem(h, link, kind === 'mention' ? L.outline.suggest.more : undefined);
              if (it) list.push(it);
            }
          }
          const q = query.trim();
          if (q && kind === 'mention') {
            list.push({
              key: 'new-person',
              icon: <Plus size={15} />,
              label: L.outline.suggest.newPerson(q),
              hint: typeHome('person')?.text,
              run: async () => {
                const home = await ensureTypeHome('person');
                const id = newId();
                if (!home) return null;
                store().commit([{ op: 'create', id, parent: home, text: `${q} #person` }]);
                await whenSaved();
                const text = await linkTextFor(store().nodes, id, api.link).catch(() => `[[${q}]]`);
                return c().replace(text + ' ');
              },
            });
          }
          if (q && kind === 'link' && !list.some((i) => store().nodes[i.key]?.kind === 'page' && store().nodes[i.key]?.text.toLowerCase() === q.toLowerCase())) {
            list.push({ key: 'new-page', icon: <Link2 size={15} />, label: L.outline.suggest.newPage(q), run: () => c().replace(`[[${q}]]`) });
          }
          if (!list.length) list.push({ key: 'none', label: <span className="subtle">{q ? L.outline.suggest.nothingFound : L.outline.suggest.typeName}</span>, run: () => null });
          finish(list);
        }
      } catch {
        if (alive) setLoading(false);
      }
    }, kind === 'slash' ? 40 : 60);
    return () => {
      alive = false;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [kind, query]);
  void today;
  return { items, loading };
}

/** Legt bei Bedarf die Standardseite eines Typs an (z. B. „Personen“). */
export async function ensureTypeHome(type: string): Promise<string | null> {
  const t = store().types[type];
  const existing = typeHome(type);
  if (existing && (!t?.page || existing.id !== store().inbox)) return existing.id;
  if (!t?.page) return store().inbox;
  const id = newId();
  if (!store().commit([{ op: 'create', id, parent: store().root, page: true, text: t.page }], { noUndo: true })) return store().inbox;
  return id;
}

export function SuggestMenu({ anchor, items, active, onPick, onHover, loading, footer }: { anchor: Anchor; items: SuggestItem[]; active: number; onPick: (i: number) => void; onHover: (i: number) => void; loading?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollActive(ref, active);
  if (!items.length && !loading) return null;
  let lastSection: string | undefined;
  return (
    <Popover anchor={anchor} width={360} className="suggest">
      <div className="menu" ref={ref}>
        {!items.length && loading && <div className="menu-empty">{L.outline.suggest.searching}</div>}
        {items.map((it, i) => {
          const head = it.section && it.section !== lastSection ? <div className="menu-section">{it.section}</div> : null;
          lastSection = it.section;
          return (
            <div key={it.key}>
              {head}
              <button className={`menu-item${i === active ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(i)} onMouseMove={() => onHover(i)}>
                {it.icon && <span className="menu-icon">{it.icon}</span>}
                <span className="menu-label">
                  {it.label}
                  {it.path && <span className="menu-path">{it.path}</span>}
                </span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
              </button>
            </div>
          );
        })}
      </div>
      {footer && <div className="menu-footer">{footer}</div>}
    </Popover>
  );
}

interface UseSuggestOptions {
  el?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** Bildschirmposition einer Textstelle (für Editoren ohne Textfeld). */
  anchorAt?: (index: number) => Anchor | null;
  text: string;
  /** Übernimmt einen neuen Text samt Cursor. */
  apply: (text: string, caret: number) => void;
  nodeId?: string;
  kinds?: TriggerKind[];
  commands?: 'full' | 'capture';
  onCommand?: (r: CommandResult, rest: { text: string; caret: number }) => void;
  onAction?: (action: string, arg?: string, rest?: { text: string; caret: number }) => void;
}

/** Bindet Vorschläge an ein Textfeld. `update` nach jeder Eingabe/Cursorbewegung aufrufen. */
export function useSuggest(o: UseSuggestOptions) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [caret, setCaret] = useState(0);
  const dismissed = useRef<number | null>(null);
  const openRef = useRef(false);

  /** `opening`: Eingabe des Nutzers – nur dann darf sich das Menü neu öffnen
   *  (nicht schon, weil der Cursor hinter einem vorhandenen #tag landet). */
  const update = useCallback(
    (text: string, pos: number, opening = true) => {
      setCaret(pos);
      const t = detectTrigger(text, pos, o.kinds);
      if (!t || dismissed.current === t.start || (!opening && !openRef.current)) {
        if (!t) dismissed.current = null;
        openRef.current = false;
        setTrigger(null);
        return;
      }
      openRef.current = true;
      setTrigger((prev) => {
        if (!prev || prev.start !== t.start || prev.kind !== t.kind) setActive(0);
        return t;
      });
      const el = o.el?.current;
      const a = o.anchorAt ? o.anchorAt(t.start) : el ? caretAnchor(el, t.start) : null;
      if (a) setAnchor(a);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o.el, (o.kinds ?? []).join()],
  );

  const ctx: SuggestContext = {
    nodeId: o.nodeId,
    text: o.text,
    caret,
    commands: o.commands,
    onCommand: o.onCommand,
    onAction: o.onAction,
    without: () => {
      if (!trigger) return { text: o.text, caret };
      let head = o.text.slice(0, trigger.start);
      let tail = o.text.slice(caret);
      if (/\s$/.test(head) && /^\s/.test(tail)) tail = tail.replace(/^\s+/, '');
      if (!tail && /\s$/.test(head)) head = head.replace(/\s+$/, '');
      return { text: head + tail, caret: head.length };
    },
    replace: (insert: string) => {
      if (!trigger) return { text: o.text, caret };
      const head = o.text.slice(0, trigger.start) + insert;
      let tail = o.text.slice(caret);
      if (trigger.kind === 'link' && tail.startsWith(']]')) tail = tail.slice(2);
      if (insert.endsWith(' ') && tail.startsWith(' ')) tail = tail.slice(1);
      return { text: head + tail, caret: head.length };
    },
  };
  const { items, loading } = useSuggestions(trigger, ctx);

  const pick = async (i: number) => {
    const it = items[i];
    if (!it) return;
    const keep = trigger;
    const r = await it.run();
    if (r) {
      o.apply(r.text, r.caret);
      // Eingefügter Befehl mit Argument (`/termin `): Menü bleibt offen.
      window.setTimeout(() => update(r.text, r.caret), 0);
    } else if (keep) {
      setTrigger(null);
    }
  };

  const open = !!trigger && (items.length > 0 || loading);

  /** Liefert `true`, wenn die Taste vom Menü verarbeitet wurde. */
  const onKeyDown = (e: Pick<globalThis.KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'preventDefault' | 'stopPropagation'>): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey && items.length) {
      e.preventDefault();
      void pick(active);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismissed.current = trigger!.start;
      setTrigger(null);
      return true;
    }
    return false;
  };

  const close = () => {
    openRef.current = false;
    setTrigger(null);
  };

  const menu =
    open && anchor ? (
      <SuggestMenu
        anchor={anchor}
        items={items}
        active={active}
        loading={loading}
        onPick={(i) => void pick(i)}
        onHover={setActive}
        footer={trigger?.kind === 'slash' ? L.outline.suggest.footer : undefined}
      />
    ) : null;

  return { update, onKeyDown, menu, open, close, trigger };
}
