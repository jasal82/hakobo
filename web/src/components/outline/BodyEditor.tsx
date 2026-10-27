// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Notiz eines Knotens bearbeiten (CodeMirror, Markdown mit Code-Hervorhebung).

import { useEffect, useRef } from 'react';
import { autocompletion, closeBrackets, closeBracketsKeymap, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState, RangeSetBuilder, type EditorState as State } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { api } from '../../lib/api';
import { indentFor } from '../../lib/code';
import { plainText } from '../../lib/inline';
import { linkTextFor } from '../../lib/links';
import { ancestors, store } from '../../lib/store';
import { detectTrigger } from './suggest';

/** Codeblock (```…```) an einer Position: Bereich und Sprache. */
function fencedAt(state: State, pos: number): { from: number; to: number; lang: string } | null {
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === 'FencedCode') {
      const info = n.getChild('CodeInfo');
      return { from: n.from, to: n.to, lang: info ? state.sliceDoc(info.from, info.to) : '' };
    }
    node = n;
  }
  return null;
}

/** Zeilen innerhalb von Codeblöcken als Code darstellen (Monospace, Hintergrund). */
const codeLines = ViewPlugin.fromClass(
  class {
    deco: DecorationSet;
    constructor(view: EditorView) {
      this.deco = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.deco = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (n) => {
            if (n.name !== 'FencedCode') return;
            const first = view.state.doc.lineAt(n.from).number;
            const last = view.state.doc.lineAt(n.to).number;
            for (let l = first; l <= last; l++) {
              const line = view.state.doc.line(l);
              const cls = `cm-codeline${l === first ? ' is-first' : ''}${l === last ? ' is-last' : ''}`;
              b.add(line.from, line.from, Decoration.line({ class: cls }));
            }
            return false;
          },
        });
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.deco },
);

/** Enter im Code: Einrückung übernehmen, nach {, (, [ oder : eine Stufe mehr. */
function codeEnter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const block = fencedAt(state, sel.head);
  if (!block) return false;
  const line = state.doc.lineAt(sel.head);
  if (line.from === state.doc.lineAt(block.from).from) return false;
  const before = state.sliceDoc(line.from, sel.head);
  const indent = /^[ \t]*/.exec(line.text)![0];
  const unit = indentFor(block.lang, state.sliceDoc(block.from, block.to));
  const extra = /[{([:]\s*$/.test(before) ? unit : '';
  // Zwischen { und }: Schließende Klammer auf eine eigene Zeile.
  const after = state.sliceDoc(sel.head, line.to);
  const closing = extra && /^\s*[})\]]/.test(after) ? '\n' + indent : '';
  const insert = '\n' + indent + extra;
  view.dispatch(state.update({ changes: { from: sel.from, to: sel.to, insert: insert + closing }, selection: { anchor: sel.from + insert.length }, scrollIntoView: true, userEvent: 'input' }));
  return true;
}

/** Tab im Code: Einrückung am Cursor (bzw. Zeilen einrücken bei Auswahl). */
function codeTab(view: EditorView): boolean {
  const { state } = view;
  const block = fencedAt(state, state.selection.main.head);
  if (!block) return indentMore(view);
  if (!state.selection.main.empty) return indentMore(view);
  view.dispatch(state.replaceSelection(indentFor(block.lang, state.sliceDoc(block.from, block.to))));
  return true;
}

/** Vervollständigung für [[Links, #Tags und @Erwähnungen in Notizen. */
async function complete(ctx: CompletionContext): Promise<CompletionResult | null> {
  const start = Math.max(0, ctx.pos - 100);
  const before = ctx.state.sliceDoc(start, ctx.pos);
  const t = detectTrigger(before, before.length, ['tag', 'mention', 'link']);
  if (!t) return null;
  const from = start + t.start;
  if (t.kind === 'tag') {
    const tags = await api.tags(t.query, 20);
    return {
      from,
      options: tags.map((x) => ({ label: `#${x.tag}`, detail: x.count ? String(x.count) : undefined, type: 'keyword' })),
      validFor: /^#[\p{L}\p{N}_\-/]*$/u,
    };
  }
  const query = t.kind === 'mention' ? `#person ${t.query}` : t.query || 'is:page';
  const res = await api.search(query, 15);
  const nodes = store().nodes;
  const options: Completion[] = res.hits
    .filter((h) => nodes[h.id])
    .map((h) => {
      const n = nodes[h.id];
      return {
        label: n.kind === 'item' ? plainText(n.text) : n.text,
        detail: ancestors(nodes, n.id)
          .map((a) => (a.kind === 'item' ? plainText(a.text, false) : a.text))
          .join(' › '),
        type: n.kind === 'page' ? 'class' : 'text',
        apply: (view, _c, f, to) => {
          void linkTextFor(store().nodes, n.id, api.link).then((link) => {
            const end = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to;
            view.dispatch({ changes: { from: f, to: end, insert: link }, selection: { anchor: f + link.length } });
          });
        },
      };
    });
  return { from, options, filter: false };
}

export function BodyEditor({ id, onClose }: { id: string; onClose: (focusTitle: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const n = store().nodes[id];
    if (!host.current || !n) return;
    const state = EditorState.create({
      doc: n.body,
      extensions: [
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
        syntaxHighlighting(classHighlighter),
        codeLines,
        EditorView.lineWrapping,
        EditorState.tabSize.of(4),
        placeholder('Notiz … (Markdown, ```code```, [[Link]], #tag)'),
        autocompletion({ override: [complete], icons: false }),
        keymap.of([
          { key: 'Enter', run: codeEnter },
          { key: 'Tab', run: codeTab, shift: indentLess },
          ...closeBracketsKeymap,
          ...markdownKeymap,
        ]),
        keymap.of([
          {
            key: 'Escape',
            run: () => {
              closeRef.current(true);
              return true;
            },
          },
          {
            key: 'Shift-Enter',
            run: () => {
              closeRef.current(true);
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) store().setBody(id, u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          blur: (_e, v) => {
            window.setTimeout(() => {
              if (!v.hasFocus && !document.activeElement?.closest('.cm-tooltip')) closeRef.current(false);
            }, 120);
            return false;
          },
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    v.focus();
    v.dispatch({ selection: { anchor: v.state.doc.length } });
    // Leerer Codeblock aus dem Slash-Befehl: Cursor hinein.
    const doc = v.state.doc.toString();
    if (doc.endsWith('```\n\n```')) v.dispatch({ selection: { anchor: doc.length - 4 } });
    return () => {
      v.destroy();
      view.current = null;
      store().flushPending();
    };
  }, [id]);

  return <div className="body-editor" ref={host} />;
}
