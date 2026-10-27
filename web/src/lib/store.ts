// Zentraler Zustand: Knoten des Notizbuchs, Ansicht, Fokus, Dialoge.
//
// Änderungen wirken sofort lokal (optimistisch) und gehen als Operationen
// gebündelt an den Server. Dessen Antwort (bzw. Ereignisse anderer Fenster)
// wird eingespielt, ohne Knoten mit noch ausstehenden lokalen Änderungen zu
// überschreiben. Rückgängig/Wiederholen arbeitet mit Umkehr-Operationen.

import { create } from 'zustand';
import { api } from './api';
import { extractTags } from './inline';
import { newId } from './ids';
import type { Field, Node, Op, Patch, ServerEvent, Snapshot, SyncStatus, Task, Types } from './types';

export type Route =
  | { view: 'node'; id: string }
  | { view: 'inbox' }
  | { view: 'agenda' }
  | { view: 'todos' }
  | { view: 'week'; start?: string }
  | { view: 'tag'; tag: string }
  | { view: 'type'; type: string };

export interface Focus {
  id: string;
  caret?: number | 'start' | 'end';
  /** Ende einer Auswahl (für Rückgängig). */
  selEnd?: number;
  /** Wechselt bei jedem Setzen, damit gleiche Werte neu angewendet werden. */
  nonce: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface UndoEntry {
  key?: string;
  time: number;
  undo: Op[];
  redo: Op[];
  focusUndo?: Omit<Focus, 'nonce'> | null;
  focusRedo?: Omit<Focus, 'nonce'> | null;
}

interface State {
  ready: boolean;
  loadError: string | null;
  nodes: Record<string, Node>;
  root: string;
  inbox: string;
  types: Types;
  typesError: string | null;
  vault: string;
  sync: SyncStatus | null;
  route: Route;
  focus: Focus | null;
  bodyEdit: string | null;
  collapsed: Record<string, boolean>;
  flash: string | null;
  /** Mehrfachauswahl von Knoten (sichtbare Reihenfolge). */
  selection: string[];
  searchOpen: boolean;
  searchQuery: string;
  move: { ids: string[] } | null;
  assign: { id: string } | null;
  captureOpen: boolean;
  settingsOpen: boolean;
  /** Bereich, den die Einstellungen beim nächsten Öffnen zeigen (z. B. `updates`). */
  settingsTab: string | null;
  history: string | null;
  sidebar: boolean;
  toasts: Toast[];
}

export const clientId = newId() + newId();

// ---------------------------------------------------------------------------
// Hilfen für Knoten
// ---------------------------------------------------------------------------

export function computeTags(n: Pick<Node, 'kind' | 'text' | 'body' | 'fields'>): string[] {
  const tags = extractTags(`${n.text}\n${n.body}`);
  if (n.kind === 'page') {
    const f = n.fields.find((x) => x.key === 'tags');
    for (const t of f?.value.split(',') ?? []) {
      const v = t.trim().replace(/^#/, '').toLowerCase();
      if (v && !tags.includes(v)) tags.push(v);
    }
  }
  return tags;
}

export function field(n: Node | undefined, key: string): string | undefined {
  return n?.fields.find((f) => f.key.toLowerCase() === key.toLowerCase())?.value;
}

export function withField(fields: Field[], key: string, value: string | null): Field[] {
  const i = fields.findIndex((f) => f.key.toLowerCase() === key.toLowerCase());
  if (value === null) return i < 0 ? fields : fields.filter((_, j) => j !== i);
  if (i < 0) return [...fields, { key, value }];
  return fields.map((f, j) => (j === i ? { ...f, value } : f));
}

export function pageOf(nodes: Record<string, Node>, id: string): Node | undefined {
  let n = nodes[id];
  while (n && n.kind !== 'page') n = n.parent ? nodes[n.parent] : (undefined as unknown as Node);
  return n;
}

export function ancestors(nodes: Record<string, Node>, id: string): Node[] {
  const out: Node[] = [];
  let p = nodes[id]?.parent;
  while (p) {
    const n = nodes[p];
    if (!n || n.kind === 'root') break;
    out.unshift(n);
    p = n.parent;
  }
  return out;
}

export function isAncestor(nodes: Record<string, Node>, anc: string, id: string): boolean {
  let p = nodes[id]?.parent;
  while (p) {
    if (p === anc) return true;
    p = nodes[p]?.parent ?? null;
  }
  return false;
}

/** Eingeklappt? Knoten sind standardmäßig offen, Seiten in einer Gliederung zu. */
export function isCollapsed(collapsed: Record<string, boolean>, n: Node | undefined): boolean {
  if (!n) return true;
  const v = collapsed[n.id];
  return v === undefined ? n.kind === 'page' : v;
}

/** Typen eines Knotens (Tags mit Definition). */
export function typesOf(n: Node, types: Types): string[] {
  return n.tags.filter((t) => types[t]);
}

function itemCount(nodes: Record<string, Node>, parent: string): number {
  return nodes[parent].children.filter((c) => nodes[c]?.kind === 'item').length;
}

// ---------------------------------------------------------------------------
// Lokale Anwendung von Operationen (Spiegel von Vault::apply)
// ---------------------------------------------------------------------------

function subtreeOps(nodes: Record<string, Node>, id: string, parent: string, index: number): Op[] {
  const n = nodes[id];
  const ops: Op[] = [{ op: 'create', id, parent, index, text: n.text, body: n.body, fields: n.fields, task: n.task ?? null }];
  n.children.forEach((c, i) => {
    if (nodes[c]?.kind === 'item') ops.push(...subtreeOps(nodes, c, id, i));
  });
  return ops;
}

function collect(nodes: Record<string, Node>, id: string, out: string[]) {
  out.push(id);
  for (const c of nodes[id]?.children ?? []) collect(nodes, c, out);
}

/** Wendet Operationen auf eine Kopie an; liefert neue Knoten, Umkehr-Operationen und berührte IDs. */
export function applyLocal(base: Record<string, Node>, ops: Op[]): { nodes: Record<string, Node>; inverse: Op[]; touched: Set<string> } {
  const nodes = { ...base };
  const inverse: Op[] = [];
  const touched = new Set<string>();
  for (const op of ops) {
    touched.add(op.id);
    switch (op.op) {
      case 'create': {
        const p = nodes[op.parent];
        if (!p) throw new Error('Übergeordneter Knoten fehlt');
        if (nodes[op.id]) throw new Error('ID schon vergeben');
        const kind = op.page ? 'page' : 'item';
        const n: Node = {
          id: op.id,
          kind,
          parent: op.parent,
          children: [],
          text: op.text ?? '',
          body: op.body ?? '',
          fields: op.fields ?? [],
          task: op.task ?? undefined,
          tags: [],
          links: [],
          path: kind === 'page' ? (p.path ? `${p.path}/` : '') + (op.text ?? '') : undefined,
        };
        n.tags = computeTags(n);
        nodes[op.id] = n;
        const children = [...p.children];
        if (kind === 'item') {
          const cnt = itemCount(nodes, p.id);
          children.splice(Math.max(0, Math.min(op.index ?? cnt, cnt)), 0, op.id);
        } else {
          children.push(op.id);
        }
        nodes[p.id] = { ...p, children };
        touched.add(p.id);
        inverse.unshift({ op: 'delete', id: op.id });
        break;
      }
      case 'update': {
        const n = nodes[op.id];
        if (!n) throw new Error('Knoten fehlt');
        const before: Op = { op: 'update', id: op.id };
        const next: Node = { ...n };
        if (op.text !== undefined) {
          before.text = n.text;
          next.text = op.text;
        }
        if (op.body !== undefined) {
          before.body = n.body;
          next.body = op.body;
        }
        if ('task' in op) {
          before.task = n.task ?? null;
          before.fields = n.fields;
          next.task = op.task ?? undefined;
        }
        if (op.fields !== undefined) {
          before.fields = n.fields;
          next.fields = op.fields;
        }
        next.tags = computeTags(next);
        nodes[op.id] = next;
        inverse.unshift(before);
        break;
      }
      case 'move': {
        const n = nodes[op.id];
        const target = nodes[op.parent];
        if (!n || !target || !n.parent) throw new Error('Knoten fehlt');
        const old = nodes[n.parent];
        const oldIndex = old.children.indexOf(op.id);
        nodes[old.id] = { ...old, children: old.children.filter((c) => c !== op.id) };
        const t = nodes[op.parent];
        const children = [...t.children];
        if (n.kind === 'item') {
          const cnt = itemCount(nodes, t.id);
          children.splice(Math.max(0, Math.min(op.index ?? cnt, cnt)), 0, op.id);
        } else {
          children.push(op.id);
        }
        nodes[t.id] = { ...t, children };
        nodes[op.id] = { ...n, parent: op.parent };
        touched.add(old.id);
        touched.add(t.id);
        inverse.unshift({ op: 'move', id: op.id, parent: old.id, index: oldIndex });
        break;
      }
      case 'toPage':
        break;
      case 'delete': {
        const n = nodes[op.id];
        if (!n || !n.parent) break;
        const parent = nodes[n.parent];
        const index = parent.children.indexOf(op.id);
        if (n.kind === 'item') inverse.unshift(...subtreeOps(nodes, op.id, parent.id, index));
        const ids: string[] = [];
        collect(nodes, op.id, ids);
        nodes[parent.id] = { ...parent, children: parent.children.filter((c) => c !== op.id) };
        for (const i of ids) delete nodes[i];
        touched.add(parent.id);
        break;
      }
    }
  }
  return { nodes, inverse, touched };
}

// ---------------------------------------------------------------------------
// Senden, ausstehender Text, Rückgängig
// ---------------------------------------------------------------------------

interface Batch {
  ops: Op[];
  touched: Set<string>;
}

let queue: Batch[] = [];
let inflight = false;
let pendingText: Record<string, { text?: string; body?: string }> = {};
let pendingTimer: number | undefined;
/** Seitentitel werden erst beim Verlassen gespeichert (Umbenennen der Datei). */
let pendingTitles: Record<string, string> = {};
let undoStack: UndoEntry[] = [];
let redoStack: UndoEntry[] = [];
let focusNonce = 0;
let toastId = 0;
let savedWaiters: (() => void)[] = [];

/** Wartet, bis alle lokalen Änderungen beim Server angekommen sind. */
export function whenSaved(): Promise<void> {
  store().flushPending();
  if (!inflight && queue.length === 0) return Promise.resolve();
  return new Promise((r) => savedWaiters.push(r));
}

function notifySaved() {
  if (inflight || queue.length) return;
  const w = savedWaiters;
  savedWaiters = [];
  for (const f of w) f();
}

function protectedIds(): Set<string> {
  const s = new Set<string>();
  for (const b of queue) for (const id of b.touched) s.add(id);
  for (const id of Object.keys(pendingText)) s.add(id);
  for (const id of Object.keys(pendingTitles)) s.add(id);
  return s;
}

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('hakobo-collapsed') ?? '{}');
  } catch {
    return {};
  }
}

let collapseTimer: number | undefined;
function saveCollapsed(c: Record<string, boolean>) {
  clearTimeout(collapseTimer);
  collapseTimer = window.setTimeout(() => {
    try {
      localStorage.setItem('hakobo-collapsed', JSON.stringify(c));
    } catch {
      /* Speicher voll oder gesperrt */
    }
  }, 500);
}

// ---------------------------------------------------------------------------
// Ansicht (Hash-Routing)
// ---------------------------------------------------------------------------

export function routeToHash(r: Route): string {
  switch (r.view) {
    case 'node':
      return `#/n/${r.id}`;
    case 'tag':
      return `#/tag/${encodeURIComponent(r.tag)}`;
    case 'type':
      return `#/type/${encodeURIComponent(r.type)}`;
    case 'week':
      return r.start ? `#/week/${r.start}` : '#/week';
    default:
      return `#/${r.view}`;
  }
}

export function hashToRoute(h: string, root: string): Route {
  const parts = h.replace(/^#\/?/, '').split('/');
  switch (parts[0]) {
    case 'n':
      return parts[1] ? { view: 'node', id: parts[1] } : { view: 'node', id: root };
    case 'inbox':
      return { view: 'inbox' };
    case 'agenda':
      return { view: 'agenda' };
    case 'todos':
      return { view: 'todos' };
    case 'week':
      return { view: 'week', start: parts[1] };
    case 'tag':
      return { view: 'tag', tag: decodeURIComponent(parts.slice(1).join('/')) };
    case 'type':
      return { view: 'type', type: decodeURIComponent(parts.slice(1).join('/')) };
    default:
      return { view: 'node', id: root };
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface Actions {
  init: () => Promise<void>;
  reload: () => Promise<void>;
  loadTypes: () => Promise<void>;
  commit: (ops: Op[], opts?: { key?: string; focusAfter?: Omit<Focus, 'nonce'> | null; focusBefore?: Omit<Focus, 'nonce'> | null; noUndo?: boolean }) => boolean;
  /** Operationen ohne lokale Vorwegnahme (z. B. Seite auslagern); ohne Rückgängig. */
  commitRemote: (ops: Op[]) => Promise<Patch | null>;
  setText: (id: string, text: string, caret?: number) => void;
  commitTitle: (id: string) => void;
  setBody: (id: string, body: string) => void;
  flushPending: () => void;
  undo: () => void;
  redo: () => void;
  navigate: (r: Route) => void;
  zoom: (id: string) => void;
  reveal: (id: string, opts?: { edit?: boolean }) => void;
  setFocus: (f: Omit<Focus, 'nonce'> | null) => void;
  setCollapsed: (id: string, value: boolean) => void;
  /** `sticky`: bleibt stehen, bis sie geschlossen oder ihre Aktion gewählt wird. */
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action'], opts?: { sticky?: boolean }) => void;
  dismissToast: (id: number) => void;
  set: (p: Partial<State>) => void;
  handleEvent: (e: ServerEvent) => void;
  applyServer: (p: Patch) => void;
}

export type Store = State & Actions;

export const useStore = create<Store>()((set, get) => {
  const pump = async () => {
    if (inflight || queue.length === 0) return;
    inflight = true;
    const batches = queue;
    queue = [];
    const ops = batches.flatMap((b) => b.ops);
    try {
      const patch = await api.ops(clientId, ops);
      inflight = false;
      get().applyServer(patch);
    } catch (e) {
      inflight = false;
      get().toast(`Änderung nicht gespeichert: ${(e as Error).message}`, 'error');
      await get().reload();
    }
    if (queue.length) void pump();
    else notifySaved();
  };

  const enqueue = (ops: Op[], touched: Set<string>) => {
    if (!ops.length) return;
    queue.push({ ops, touched });
    void pump();
  };

  const pushUndo = (e: UndoEntry) => {
    const top = undoStack[undoStack.length - 1];
    if (e.key && top?.key === e.key && e.time - top.time < 1500) {
      top.redo = e.redo;
      top.time = e.time;
      top.focusRedo = e.focusRedo;
    } else {
      undoStack.push(e);
      if (undoStack.length > 400) undoStack.shift();
    }
    redoStack = [];
  };

  const applySnapshot = (s: Snapshot) => {
    const nodes: Record<string, Node> = {};
    for (const n of s.nodes) nodes[n.id] = n;
    // Ausstehende Eingaben bleiben sichtbar.
    for (const [id, p] of Object.entries(pendingText)) if (nodes[id]) nodes[id] = { ...nodes[id], ...p };
    for (const [id, t] of Object.entries(pendingTitles)) if (nodes[id]) nodes[id] = { ...nodes[id], text: t };
    set({ nodes, root: s.root, inbox: s.inbox, types: s.types, typesError: s.typesError, vault: s.vault, ready: true, loadError: null });
  };

  return {
    ready: false,
    loadError: null,
    nodes: {},
    root: 'root',
    inbox: '',
    types: {},
    typesError: null,
    vault: '',
    sync: null,
    route: { view: 'node', id: 'root' },
    focus: null,
    bodyEdit: null,
    collapsed: loadCollapsed(),
    flash: null,
    selection: [],
    searchOpen: false,
    searchQuery: '',
    move: null,
    assign: null,
    captureOpen: false,
    settingsOpen: false,
    settingsTab: null,
    history: null,
    sidebar: window.innerWidth > 760 && localStorage.getItem('hakobo-sidebar') !== '0',
    toasts: [],

    init: async () => {
      try {
        const s = await api.snapshot();
        applySnapshot(s);
        set({ route: hashToRoute(location.hash, s.root) });
      } catch (e) {
        set({ loadError: (e as Error).message });
        return;
      }
      window.addEventListener('hashchange', () => set({ route: hashToRoute(location.hash, get().root) }));
      window.addEventListener('beforeunload', () => {
        get().flushPending();
        for (const id of Object.keys(pendingTitles)) get().commitTitle(id);
      });
      api.sync().then((sync) => set({ sync }), () => undefined);
      const connect = () => {
        const es = new EventSource('/api/events');
        es.onmessage = (m) => {
          try {
            get().handleEvent(JSON.parse(m.data));
          } catch {
            /* ungültiges Ereignis */
          }
        };
        es.onerror = () => {
          es.close();
          // Server neu gestartet? Neu verbinden und alles neu laden.
          window.setTimeout(() => {
            connect();
            void get().reload();
          }, 1500);
        };
      };
      connect();
    },

    reload: async () => {
      try {
        applySnapshot(await api.snapshot());
      } catch (e) {
        get().toast(`Neu laden fehlgeschlagen: ${(e as Error).message}`, 'error');
      }
    },

    loadTypes: async () => {
      const t = await api.types();
      set({ types: t.types, typesError: t.error });
    },

    applyServer: (patch) => {
      const prot = protectedIds();
      const nodes = { ...get().nodes };
      for (const n of patch.nodes) {
        if (prot.has(n.id) && !pendingText[n.id] && !pendingTitles[n.id]) continue;
        if (queue.some((b) => b.touched.has(n.id))) continue;
        const p = pendingText[n.id];
        const t = pendingTitles[n.id];
        let merged = p ? { ...n, ...p } : n;
        if (t !== undefined) merged = { ...merged, text: t };
        if (p || t !== undefined) merged.tags = computeTags(merged);
        nodes[n.id] = merged;
      }
      for (const id of patch.removed) if (!prot.has(id)) delete nodes[id];
      set({ nodes });
    },

    handleEvent: (e) => {
      switch (e.type) {
        case 'patch':
          if (e.origin !== clientId) get().applyServer({ nodes: e.nodes, removed: e.removed });
          break;
        case 'reload':
          void get().reload();
          break;
        case 'types':
          void get().loadTypes();
          break;
        case 'sync':
          set({ sync: e.status });
          if (e.status.lastError && !e.status.running) get().toast(`Synchronisation: ${e.status.lastError}`, 'error');
          break;
        case 'navigate':
          get().reveal(e.id, { edit: true });
          break;
        case 'settings':
          window.dispatchEvent(new Event('hakobo-settings'));
          break;
      }
    },

    commit: (ops, opts = {}) => {
      get().flushPending();
      let result;
      try {
        result = applyLocal(get().nodes, ops);
      } catch (e) {
        get().toast((e as Error).message, 'error');
        return false;
      }
      set({ nodes: result.nodes });
      enqueue(ops, result.touched);
      if (!opts.noUndo) {
        const f = get().focus;
        pushUndo({
          key: opts.key,
          time: Date.now(),
          undo: result.inverse,
          redo: ops,
          focusUndo: opts.focusBefore ?? (f ? { id: f.id, caret: f.caret } : null),
          focusRedo: opts.focusAfter ?? null,
        });
      }
      if (opts.focusAfter !== undefined) get().setFocus(opts.focusAfter);
      return true;
    },

    commitRemote: async (ops) => {
      for (const id of Object.keys(pendingTitles)) get().commitTitle(id);
      await whenSaved();
      try {
        const patch = await api.ops(clientId, ops);
        get().applyServer(patch);
        return patch;
      } catch (e) {
        get().toast((e as Error).message, 'error');
        return null;
      }
    },

    setText: (id, text, caret) => {
      const n = get().nodes[id];
      if (!n || n.text === text) return;
      const before = n.text;
      const next = { ...n, text };
      next.tags = computeTags(next);
      set({ nodes: { ...get().nodes, [id]: next } });
      const f = get().focus;
      if (n.kind === 'page') {
        if (pendingTitles[id] === undefined) {
          pushUndo({ key: `title:${id}`, time: Date.now(), undo: [{ op: 'update', id, text: before }], redo: [{ op: 'update', id, text }] });
        }
        pendingTitles[id] = text;
        return;
      }
      pushUndo({
        key: `text:${id}`,
        time: Date.now(),
        undo: [{ op: 'update', id, text: before }],
        redo: [{ op: 'update', id, text }],
        focusUndo: { id, caret: f?.id === id && typeof f.caret === 'number' ? f.caret : 'end' },
        focusRedo: { id, caret: caret ?? 'end' },
      });
      pendingText[id] = { ...pendingText[id], text };
      clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(() => get().flushPending(), 350);
    },

    commitTitle: (id) => {
      const t = pendingTitles[id];
      if (t === undefined) return;
      delete pendingTitles[id];
      const n = get().nodes[id];
      const title = t.trim() || 'Unbenannt';
      if (n) enqueue([{ op: 'update', id, text: title }], new Set([id]));
    },

    setBody: (id, body) => {
      const n = get().nodes[id];
      if (!n || n.body === body) return;
      const before = n.body;
      const next = { ...n, body };
      next.tags = computeTags(next);
      set({ nodes: { ...get().nodes, [id]: next } });
      pushUndo({ key: `body:${id}`, time: Date.now(), undo: [{ op: 'update', id, body: before }], redo: [{ op: 'update', id, body }] });
      pendingText[id] = { ...pendingText[id], body };
      clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(() => get().flushPending(), 600);
    },

    flushPending: () => {
      clearTimeout(pendingTimer);
      const entries = Object.entries(pendingText);
      if (!entries.length) return;
      pendingText = {};
      const ops: Op[] = entries.filter(([id]) => get().nodes[id]).map(([id, p]) => ({ op: 'update', id, ...p }));
      enqueue(ops, new Set(ops.map((o) => o.id)));
    },

    undo: () => {
      get().flushPending();
      for (const id of Object.keys(pendingTitles)) get().commitTitle(id);
      const e = undoStack.pop();
      if (!e) return;
      // Ops ohne existierende Ziele überspringen (z. B. von anderswo gelöscht).
      const ok = get().commit(e.undo, { noUndo: true });
      if (!ok) return;
      redoStack.push(e);
      if (e.focusUndo && get().nodes[e.focusUndo.id]) get().setFocus(e.focusUndo);
    },

    redo: () => {
      get().flushPending();
      const e = redoStack.pop();
      if (!e) return;
      const ok = get().commit(e.redo, { noUndo: true });
      if (!ok) return;
      undoStack.push(e);
      if (e.focusRedo && get().nodes[e.focusRedo.id]) get().setFocus(e.focusRedo);
    },

    navigate: (r) => {
      const h = routeToHash(r);
      if (location.hash !== h) location.hash = h;
      set({ route: r, bodyEdit: null, selection: [], ...(window.innerWidth <= 760 ? { sidebar: false } : {}) });
    },

    zoom: (id) => {
      get().navigate({ view: 'node', id });
      const n = get().nodes[id];
      const first = n?.children.find((c) => get().nodes[c]?.kind === 'item');
      get().setFocus(first ? { id: first, caret: 'end' } : null);
    },

    reveal: (id, opts = {}) => {
      const { nodes, route } = get();
      const n = nodes[id];
      if (!n) return;
      if (n.kind !== 'item') {
        get().navigate({ view: 'node', id });
        return;
      }
      // Bleibt in der aktuellen Ansicht, wenn sie den Knoten enthält.
      const current = route.view === 'node' ? route.id : null;
      const host = current && current !== id && isAncestor(nodes, current, id) ? current : (pageOf(nodes, id)?.id ?? id);
      const collapsed = { ...get().collapsed };
      for (const a of ancestors(nodes, id)) if (a.id !== host && isAncestor(nodes, host, a.id)) collapsed[a.id] = false;
      saveCollapsed(collapsed);
      set({ collapsed, flash: id });
      get().navigate({ view: 'node', id: host });
      if (opts.edit) get().setFocus({ id, caret: 'end' });
      window.setTimeout(() => {
        if (get().flash === id) set({ flash: null });
      }, 1800);
    },

    setFocus: (f) => set(f ? { focus: { ...f, nonce: ++focusNonce }, selection: [] } : { focus: null }),

    setCollapsed: (id, value) => {
      const collapsed = { ...get().collapsed, [id]: value };
      saveCollapsed(collapsed);
      set({ collapsed });
    },

    toast: (text, kind = 'info', action, opts) => {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, text, kind, action }] });
      if (!opts?.sticky) window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : action ? 6000 : 3500);
    },

    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

    set: (p) => set(p),
  };
});

export const store = () => useStore.getState();

/** Neue Item-Operation mit frischer ID. */
export function createOp(parent: string, index: number | undefined, text = '', extra: Partial<{ body: string; fields: Field[]; task: Task | null }> = {}): Op & { op: 'create' } {
  return { op: 'create', id: newId(), parent, index, text, ...extra };
}
