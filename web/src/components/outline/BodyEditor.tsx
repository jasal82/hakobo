// Notiz eines Knotens bearbeiten (CodeMirror, Markdown mit Code-Hervorhebung).

import { useEffect, useRef } from 'react';
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { api } from '../../lib/api';
import { plainText } from '../../lib/inline';
import { linkTextFor } from '../../lib/links';
import { ancestors, store } from '../../lib/store';
import { detectTrigger } from './suggest';

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
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(classHighlighter),
        EditorView.lineWrapping,
        placeholder('Notiz … (Markdown, ```code```, [[Link]], #tag)'),
        autocompletion({ override: [complete], icons: false }),
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
          indentWithTab,
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
