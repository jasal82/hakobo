// Bearbeitung der Textzeile eines Knotens mit Tastatursteuerung und Vorschlägen.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { api } from '../../lib/api';
import {
  applyCommand,
  backspaceAtStart,
  cycleTask,
  deleteAtEnd,
  deleteNode,
  indent,
  moveDown,
  moveUp,
  nextVisible,
  outdent,
  prevVisible,
  selectRange,
  setHeading,
  splitAt,
  toggleTodo,
  toPage,
} from '../../lib/outline';
import { createOp, store, useStore } from '../../lib/store';
import type { Op } from '../../lib/types';
import { useSuggest } from './suggest';

export function TitleEditor({ id, root, className, placeholder }: { id: string; root: string; className?: string; placeholder?: string }) {
  const node = useStore((s) => s.nodes[id]);
  const focus = useStore((s) => (s.focus?.id === id ? s.focus : null));
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = node?.text ?? '';

  const apply = (t: string, caret: number) => {
    store().setText(id, t, caret);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.setSelectionRange(caret, caret);
        sug.update(t, caret);
      }
    });
  };

  const sug = useSuggest({
    el: ref,
    text,
    apply,
    nodeId: id,
    onCommand: (r, rest) => {
      applyCommand(id, r, rest.text);
      requestAnimationFrame(() => ref.current?.setSelectionRange(rest.caret, rest.caret));
    },
    onAction: (a) => action(a),
  });

  // Fokus und Cursor setzen, wenn der Fokus (neu) hierher wechselt.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !focus) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    const len = el.value.length;
    const c = focus.caret === 'start' ? 0 : focus.caret === 'end' || focus.caret === undefined ? len : Math.min(focus.caret, len);
    el.setSelectionRange(c, focus.selEnd !== undefined ? Math.min(focus.selEnd, len) : c);
    const r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // Seitentitel beim Verlassen speichern (benennt die Datei um).
  useEffect(() => () => store().commitTitle(id), [id]);

  if (!node) return null;

  function caret() {
    const el = ref.current!;
    return [el.selectionStart ?? 0, el.selectionEnd ?? 0] as const;
  }

  function action(a: string) {
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
      case 'code': {
        const n = s.nodes[id];
        const body = (n.body ? n.body + '\n\n' : '') + '```\n\n```';
        s.commit([{ op: 'update', id, body }]);
        s.set({ bodyEdit: id });
        break;
      }
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

  const navigate = (dir: -1 | 1, col?: number) => {
    const target = dir < 0 ? prevVisible(id, root) : nextVisible(id, root);
    if (!target) return;
    store().setFocus({ id: target, caret: col ?? (dir < 0 ? 'end' : 'start') });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (sug.onKeyDown(e)) return;
    const s = store();
    const mod = e.ctrlKey || e.metaKey;
    const [start, end] = caret();
    const el = e.currentTarget;

    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      s.undo();
      return;
    }
    if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      s.redo();
      return;
    }
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (mod && e.shiftKey) toggleTodo(id);
        else if (mod) cycleTask(id);
        else if (e.shiftKey) s.set({ bodyEdit: id });
        else if (e.altKey) s.zoom(id);
        else splitAt(id, start, end, root);
        return;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) outdent(id, root, start);
        else indent(id, start);
        return;
      case 'Backspace':
        if (mod && e.shiftKey) {
          e.preventDefault();
          deleteNode(id, root);
          return;
        }
        if (start === 0 && end === 0 && backspaceAtStart(id, root)) e.preventDefault();
        return;
      case 'Delete':
        if (mod && e.shiftKey) {
          e.preventDefault();
          deleteNode(id, root);
          return;
        }
        if (start === text.length && end === start && deleteAtEnd(id, root)) e.preventDefault();
        return;
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if ((e.altKey || mod) && e.shiftKey) {
          e.preventDefault();
          if (dir < 0) moveUp(id, start);
          else moveDown(id, start);
          return;
        }
        if (mod) {
          e.preventDefault();
          if (node.children.length) s.setCollapsed(id, dir < 0);
          return;
        }
        if (e.shiftKey && !e.altKey) {
          // Am Rand (oder alles markiert): Knoten statt Text auswählen.
          const atEdge = (dir < 0 && start === 0 && end === 0) || (dir > 0 && start === text.length && end === text.length) || (start === 0 && end === text.length && text.length > 0);
          if (atEdge) {
            e.preventDefault();
            // Sonst erweitert der Auswahl-Handler am Fenster gleich noch einmal.
            e.stopPropagation();
            s.commitTitle(id);
            const other = dir < 0 ? prevVisible(id, root) : nextVisible(id, root);
            selectRange(root, id, other && other !== root ? other : id);
            el.blur();
          }
          return;
        }
        if (e.altKey) return;
        // Erst die Standardbewegung abwarten: Bleibt der Cursor stehen, war er in der ersten/letzten Zeile.
        const before = start;
        requestAnimationFrame(() => {
          if (document.activeElement !== el) return;
          if (el.selectionStart === before) navigate(dir);
        });
        return;
      }
      case 'ArrowRight':
        if (e.altKey) {
          e.preventDefault();
          s.zoom(id);
        }
        return;
      case 'ArrowLeft':
        if (e.altKey) {
          e.preventDefault();
          const parent = node.parent;
          if (id === root && parent) s.navigate({ view: 'node', id: parent });
          else if (root !== s.root) s.navigate({ view: 'node', id: s.nodes[root]?.parent ?? s.root });
          s.setFocus({ id: id === root ? id : root, caret: 'end' });
        }
        return;
      case 'Escape':
        e.preventDefault();
        s.commitTitle(id);
        s.setFocus(null);
        el.blur();
        return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'm') {
        e.preventDefault();
        s.set({ move: { ids: [id] } });
      } else if (k === 'b' || k === 'i') {
        e.preventDefault();
        const mark = k === 'b' ? '**' : '*';
        const t = text.slice(0, start) + mark + text.slice(start, end) + mark + text.slice(end);
        apply(t, end + mark.length * (start === end ? 1 : 2));
      } else if (k === '.') {
        e.preventDefault();
        s.zoom(id);
      } else if (k === 'l') {
        e.preventDefault();
        void copyLink(id);
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const data = e.clipboardData.getData('text/plain');
    if (!data.includes('\n') || node.kind !== 'item') return;
    e.preventDefault();
    pasteOutline(id, data, caret());
  };

  const level = /^(#{1,3}) /.exec(text)?.[1].length ?? 0;

  return (
    <>
      <textarea
        ref={ref}
        className={`title-editor${level ? ` is-h${level}` : ''} ${className ?? ''}`}
        value={text}
        rows={1}
        spellCheck
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value.replace(/\r?\n/g, ' ');
          const c = e.target.selectionStart ?? t.length;
          store().setText(id, t, c);
          sug.update(t, c);
        }}
        onSelect={(e) => sug.update(e.currentTarget.value, e.currentTarget.selectionStart ?? 0, false)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => {
          const f = store().focus;
          if (f?.id !== id) store().setFocus({ id, caret: ref.current?.selectionStart ?? 'end' });
        }}
        onBlur={() => {
          sug.close();
          store().commitTitle(id);
          // Fokus verlassen, sofern nicht gleich ein anderer Knoten übernimmt.
          window.setTimeout(() => {
            const f = store().focus;
            if (f?.id === id && document.activeElement !== ref.current && !document.activeElement?.closest('.popover, .dialog, .field-pop')) store().setFocus(null);
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
