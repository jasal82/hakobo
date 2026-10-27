// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Strukturoperationen des Outliners (Workflowy-artig).

import { formatFence, guessLanguage } from './code';
import { newId } from './ids';
import { applyLocal, createOp, field, isCollapsed, pageOf, store, withField } from './store';
import type { CommandResult, Field, Node, Op, Task } from './types';

const S = () => store();
const N = (id: string | null | undefined): Node | undefined => (id ? S().nodes[id] : undefined);

/** Sichtbare Knoten unterhalb von `root` in Lesereihenfolge. */
export function visibleList(root: string): string[] {
  const { nodes, collapsed } = S();
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of nodes[id]?.children ?? []) {
      const n = nodes[c];
      if (!n) continue;
      out.push(c);
      if (n.children.length && !isCollapsed(collapsed, n)) walk(c);
    }
  };
  walk(root);
  return out;
}

export function prevVisible(id: string, root: string): string | null {
  const list = visibleList(root);
  const i = list.indexOf(id);
  if (i > 0) return list[i - 1];
  return i === 0 && root !== S().root ? root : null;
}

export function nextVisible(id: string, root: string): string | null {
  const list = visibleList(root);
  if (id === root) return list[0] ?? null;
  const i = list.indexOf(id);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
}

function indexIn(parent: Node, id: string): number {
  return parent.children.indexOf(id);
}

function itemsOf(parent: Node): string[] {
  const { nodes } = S();
  return parent.children.filter((c) => nodes[c]?.kind === 'item');
}

/** Neuer Geschwisterknoten (bzw. Seite) nach `id`. */
export function createAfter(id: string, text = '', extra: { body?: string; fields?: Field[]; task?: Task | null } = {}): string | null {
  const n = N(id);
  const parent = N(n?.parent);
  if (!n || !parent) return null;
  if (n.kind === 'page') {
    const title = text || 'Unbenannt';
    const op: Op = { op: 'create', id: newId(), parent: parent.id, page: true, text: title };
    S().commit([op], { focusAfter: { id: op.id, caret: 0, selEnd: title.length } });
    return op.id;
  }
  const op = createOp(parent.id, indexIn(parent, id) + 1, text, extra);
  S().commit([op], { focusAfter: { id: op.id, caret: 0 } });
  return op.id;
}

/** Neuer erster/letzter Kindknoten. */
export function createChild(parent: string, index?: number, text = ''): string | null {
  const p = N(parent);
  if (!p) return null;
  if (p.kind === 'root') {
    const title = text || 'Unbenannt';
    const op: Op = { op: 'create', id: newId(), parent, page: true, text: title };
    S().commit([op], { focusAfter: { id: op.id, caret: 0, selEnd: title.length } });
    return op.id;
  }
  const op = createOp(parent, index ?? itemsOf(p).length, text);
  S().commit([op], { focusAfter: { id: op.id, caret: 'end' } });
  if (S().collapsed[parent]) S().setCollapsed(parent, false);
  return op.id;
}

/** Gemeinsame Einrückung entfernen (eingefügter Code). */
export function dedent(code: string): string {
  const lines = code.replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

/** Macht eine leere Zeile zum Codeblock bzw. legt unter einer Zeile mit Text einen an. */
export function makeCode(id: string, lang = '', code = ''): string | null {
  const n = N(id);
  if (!n || n.kind !== 'item') return null;
  const body = formatFence(lang, code);
  if (!n.text.trim() && !n.task && !n.body.trim()) {
    S().commit([{ op: 'update', id, text: '', body }], { focusAfter: { id, caret: 'end' } });
    return id;
  }
  const op = createOp(id, 0, '', { body });
  S().commit([op], { focusAfter: { id: op.id, caret: 'end' } });
  if (isCollapsed(S().collapsed, n)) S().setCollapsed(id, false);
  return op.id;
}

/** Eingefügten Code als Codeblock übernehmen (Zaun oder erkannte Sprache). */
export function pasteCode(id: string, text: string): string | null {
  const fenced = /^\s*(```|~~~)([^\n]*)\n([\s\S]*?)\n\s*\1\s*$/.exec(text.replace(/\r\n/g, '\n'));
  const code = dedent(fenced ? fenced[3] : text);
  const lang = fenced ? fenced[2].trim() : (guessLanguage(code) ?? '');
  return makeCode(id, lang, code);
}

/** Knoten als eigene Seite auslagern und öffnen. */
export async function toPage(id: string) {
  const n = N(id);
  if (!n || n.kind !== 'item') return;
  const before = new Set(Object.keys(S().nodes));
  const patch = await S().commitRemote([{ op: 'toPage', id }]);
  // Die neue Seite ist die, die es vorher noch nicht gab.
  const created = patch?.nodes.find((x) => x.kind === 'page' && !before.has(x.id));
  if (created) {
    S().toast(`„${created.text}“ ist jetzt eine eigene Seite`, 'success', { label: 'Öffnen', run: () => S().navigate({ view: 'node', id: created.id }) });
  }
}

/** Neue Unterseite anlegen und öffnen. */
export function createSubpage(parent: string, title = 'Unbenannt'): string | null {
  const p = N(parent);
  if (!p || p.kind === 'item') return null;
  const id = newId();
  if (!S().commit([{ op: 'create', id, parent, page: true, text: title }])) return null;
  S().navigate({ view: 'node', id });
  S().setFocus({ id, caret: 0, selEnd: title.length });
  return id;
}

/** Enter: Text am Cursor teilen. */
export function splitAt(id: string, caret: number, selEnd: number, root: string) {
  const n = N(id);
  if (!n) return;
  const { collapsed } = S();
  if (n.kind === 'page') {
    S().commitTitle(id);
    createAfter(id);
    return;
  }
  const before = n.text.slice(0, caret);
  const after = n.text.slice(selEnd);
  const parent = N(n.parent)!;
  // Cursor am Anfang eines nicht leeren Knotens: neuer leerer Knoten davor.
  if (caret === 0 && n.text.length > 0 && selEnd === 0) {
    const op = createOp(parent.id, indexIn(parent, id), '');
    S().commit([op], { focusAfter: { id, caret: 0 } });
    return;
  }
  // Ausgeklappter Knoten mit Kindern (oder Zoom-Wurzel): neues erstes Kind.
  const hasKids = n.children.some((c) => N(c)?.kind === 'item');
  if ((id === root || (hasKids && !isCollapsed(collapsed, n))) && after === '') {
    const op = createOp(id, 0, '');
    S().commit([...(before !== n.text ? [{ op: 'update', id, text: before } as Op] : []), op], { focusAfter: { id: op.id, caret: 0 } });
    return;
  }
  if (id === root) return;
  const op = createOp(parent.id, indexIn(parent, id) + 1, after);
  const ops: Op[] = [];
  if (after !== '' || before !== n.text) ops.push({ op: 'update', id, text: before });
  ops.push(op);
  // Kinder wandern mit dem Rest, wenn geteilt wird (wie in Workflowy).
  if (after !== '' && hasKids) {
    n.children.forEach((c, i) => {
      if (N(c)?.kind === 'item') ops.push({ op: 'move', id: c, parent: op.id, index: i });
    });
  }
  S().commit(ops, { focusAfter: { id: op.id, caret: 0 } });
}

export function indent(id: string, caret?: number) {
  const n = N(id);
  const parent = N(n?.parent);
  if (!n || !parent || n.kind !== 'item') return;
  const i = indexIn(parent, id);
  const prev = i > 0 ? N(parent.children[i - 1]) : undefined;
  if (!prev || prev.kind !== 'item') return;
  S().commit([{ op: 'move', id, parent: prev.id, index: itemsOf(prev).length }], { focusAfter: { id, caret: caret ?? 'end' } });
  if (S().collapsed[prev.id]) S().setCollapsed(prev.id, false);
}

export function outdent(id: string, root: string, caret?: number) {
  const n = N(id);
  const parent = N(n?.parent);
  if (!n || !parent || n.kind !== 'item' || parent.id === root) return;
  const grand = N(parent.parent);
  if (!grand || grand.kind === 'root') return;
  S().commit([{ op: 'move', id, parent: grand.id, index: indexIn(grand, parent.id) + 1 }], { focusAfter: { id, caret: caret ?? 'end' } });
}

export function moveUp(id: string, caret?: number) {
  const n = N(id);
  const parent = N(n?.parent);
  if (!n || !parent || n.kind !== 'item') return;
  const i = indexIn(parent, id);
  if (i > 0) {
    S().commit([{ op: 'move', id, parent: parent.id, index: i - 1 }], { focusAfter: { id, caret: caret ?? 'end' } });
    return;
  }
  // Am Anfang: ans Ende des vorherigen Geschwisters der Elternebene.
  const grand = N(parent.parent);
  if (!grand || parent.kind !== 'item') return;
  const pi = indexIn(grand, parent.id);
  const uncle = pi > 0 ? N(grand.children[pi - 1]) : undefined;
  if (uncle?.kind === 'item') S().commit([{ op: 'move', id, parent: uncle.id, index: itemsOf(uncle).length }], { focusAfter: { id, caret: caret ?? 'end' } });
}

export function moveDown(id: string, caret?: number) {
  const n = N(id);
  const parent = N(n?.parent);
  if (!n || !parent || n.kind !== 'item') return;
  const items = itemsOf(parent);
  const i = items.indexOf(id);
  if (i < items.length - 1) {
    S().commit([{ op: 'move', id, parent: parent.id, index: i + 1 }], { focusAfter: { id, caret: caret ?? 'end' } });
    return;
  }
  const grand = N(parent.parent);
  if (!grand || parent.kind !== 'item') return;
  const pi = indexIn(grand, parent.id);
  const uncle = N(grand.children[pi + 1]);
  if (uncle?.kind === 'item') S().commit([{ op: 'move', id, parent: uncle.id, index: 0 }], { focusAfter: { id, caret: caret ?? 'end' } });
}

/** Backspace am Anfang: leeren Knoten löschen bzw. mit dem vorherigen verbinden. */
export function backspaceAtStart(id: string, root: string): boolean {
  const n = N(id);
  if (!n || n.kind !== 'item' || id === root) return false;
  const prev = prevVisible(id, root);
  const prevNode = N(prev);
  const hasKids = n.children.length > 0;
  if (n.text === '' && !hasKids && !n.body) {
    S().commit([{ op: 'delete', id }], { focusAfter: prev ? { id: prev, caret: 'end' } : null });
    return true;
  }
  if (!prevNode || prevNode.kind !== 'item' || prevNode.id === root) return false;
  if (hasKids || prevNode.children.length > 0 || n.body) return false;
  const caret = prevNode.text.length;
  const ops: Op[] = [{ op: 'update', id: prevNode.id, text: prevNode.text + n.text }];
  if (n.fields.length && !prevNode.fields.length) ops.push({ op: 'update', id: prevNode.id, fields: n.fields });
  ops.push({ op: 'delete', id });
  S().commit(ops, { focusAfter: { id: prevNode.id, caret } });
  return true;
}

/** Entf am Ende: nächsten Knoten anhängen. */
export function deleteAtEnd(id: string, root: string): boolean {
  const n = N(id);
  const next = N(nextVisible(id, root));
  if (!n || !next || n.kind !== 'item' || next.kind !== 'item' || next.children.length || next.body) return false;
  if (next.parent !== n.parent && next.parent !== id) return false;
  S().commit(
    [
      { op: 'update', id, text: n.text + next.text },
      { op: 'delete', id: next.id },
    ],
    { focusAfter: { id, caret: n.text.length } },
  );
  return true;
}

export function deleteNode(id: string, root: string) {
  const n = N(id);
  if (!n || id === root) return;
  if (n.kind === 'page') {
    if (!confirm(`Seite „${n.text}“ samt Unterseiten löschen? Sie bleibt im Verlauf (Git) erhalten.`)) return;
  }
  const prev = prevVisible(id, root);
  S().commit([{ op: 'delete', id }], { focusAfter: prev ? { id: prev, caret: 'end' } : null });
  if (n.kind === 'page') S().toast(`„${n.text}“ gelöscht`, 'info');
}

/** Strg+Enter: Todo erledigen bzw. wieder öffnen; ohne Kästchen wird es ein Todo. */
export function cycleTask(id: string) {
  const n = N(id);
  if (!n || n.kind !== 'item') return;
  const next: Task = !n.task ? 'open' : n.task === 'done' || n.task === 'cancelled' ? 'open' : 'done';
  S().commit([{ op: 'update', id, task: next }], { key: undefined });
  if (next === 'done' && field(n, 'repeat')) S().toast('Wiederkehrendes Todo: auf den nächsten Termin verschoben', 'success');
}

export function toggleTodo(id: string) {
  const n = N(id);
  if (!n || n.kind !== 'item') return;
  S().commit([{ op: 'update', id, task: n.task ? null : 'open' }]);
}

export function setTask(id: string, task: Task | null) {
  S().commit([{ op: 'update', id, task }]);
}

export function setFieldValue(id: string, key: string, value: string | null) {
  const n = N(id);
  if (!n) return;
  const fields = withField(n.fields, key, value);
  S().commit([{ op: 'update', id, fields }]);
}

export function setHeading(id: string, level: number) {
  const n = N(id);
  if (!n) return;
  const text = n.text.replace(/^#{1,3} /, '');
  S().commit([{ op: 'update', id, text: level ? `${'#'.repeat(level)} ${text}` : text }]);
}

/** Wendet einen Slash-Befehl an (Feld setzen, Todo, Startdatum). */
export function applyCommand(id: string, r: CommandResult, newText?: string) {
  const n = N(id);
  if (!n) return;
  const op: Op & { op: 'update' } = { op: 'update', id };
  if (newText !== undefined && newText !== n.text) op.text = newText;
  let fields = n.fields;
  if (r.kind === 'todo') {
    op.task = n.task ? null : 'open';
  } else {
    fields = withField(fields, r.field, r.value);
    if (r.kind === 'date' || r.kind === 'due') fields = withField(fields, 'due', null);
    if (r.kind === 'due' && !n.task) op.task = 'open';
    if (r.kind === 'repeat' && r.date && !field(n, 'date')) fields = withField(fields, 'date', r.date);
    op.fields = fields;
  }
  S().commit([op]);
}

export function addTag(id: string, tag: string) {
  const n = N(id);
  if (!n || n.tags.includes(tag.toLowerCase())) return;
  if (n.kind === 'page') {
    const cur = field(n, 'tags');
    setFieldValue(id, 'tags', cur ? `${cur}, ${tag}` : tag);
    return;
  }
  const text = n.text.trimEnd();
  S().commit([{ op: 'update', id, text: `${text}${text ? ' ' : ''}#${tag}` }]);
}

/** Einsortieren: Knoten ans Ende des Ziels verschieben. */
export function moveInto(ids: string[], target: string) {
  const { nodes } = S();
  const t = nodes[target];
  if (!t) return;
  const ops: Op[] = [];
  let index = t.children.filter((c) => nodes[c]?.kind === 'item').length;
  for (const id of ids) {
    const n = nodes[id];
    if (!n || id === target) continue;
    if (n.kind === 'page') {
      if (t.kind === 'item') continue;
      ops.push({ op: 'move', id, parent: target });
    } else {
      if (t.kind === 'root') continue;
      ops.push({ op: 'move', id, parent: target, index: index++ });
    }
  }
  if (!ops.length) return;
  if (S().commit(ops)) {
    const name = t.kind === 'root' ? 'die oberste Ebene' : `„${t.text || 'Unbenannt'}“`;
    S().toast(`${ops.length === 1 ? 'Eintrag' : `${ops.length} Einträge`} nach ${name} verschoben`, 'success', {
      label: 'Öffnen',
      run: () => S().reveal(ids[0]),
    });
  }
}

/** Seite, unter der neue Knoten eines Typs landen (z. B. „Personen“). */
export function typeHome(type: string): Node | undefined {
  const { types, nodes, inbox } = S();
  const page = types[type]?.page;
  if (page) {
    const lower = page.toLowerCase();
    const hit = Object.values(nodes).find((n) => n.kind === 'page' && (n.path?.toLowerCase() === lower || n.text.toLowerCase() === lower));
    if (hit) return hit;
  }
  return nodes[inbox];
}

export { pageOf };

// ---------------------------------------------------------------------------
// Mehrfachauswahl
// ---------------------------------------------------------------------------

let selAnchor: string | null = null;
let selHead: string | null = null;

/** Wählt den sichtbaren Bereich zwischen `a` und `b`. */
export function selectRange(root: string, a: string, b: string) {
  const list = visibleList(root);
  const i = list.indexOf(a);
  const j = list.indexOf(b);
  if (i < 0 || j < 0) return;
  selAnchor = a;
  selHead = b;
  S().set({ selection: list.slice(Math.min(i, j), Math.max(i, j) + 1), focus: null });
}

export function toggleSelected(id: string) {
  const sel = S().selection;
  const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
  selAnchor = selAnchor ?? id;
  selHead = id;
  S().set({ selection: next, focus: null });
}

/** Umschalt+↑/↓: Auswahl erweitern bzw. verkleinern. */
export function extendSelection(root: string, dir: -1 | 1) {
  const list = visibleList(root);
  if (!selAnchor || !selHead) return;
  const j = list.indexOf(selHead) + dir;
  if (j < 0 || j >= list.length) return;
  selectRange(root, selAnchor, list[j]);
}

export function clearSelection() {
  selAnchor = selHead = null;
  if (S().selection.length) S().set({ selection: [] });
}

/** Ausgewählte Knoten ohne solche, deren Vorfahr ebenfalls ausgewählt ist. */
export function topLevel(ids: string[]): string[] {
  const { nodes } = S();
  const set = new Set(ids);
  return ids.filter((id) => {
    let p = nodes[id]?.parent;
    while (p) {
      if (set.has(p)) return false;
      p = nodes[p]?.parent ?? null;
    }
    return true;
  });
}

/** Baut Operationen nacheinander auf einem simulierten Stand auf. */
function simulate(build: (get: () => Record<string, Node>, push: (op: Op) => void) => void): Op[] {
  let nodes = S().nodes;
  const ops: Op[] = [];
  build(
    () => nodes,
    (op) => {
      nodes = applyLocal(nodes, [op]).nodes;
      ops.push(op);
    },
  );
  return ops;
}

export function indentMany(ids: string[]) {
  const tops = topLevel(ids);
  const ops = simulate((get, push) => {
    for (const id of tops) {
      const nodes = get();
      const n = nodes[id];
      const parent = n?.parent ? nodes[n.parent] : undefined;
      if (!n || !parent || n.kind !== 'item') continue;
      let k = parent.children.indexOf(id) - 1;
      while (k >= 0 && tops.includes(parent.children[k])) k--;
      const prev = nodes[parent.children[k]];
      if (!prev || prev.kind !== 'item') continue;
      push({ op: 'move', id, parent: prev.id, index: prev.children.filter((c) => nodes[c]?.kind === 'item').length });
    }
  });
  if (ops.length) S().commit(ops, { focusAfter: null });
}

export function outdentMany(ids: string[], root: string) {
  const tops = topLevel(ids);
  const ops = simulate((get, push) => {
    for (const id of [...tops].reverse()) {
      const nodes = get();
      const n = nodes[id];
      const parent = n?.parent ? nodes[n.parent] : undefined;
      if (!n || !parent || n.kind !== 'item' || parent.id === root) continue;
      const grand = parent.parent ? nodes[parent.parent] : undefined;
      if (!grand || grand.kind === 'root') continue;
      push({ op: 'move', id, parent: grand.id, index: grand.children.indexOf(parent.id) + 1 });
    }
  });
  if (ops.length) S().commit(ops, { focusAfter: null });
}

export function deleteMany(ids: string[], root: string) {
  const tops = topLevel(ids).filter((id) => N(id)?.kind === 'item');
  if (!tops.length) return;
  const prev = prevVisible(tops[0], root);
  S().commit(
    tops.map((id) => ({ op: 'delete', id }) as Op),
    { focusAfter: prev ? { id: prev, caret: 'end' } : null },
  );
  clearSelection();
}

export function completeMany(ids: string[]) {
  const items = topLevel(ids)
    .map((id) => N(id))
    .filter((n): n is Node => !!n && n.kind === 'item');
  if (!items.length) return;
  const allDone = items.every((n) => n.task === 'done');
  S().commit(items.map((n) => ({ op: 'update', id: n.id, task: allDone ? 'open' : 'done' }) as Op));
}

/** Teilbaum als Markdown-Gliederung (wie im Dateiformat). */
export function toMarkdown(ids: string[]): string {
  const { nodes } = S();
  const out: string[] = [];
  const marker: Record<string, string> = { open: '[ ] ', doing: '[/] ', done: '[x] ', cancelled: '[-] ' };
  const walk = (id: string, depth: number) => {
    const n = nodes[id];
    if (!n) return;
    const ind = '  '.repeat(depth);
    out.push(`${ind}- ${n.task ? marker[n.task] : ''}${n.text}`);
    for (const f of n.fields) out.push(`${ind}  ${f.key}:: ${f.value}`);
    if (n.body) for (const l of n.body.split(NL)) out.push(l ? `${ind}  ${l}` : '');
    for (const c of n.children) if (nodes[c]?.kind === 'item') walk(c, depth + 1);
  };
  for (const id of topLevel(ids)) walk(id, 0);
  return out.join(NL) + NL;
}

const NL = String.fromCharCode(10);
