// Einzeiliger (bzw. kurzer mehrzeiliger) Editor auf CodeMirror-Basis.
// Links und Erwähnungen erscheinen als Chips, die der Cursor als Ganzes
// überspringt; Tags, URLs, Inline-Code und Hervorhebungen werden markiert.
// Der gespeicherte Text bleibt unverändert (z. B. `[[Personen#^id|Anna]]`).

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { history, historyKeymap, insertNewline, standardKeymap } from '@codemirror/commands';
import { Annotation, EditorSelection, EditorState, Prec, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder as cmPlaceholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tokenize, type Segment } from '../lib/inline';
import { isPerson, linkLabel, resolveKey } from '../lib/links';
import { store } from '../lib/store';
import type { Node } from '../lib/types';
import type { Anchor } from './ui';

/** Änderung von außen (Store, Vorschlag) – kein `onChange`. */
const external = Annotation.define<boolean>();

export interface InlineEditorHandle {
  getText: () => string;
  /** [Anfang, Ende] der Auswahl. */
  getSelection: () => [number, number];
  setText: (text: string, from: number, to?: number) => void;
  setSelection: (from: number, to?: number) => void;
  focus: () => void;
  blur: () => void;
  hasFocus: () => boolean;
  coordsAt: (pos: number) => Anchor | null;
  /** Steht der Cursor in der ersten (-1) bzw. letzten (1) sichtbaren Zeile? */
  atEdge: (dir: -1 | 1) => boolean;
  dom: () => HTMLElement | null;
}

class LinkChip extends WidgetType {
  constructor(
    readonly label: string,
    readonly cls: string,
    readonly id: string | null,
  ) {
    super();
  }
  eq(o: LinkChip) {
    return o.label === this.label && o.cls === this.cls && o.id === this.id;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = `cm-chip ${this.cls}`;
    s.textContent = this.label;
    if (this.id) s.dataset.id = this.id;
    s.title = this.id ? 'Strg+Klick öffnet das Ziel' : 'Ziel gibt es (noch) nicht';
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

const MARK: Partial<Record<Segment['t'], string>> = { tag: 'cm-tag', url: 'cm-url', code: 'cm-icode', bold: 'cm-strong', italic: 'cm-em', strike: 'cm-strike', mark: 'cm-hl' };

function decorate(text: string, source: Node | undefined): { deco: DecorationSet; atomic: DecorationSet } {
  const marks: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const nodes = store().nodes;
  const walk = (segs: Segment[]) => {
    for (const s of segs) {
      if (s.e <= s.s) continue;
      if (s.t === 'link') {
        const id = resolveKey(nodes, source, s.key);
        const target = id ? nodes[id] : undefined;
        const person = isPerson(target);
        const label = (person ? '@' : '') + linkLabel(nodes, id, s.alias, s.target);
        const cls = `${id ? '' : 'is-broken '}${person ? 'is-person ' : ''}${target?.kind === 'page' ? 'is-page' : ''}`.trim();
        const d = Decoration.replace({ widget: new LinkChip(label, cls, id) });
        marks.push(d.range(s.s, s.e));
        atomic.push(d.range(s.s, s.e));
        continue;
      }
      const cls = MARK[s.t];
      if (cls) marks.push(Decoration.mark({ class: cls }).range(s.s, s.e));
      if ('children' in s) walk(s.children);
    }
  };
  walk(tokenize(text));
  return { deco: Decoration.set(marks, true), atomic: Decoration.set(atomic, true) };
}

interface Props {
  value: string;
  onChange: (text: string, caret: number) => void;
  /** `true`: Taste verarbeitet (Standardverhalten des Editors entfällt). */
  onKeyDown?: (e: KeyboardEvent, h: InlineEditorHandle) => boolean;
  onPaste?: (e: ClipboardEvent, h: InlineEditorHandle) => boolean;
  onSelectionChange?: (text: string, caret: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Mehrzeilig (Umschalt+Enter fügt eine Zeile ein); sonst werden Umbrüche zu Leerzeichen. */
  multiline?: boolean;
  /** Eigene Rückgängig-Historie (sonst übernimmt der Store). */
  ownHistory?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Knoten, dessen Link-Auflösung vom Server genutzt wird. */
  source?: Node;
  handleRef?: Ref<InlineEditorHandle>;
}

export function InlineEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const handle: InlineEditorHandle = {
    getText: () => viewRef.current?.state.doc.toString() ?? '',
    getSelection: () => {
      const s = viewRef.current?.state.selection.main;
      return s ? [s.from, s.to] : [0, 0];
    },
    setText: (text, from, to) => {
      const v = viewRef.current;
      if (!v) return;
      const len = text.length;
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: text },
        selection: EditorSelection.range(Math.min(from, len), Math.min(to ?? from, len)),
        annotations: external.of(true),
      });
    },
    setSelection: (from, to) => {
      const v = viewRef.current;
      if (!v) return;
      const len = v.state.doc.length;
      v.dispatch({ selection: EditorSelection.range(Math.min(from, len), Math.min(to ?? from, len)) });
    },
    focus: () => viewRef.current?.focus(),
    blur: () => viewRef.current?.contentDOM.blur(),
    hasFocus: () => !!viewRef.current?.hasFocus,
    coordsAt: (pos) => {
      const c = viewRef.current?.coordsAtPos(pos);
      return c ? { left: c.left, top: c.top, bottom: c.bottom } : null;
    },
    atEdge: (dir) => {
      const v = viewRef.current;
      if (!v) return true;
      const head = v.state.selection.main.head;
      const here = v.coordsAtPos(head);
      const edge = v.coordsAtPos(dir < 0 ? 0 : v.state.doc.length);
      if (!here || !edge) return true;
      return Math.abs(here.top - edge.top) < 3;
    },
    dom: () => viewRef.current?.dom ?? null,
  };
  useImperativeHandle(props.handleRef, () => handle);

  useLayoutEffect(() => {
    if (!host.current) return;
    const p = latest.current;
    const chips = ViewPlugin.fromClass(
      class {
        deco: DecorationSet;
        atomic: DecorationSet;
        constructor(view: EditorView) {
          ({ deco: this.deco, atomic: this.atomic } = decorate(view.state.doc.toString(), latest.current.source));
        }
        update(u: ViewUpdate) {
          if (u.docChanged) ({ deco: this.deco, atomic: this.atomic } = decorate(u.state.doc.toString(), latest.current.source));
        }
      },
      {
        decorations: (v) => v.deco,
        provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
      },
    );
    const state = EditorState.create({
      doc: p.value,
      extensions: [
        chips,
        p.ownHistory ? [history(), keymap.of(historyKeymap)] : [],
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences' }),
        p.placeholder ? cmPlaceholder(p.placeholder) : [],
        p.multiline ? [] : EditorState.transactionFilter.of((tr) => {
          if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
          const flat = tr.newDoc.toString().replace(/\r?\n/g, ' ');
          return [tr, { changes: { from: 0, to: tr.newDoc.length, insert: flat }, sequential: true }];
        }),
        Prec.highest(
          EditorView.domEventHandlers({
            keydown: (e) => latest.current.onKeyDown?.(e, handle) ?? false,
            paste: (e) => {
              const r = latest.current.onPaste?.(e, handle) ?? false;
              if (r) e.preventDefault();
              return r;
            },
            focus: () => {
              latest.current.onFocus?.();
              return false;
            },
            blur: () => {
              latest.current.onBlur?.();
              return false;
            },
            mousedown: (e) => {
              const chip = (e.target as HTMLElement).closest('.cm-chip') as HTMLElement | null;
              if (chip?.dataset.id && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                store().reveal(chip.dataset.id);
                return true;
              }
              return false;
            },
          }),
        ),
        keymap.of([...(p.multiline ? [{ key: 'Shift-Enter', run: insertNewline }] : []), ...standardKeymap.filter((b) => b.key !== 'Enter')]),
        EditorView.updateListener.of((u) => {
          const text = u.state.doc.toString();
          const head = u.state.selection.main.head;
          const ext = u.transactions.some((t) => t.annotation(external));
          if (u.docChanged && !ext) latest.current.onChange(text, head);
          if (u.selectionSet || u.docChanged) latest.current.onSelectionChange?.(text, head);
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    if (p.autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Wert von außen übernehmen (Rückgängig, Änderungen aus anderen Fenstern).
  useEffect(() => {
    const v = viewRef.current;
    if (!v || v.state.doc.toString() === props.value) return;
    const sel = v.state.selection.main;
    const len = props.value.length;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: props.value },
      selection: EditorSelection.range(Math.min(sel.anchor, len), Math.min(sel.head, len)),
      annotations: external.of(true),
    });
  }, [props.value]);

  return <div ref={host} className={`inline-editor ${props.className ?? ''}`} />;
}
