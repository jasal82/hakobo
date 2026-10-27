// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Bearbeitung der Textzeile eines Knotens mit Tastatursteuerung und Vorschlägen.
// Links und Erwähnungen erscheinen als Chips (siehe InlineEditor).

import { useEffect, useLayoutEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { looksLikeCode } from '../../lib/code';
import {
  applyCommand,
  backspaceAtStart,
  cycleTask,
  deleteAtEnd,
  deleteNode,
  indent,
  makeCode,
  moveDown,
  moveUp,
  nextVisible,
  outdent,
  pasteCode,
  prevVisible,
  selectRange,
  setHeading,
  splitAt,
  toggleTodo,
  toPage,
} from '../../lib/outline';
import { createOp, store, useStore } from '../../lib/store';
import type { Op } from '../../lib/types';
import { InlineEditor, type InlineEditorHandle } from '../InlineEditor';
import { useSuggest } from './suggest';

/** ``` bzw. ```rust am Zeilenanfang macht die Zeile zum Codeblock. */
const FENCE_START = /^(?:```|~~~)\s*([\w+#.-]*)\s*$/;

export function TitleEditor({ id, root, className, placeholder }: { id: string; root: string; className?: string; placeholder?: string }) {
  const node = useStore((s) => s.nodes[id]);
  const focus = useStore((s) => (s.focus?.id === id ? s.focus : null));
  const h = useRef<InlineEditorHandle>(null);
  const text = node?.text ?? '';

  const apply = (t: string, caret: number) => {
    store().setText(id, t, caret);
    h.current?.setText(t, caret);
    requestAnimationFrame(() => sug.update(t, caret));
  };

  const sug = useSuggest({
    anchorAt: (i) => h.current?.coordsAt(i) ?? null,
    text,
    apply,
    nodeId: id,
    onCommand: (r, rest) => {
      applyCommand(id, r, rest.text);
      requestAnimationFrame(() => h.current?.setSelection(rest.caret));
    },
    onAction: (a, arg, rest) => action(a, arg ?? '', rest),
  });

  // Fokus und Cursor setzen, wenn der Fokus (neu) hierher wechselt.
  useLayoutEffect(() => {
    const ed = h.current;
    if (!ed || !focus) return;
    if (!ed.hasFocus()) ed.focus();
    const len = ed.getText().length;
    const c = focus.caret === 'start' ? 0 : focus.caret === 'end' || focus.caret === undefined ? len : Math.min(focus.caret, len);
    ed.setSelection(c, focus.selEnd !== undefined ? Math.min(focus.selEnd, len) : c);
    const r = ed.dom()?.getBoundingClientRect();
    if (r && (r.top < 60 || r.bottom > window.innerHeight - 40)) ed.dom()?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // Seitentitel beim Verlassen speichern (benennt die Datei um).
  useEffect(() => () => store().commitTitle(id), [id]);

  if (!node) return null;

  function action(a: string, arg: string, rest?: { text: string; caret: number }) {
    const s = store();
    switch (a) {
      case 'h1':
      case 'h2':
      case 'h3':
        setHeading(id, Number(a[1]));
        break;
      case 'text':
        setHeading(id, 0);
        break;
      case 'note':
        s.set({ bodyEdit: id });
        break;
      case 'code':
        // Zuerst den Befehl aus dem Text nehmen, dann entscheiden: leere Zeile → Codeblock, sonst Kind.
        if (rest) s.setText(id, rest.text, rest.caret);
        makeCode(id, arg);
        break;
      case 'move':
        s.set({ move: { ids: [id] } });
        break;
      case 'zoom':
        s.zoom(id);
        break;
      case 'page':
        void toPage(id);
        break;
    }
  }

  const navigate = (dir: -1 | 1) => {
    const target = dir < 0 ? prevVisible(id, root) : nextVisible(id, root);
    if (!target) return false;
    store().setFocus({ id: target, caret: dir < 0 ? 'end' : 'start' });
    return true;
  };

  const onKeyDown = (e: KeyboardEvent, ed: InlineEditorHandle): boolean => {
    if (sug.onKeyDown(e)) return true;
    const s = store();
    const mod = e.ctrlKey || e.metaKey;
    const [start, end] = ed.getSelection();
    const t = ed.getText();
    const done = () => {
      e.preventDefault();
      return true;
    };

    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      s.undo();
      return done();
    }
    if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
      s.redo();
      return done();
    }
    switch (e.key) {
      case 'Enter': {
        if (mod && e.shiftKey) toggleTodo(id);
        else if (mod) cycleTask(id);
        else if (e.shiftKey) s.set({ bodyEdit: id });
        else if (e.altKey) s.zoom(id);
        else {
          const fence = node.kind === 'item' && !node.task ? FENCE_START.exec(t) : null;
          if (fence) {
            s.setText(id, '', 0);
            makeCode(id, fence[1]);
          } else splitAt(id, start, end, root);
        }
        return done();
      }
      case 'Tab':
        if (e.shiftKey) outdent(id, root, start);
        else indent(id, start);
        return done();
      case 'Backspace':
        if (mod && e.shiftKey) {
          deleteNode(id, root);
          return done();
        }
        if (start === 0 && end === 0 && backspaceAtStart(id, root)) return done();
        return false;
      case 'Delete':
        if (mod && e.shiftKey) {
          deleteNode(id, root);
          return done();
        }
        if (start === t.length && end === start && deleteAtEnd(id, root)) return done();
        return false;
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if ((e.altKey || mod) && e.shiftKey) {
          if (dir < 0) moveUp(id, start);
          else moveDown(id, start);
          return done();
        }
        if (mod) {
          if (node.children.length) s.setCollapsed(id, dir < 0);
          return done();
        }
        if (e.shiftKey && !e.altKey) {
          // Am Rand (oder alles markiert): Knoten statt Text auswählen.
          const atEdge = (dir < 0 && start === 0 && end === 0) || (dir > 0 && start === t.length && end === t.length) || (start === 0 && end === t.length && t.length > 0);
          if (!atEdge) return false;
          // Sonst erweitert der Auswahl-Handler am Fenster gleich noch einmal.
          e.stopPropagation();
          s.commitTitle(id);
          const other = dir < 0 ? prevVisible(id, root) : nextVisible(id, root);
          selectRange(root, id, other && other !== root ? other : id);
          ed.blur();
          return done();
        }
        if (e.altKey) return false;
        // In der ersten/letzten sichtbaren Zeile: zum vorherigen/nächsten Knoten.
        if (ed.atEdge(dir) && navigate(dir)) return done();
        return false;
      }
      case 'ArrowRight':
        if (e.altKey) {
          s.zoom(id);
          return done();
        }
        return false;
      case 'ArrowLeft':
        if (e.altKey) {
          const parent = node.parent;
          if (id === root && parent) s.navigate({ view: 'node', id: parent });
          else if (root !== s.root) s.navigate({ view: 'node', id: s.nodes[root]?.parent ?? s.root });
          s.setFocus({ id: id === root ? id : root, caret: 'end' });
          return done();
        }
        return false;
      case 'Escape':
        s.commitTitle(id);
        s.setFocus(null);
        ed.blur();
        return done();
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'm') {
        s.set({ move: { ids: [id] } });
        return done();
      }
      if (k === 'b' || k === 'i') {
        const mark = k === 'b' ? '**' : '*';
        apply(t.slice(0, start) + mark + t.slice(start, end) + mark + t.slice(end), end + mark.length * (start === end ? 1 : 2));
        return done();
      }
      if (k === '.') {
        s.zoom(id);
        return done();
      }
      if (k === 'l') {
        void copyLink(id);
        return done();
      }
    }
    return false;
  };

  const onPaste = (e: ClipboardEvent, ed: InlineEditorHandle): boolean => {
    const data = e.clipboardData?.getData('text/plain') ?? '';
    if (!data.includes('\n') || node.kind !== 'item') return false;
    if (looksLikeCode(data)) pasteCode(id, data);
    else pasteOutline(id, data, ed.getSelection());
    return true;
  };

  const level = /^(#{1,3}) /.exec(text)?.[1].length ?? 0;

  return (
    <>
      <InlineEditor
        handleRef={h}
        value={text}
        source={node}
        className={`title-editor${level ? ` is-h${level}` : ''} ${className ?? ''}`}
        placeholder={placeholder}
        onChange={(t, c) => {
          store().setText(id, t, c);
          sug.update(t, c);
          // ```rust + Leertaste → Codeblock
          const m = node.kind === 'item' && !node.task && /^(?:```|~~~)([\w+#.-]*) $/.exec(t);
          if (m) {
            store().setText(id, '', 0);
            makeCode(id, m[1]);
          }
        }}
        onSelectionChange={(t, c) => sug.update(t, c, false)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => {
          const f = store().focus;
          if (f?.id !== id) store().setFocus({ id, caret: h.current?.getSelection()[0] ?? 'end' });
        }}
        onBlur={() => {
          sug.close();
          store().commitTitle(id);
          // Fokus verlassen, sofern nicht gleich ein anderer Knoten übernimmt.
          window.setTimeout(() => {
            const f = store().focus;
            if (f?.id === id && !h.current?.hasFocus() && !document.activeElement?.closest('.cm-editor, .popover, .dialog, .field-pop')) store().setFocus(null);
          }, 0);
        }}
      />
      {sug.menu}
    </>
  );
}

export async function copyLink(id: string) {
  const n = store().nodes[id];
  if (!n) return;
  const link = n.kind === 'page' ? `[[${n.text}]]` : (await api.link(id)).link;
  await navigator.clipboard.writeText(link);
  store().toast('Link kopiert – mit Strg+V in einen Knoten einfügen', 'success');
}

/** Mehrzeiliges Einfügen: jede Zeile wird ein Knoten (Einrückung → Ebenen). */
export function pasteOutline(id: string, data: string, [start, end]: readonly [number, number]) {
  const s = store();
  const n = s.nodes[id];
  const parent = n?.parent ? s.nodes[n.parent] : undefined;
  if (!n || !parent) return;
  const lines = data.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return;
  const parsed = lines.map((l) => {
    const m = /^(\s*)(?:[-*+]|\d+[.)])?\s*(\[[ xX/-]\]\s+)?(.*)$/.exec(l.replace(/\t/g, '  '))!;
    const task = m[2] ? (/\[[xX]\]/.test(m[2]) ? 'done' : 'open') : null;
    return { depth: m[1].length, text: m[3], task } as const;
  });
  const base = Math.min(...parsed.map((p) => p.depth));
  const ops: Op[] = [];
  const first = parsed[0];
  const head = n.text.slice(0, start) + first.text;
  const tail = n.text.slice(end);
  ops.push({ op: 'update', id, text: head, ...(first.task && !n.task ? { task: first.task } : {}) });
  // Stapel: (Einrückung, Knoten-ID)
  const stack: { depth: number; id: string }[] = [{ depth: first.depth, id }];
  let index = parent.children.indexOf(id) + 1;
  let lastId = id;
  const counts = new Map<string, number>();
  for (const p of parsed.slice(1)) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= p.depth) stack.pop();
    const top = stack[stack.length - 1];
    const isChild = p.depth > top.depth && p.depth > base;
    const target = isChild ? top.id : parent.id;
    let idx: number;
    if (isChild) {
      idx = counts.get(top.id) ?? (top.id === id ? n.children.length : 0);
      counts.set(top.id, idx + 1);
    } else {
      idx = index++;
    }
    const op = createOp(target, idx, p.text, p.task ? { task: p.task } : {});
    ops.push(op);
    if (!isChild) stack.length = 1;
    stack.push({ depth: p.depth, id: op.id });
    lastId = op.id;
  }
  if (tail) {
    const last = ops[ops.length - 1];
    if (last.op === 'create') last.text = (last.text ?? '') + tail;
    else if (last.op === 'update') last.text = (last.text ?? '') + tail;
  }
  s.commit(ops, { focusAfter: { id: lastId, caret: 'end' } });
}
