// Codeblock als eigener Knoten: hervorgehobene Ansicht und Code-Editor.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { findLanguage, formatFence, guessLanguage, indentFor, languageLabel, languageOptions, parseFence } from '../../lib/code';
import { highlight } from '../../lib/markdown';
import { createAfter, nextVisible, prevVisible } from '../../lib/outline';
import { store, useStore } from '../../lib/store';
import { Popover, useScrollActive, type Anchor } from '../ui';

/** Klickposition, an die der Cursor beim Öffnen des Editors springt. */
let pendingClick: { id: string; x: number; y: number } | null = null;

export async function copyText(text: string, what = 'Code') {
  try {
    await navigator.clipboard.writeText(text);
    store().toast(`${what} kopiert`, 'success');
  } catch {
    store().toast('Kopieren nicht möglich', 'error');
  }
}

function setCode(id: string, lang: string, code: string) {
  store().setBody(id, formatFence(lang, code));
}

/** Sprache wählen (Suche über alle Sprachen, häufige zuerst). */
export function LanguagePicker({ anchor, current, onPick, onClose }: { anchor: Anchor; current: string; onPick: (lang: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollActive(listRef, active);
  const list = useMemo(() => {
    const all = languageOptions();
    const l = q.trim().toLowerCase();
    const hits = l ? all.filter((o) => o.label.toLowerCase().includes(l) || o.id.includes(l)) : all.slice(0, 26);
    return [...hits.slice(0, 60), { label: 'Ohne Sprache', id: '' }];
  }, [q]);
  return (
    <Popover anchor={anchor} onClose={onClose} width={240} className="lang-picker">
      <div className="fp-body">
        <input
          className="input"
          autoFocus
          placeholder="Sprache suchen …"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, list.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (list[active]) onPick(list[active].id);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
      </div>
      <div className="menu fp-list" ref={listRef}>
        {list.map((o, i) => (
          <button key={o.id + o.label} className={`menu-item${i === active ? ' is-active' : ''}${o.id === current ? ' is-current' : ''}`} onMouseMove={() => setActive(i)} onClick={() => onPick(o.id)}>
            <span className="menu-label">{o.label}</span>
            {o.id && <span className="menu-hint mono">{o.id}</span>}
          </button>
        ))}
      </div>
    </Popover>
  );
}

/** Kopfzeile eines Codeblocks: Sprache und Kopieren. */
function CodeHeader({ id, lang, guessed, code }: { id: string; lang: string; guessed: string | null; code: string }) {
  const [picker, setPicker] = useState<Anchor | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-head" onMouseDown={(e) => e.stopPropagation()}>
      <button
        className={`code-lang${lang ? '' : ' is-guess'}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPicker({ left: r.left, top: r.top, bottom: r.bottom });
        }}
        title="Sprache wählen"
      >
        {lang ? languageLabel(lang) : guessed ? `${languageLabel(guessed)}?` : 'Sprache'}
        <ChevronDown size={12} />
      </button>
      <button
        className="code-copy"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          void copyText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
        title="Code kopieren"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {picker && (
        <LanguagePicker
          anchor={picker}
          current={lang}
          onClose={() => setPicker(null)}
          onPick={(l) => {
            setPicker(null);
            store().commit([{ op: 'update', id, body: formatFence(l, code) }]);
          }}
        />
      )}
    </div>
  );
}

/** Hervorgehobener Code (Lezer, wie im Editor). */
export function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (lang) void highlight(code, lang).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [code, lang]);
  return html !== null ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>;
}

export function CodeBlock({ id, root, focused }: { id: string; root: string; focused: boolean }) {
  const body = useStore((s) => s.nodes[id]?.body ?? '');
  const block = parseFence(body) ?? { lang: '', code: '', fence: '```' };
  const guessed = useMemo(() => (block.lang ? null : guessLanguage(block.code)), [block.lang, block.code]);
  return (
    <div className={`code-block${focused ? ' is-editing' : ''}`}>
      <CodeHeader id={id} lang={block.lang} guessed={guessed} code={block.code} />
      {focused ? (
        <CodeEditor id={id} root={root} lang={block.lang} guessed={guessed} code={block.code} />
      ) : (
        <pre
          className="code-view"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            pendingClick = { id, x: e.clientX, y: e.clientY };
          }}
          onClick={() => {
            if (window.getSelection()?.toString()) return;
            store().setFocus({ id, caret: 'end' });
          }}
        >
          {block.code ? <HighlightedCode code={block.code} lang={block.lang || guessed || ''} /> : <span className="faint">Code …</span>}
        </pre>
      )}
    </div>
  );
}

function CodeEditor({ id, root, lang, guessed, code }: { id: string; root: string; lang: string; guessed: string | null; code: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const languageConf = useRef(new Compartment());
  const indentConf = useRef(new Compartment());
  const focus = useStore((s) => (s.focus?.id === id ? s.focus : null));

  useLayoutEffect(() => {
    if (!host.current) return;
    const leave = (dir: -1 | 1) => {
      const target = dir < 0 ? prevVisible(id, root) : nextVisible(id, root);
      if (target) store().setFocus({ id: target, caret: dir < 0 ? 'end' : 'start' });
      return !!target;
    };
    const finish = () => {
      // Ohne Sprache: die erkannte übernehmen (im Chip änderbar).
      const v = viewRef.current;
      const text = v?.state.doc.toString() ?? '';
      if (!langRef.current && text.trim()) {
        const g = guessLanguage(text);
        if (g) setCode(id, g, text);
      }
    };
    const tab = (view: EditorView) => {
      const sel = view.state.selection.main;
      if (!sel.empty || view.state.selection.ranges.length > 1) return indentMore(view);
      const unit = view.state.facet(indentUnit);
      view.dispatch(view.state.replaceSelection(unit));
      return true;
    };
    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        syntaxHighlighting(classHighlighter),
        placeholder('Code …'),
        languageConf.current.of([]),
        indentConf.current.of(indentUnit.of(indentFor(lang || guessed || '', code))),
        EditorState.tabSize.of(4),
        keymap.of([
          {
            key: 'Escape',
            run: () => {
              finish();
              store().setFocus(null);
              return true;
            },
          },
          {
            key: 'Mod-Enter',
            run: () => {
              finish();
              createAfter(id);
              return true;
            },
          },
          {
            key: 'Shift-Enter',
            run: () => {
              finish();
              createAfter(id);
              return true;
            },
          },
          {
            key: 'ArrowUp',
            run: (v) => v.state.doc.lineAt(v.state.selection.main.head).number === 1 && v.state.selection.main.empty && leave(-1),
          },
          {
            key: 'ArrowDown',
            run: (v) => v.state.doc.lineAt(v.state.selection.main.head).number === v.state.doc.lines && v.state.selection.main.empty && leave(1),
          },
          {
            key: 'Backspace',
            run: (v) => {
              if (v.state.doc.length > 0) return false;
              // Leerer Codeblock → wieder normale Zeile.
              store().commit([{ op: 'update', id, body: '' }], { focusAfter: { id, caret: 0 } });
              return true;
            },
          },
          { key: 'Tab', run: tab, shift: indentLess },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setCode(id, langRef.current, u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          blur: (_e, v) => {
            // Klick woanders hin: Bearbeitung beenden (nicht bei Sprachauswahl o. Ä.).
            window.setTimeout(() => {
              if (store().focus?.id === id && !v.hasFocus && !document.activeElement?.closest('.cm-editor, .popover, .dialog')) store().setFocus(null);
            }, 0);
            return false;
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      finish();
      view.destroy();
      viewRef.current = null;
      store().flushPending();
    };
    // Nur beim Öffnen; spätere Änderungen kommen aus dem Editor selbst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Sprache (nach)laden.
  useEffect(() => {
    const view = viewRef.current;
    const desc = findLanguage(lang || guessed || '');
    if (!view) return;
    view.dispatch({ effects: indentConf.current.reconfigure(indentUnit.of(indentFor(lang || guessed || '', view.state.doc.toString()))) });
    if (!desc) {
      view.dispatch({ effects: languageConf.current.reconfigure([]) });
      return;
    }
    let alive = true;
    void (desc.support ? Promise.resolve(desc.support) : desc.load()).then((support) => {
      if (alive && viewRef.current) viewRef.current.dispatch({ effects: languageConf.current.reconfigure(support) });
    });
    return () => {
      alive = false;
    };
  }, [lang, guessed]);

  // Cursor setzen, wenn der Fokus hierher wechselt.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || !focus) return;
    view.focus();
    let pos: number | null = null;
    if (pendingClick?.id === id) {
      pos = view.posAtCoords({ x: pendingClick.x, y: pendingClick.y });
      pendingClick = null;
    }
    if (pos === null) {
      const len = view.state.doc.length;
      pos = focus.caret === 'start' ? 0 : typeof focus.caret === 'number' ? Math.min(focus.caret, len) : len;
    }
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  return <div className="code-editor" ref={host} />;
}
