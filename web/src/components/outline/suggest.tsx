// Vorschläge beim Tippen: Slash-Befehle, #Tags, @Erwähnungen, [[Links.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { AtSign, Bell, CalendarClock, CalendarDays, CheckSquare, Code2, FileText, FolderInput, Hash, Heading1, Heading2, Heading3, Link2, Plus, Repeat, StickyNote, Text, ZoomIn } from 'lucide-react';
import { api } from '../../lib/api';
import { humanWhen } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { plainText } from '../../lib/inline';
import { linkTextFor } from '../../lib/links';
import { typeHome } from '../../lib/outline';
import { ancestors, store, whenSaved } from '../../lib/store';
import type { CommandResult, Hit, Node } from '../../lib/types';
import { caretAnchor, Highlighted, Popover, useScrollActive, type Anchor } from '../ui';

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
  onAction?: (action: string) => void;
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

function commands(): Cmd[] {
  const types = store().types;
  const base: Cmd[] = [
    { id: 'today', label: 'Heute', words: ['heute', 'today'], icon: <CalendarDays size={15} />, capture: true },
    { id: 'tomorrow', label: 'Morgen', words: ['morgen', 'tomorrow'], icon: <CalendarDays size={15} />, capture: true },
    { id: 'nextweek', label: 'Nächste Woche', words: ['nächste woche', 'naechste woche', 'next week'], icon: <CalendarDays size={15} />, capture: true },
    { id: 'date', label: 'Termin …', words: ['termin', 'datum', 'date', 'am', 'um'], icon: <CalendarClock size={15} />, hint: 'morgen 14-15 uhr', insert: 'termin ', capture: true },
    { id: 'due', label: 'Fällig …', words: ['fällig', 'faellig', 'due', 'bis', 'deadline'], icon: <CheckSquare size={15} />, hint: 'fr, 30.10.', insert: 'fällig ', capture: true },
    { id: 'repeat', label: 'Wiederholung …', words: ['wiederholung', 'wdh', 'repeat', 'jeden', 'alle'], icon: <Repeat size={15} />, hint: 'jeden montag', insert: 'wdh ', capture: true },
    { id: 'remind', label: 'Erinnerung …', words: ['erinnerung', 'remind', 'alarm'], icon: <Bell size={15} />, hint: '15m, 1h', insert: 'erinnerung ', capture: true },
    { id: 'todo', label: 'Todo', words: ['todo', 'aufgabe', 'task'], icon: <CheckSquare size={15} />, capture: true },
    { id: 'h1', label: 'Überschrift 1', words: ['h1', 'überschrift', 'heading'], icon: <Heading1 size={15} /> },
    { id: 'h2', label: 'Überschrift 2', words: ['h2', 'überschrift', 'heading'], icon: <Heading2 size={15} /> },
    { id: 'h3', label: 'Überschrift 3', words: ['h3', 'überschrift', 'heading'], icon: <Heading3 size={15} /> },
    { id: 'text', label: 'Normaler Text', words: ['text', 'normal'], icon: <Text size={15} /> },
    { id: 'note', label: 'Notiz', words: ['notiz', 'note', 'beschreibung'], icon: <StickyNote size={15} />, hint: 'Umschalt+Enter' },
    { id: 'code', label: 'Codeblock', words: ['code', 'codeblock', 'snippet'], icon: <Code2 size={15} /> },
    { id: 'move', label: 'Einsortieren …', words: ['einsortieren', 'verschieben', 'move'], icon: <FolderInput size={15} />, hint: 'Strg+M' },
    { id: 'page', label: 'Als Seite auslagern', words: ['seite', 'page', 'auslagern'], icon: <FileText size={15} /> },
    { id: 'zoom', label: 'Hineinzoomen', words: ['zoom', 'öffnen', 'fokus'], icon: <ZoomIn size={15} />, hint: 'Alt+→' },
  ];
  for (const [key, t] of Object.entries(types)) {
    base.push({ id: `type:${key}`, label: `Typ: ${t.label}`, words: [key, t.label.toLowerCase(), 'typ'], icon: <span className="type-dot" style={{ ['--type-color' as string]: `var(--t-${t.color ?? 'gray'})` }} />, capture: true });
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
            list.push({
              key: cmd.id,
              icon: cmd.icon,
              label: cmd.label,
              hint: cmd.hint,
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
                c().onAction?.(cmd.id);
                return rest;
              },
            });
          }
          if (!list.length && q) list.push({ key: 'none', label: <span className="subtle">Kein Befehl – Datum z. B. „/morgen 14 uhr“</span>, run: () => null });
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
          if (q && !tags.some((t) => t.tag === q.toLowerCase())) list.push({ key: 'new', icon: <Plus size={15} />, label: `Neuer Tag #${q}`, run: () => c().replace(`#${q} `) });
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
              const it = hitItem(h, link, 'Personen');
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
              const it = hitItem(h, link, kind === 'mention' ? 'Weitere' : undefined);
              if (it) list.push(it);
            }
          }
          const q = query.trim();
          if (q && kind === 'mention') {
            list.push({
              key: 'new-person',
              icon: <Plus size={15} />,
              label: `Neue Person „${q}“`,
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
            list.push({ key: 'new-page', icon: <Link2 size={15} />, label: `Link auf „${q}“ (neue Seite)`, run: () => c().replace(`[[${q}]]`) });
          }
          if (!list.length) list.push({ key: 'none', label: <span className="subtle">{q ? 'Nichts gefunden' : 'Namen eingeben …'}</span>, run: () => null });
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
        {!items.length && loading && <div className="menu-empty">Suche …</div>}
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
  el: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  text: string;
  /** Übernimmt einen neuen Text samt Cursor. */
  apply: (text: string, caret: number) => void;
  nodeId?: string;
  kinds?: TriggerKind[];
  commands?: 'full' | 'capture';
  onCommand?: (r: CommandResult, rest: { text: string; caret: number }) => void;
  onAction?: (action: string) => void;
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
      const el = o.el.current;
      if (el) setAnchor(caretAnchor(el, t.start));
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
  const onKeyDown = (e: KeyboardEvent): boolean => {
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
        footer={trigger?.kind === 'slash' ? 'Datum direkt eingeben: /morgen 14 uhr · /fällig fr · /jeden montag' : undefined}
      />
    ) : null;

  return { update, onKeyDown, menu, open, close, trigger };
}
