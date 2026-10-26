// Schnellerfassung: gemeinsames Eingabefeld für das Modal (Strg+N) und das
// Hotkey-Fenster. Slash-Befehle werden live erkannt und als Chips angezeigt;
// gespeichert wird über den Server, der die Befehle auswertet.

import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarClock, CheckSquare, ChevronDown, CornerDownLeft, Hash, Repeat, X } from 'lucide-react';
import { api, type CapturePreview } from '../lib/api';
import { extractTags, plainText } from '../lib/inline';
import { store, useStore } from '../lib/store';
import type { CommandResult } from '../lib/types';
import { InlineEditor, type InlineEditorHandle } from './InlineEditor';
import { useSuggest } from './outline/suggest';
import { allPages, NodeIcon, nodeTitle, PathLine, pathTitles, useCandidates, useListKeys, waitForNode } from './search/common';
import { Dialog, Highlighted, Popover, useScrollActive, type Anchor } from './ui';

export interface Captured {
  id: string;
  text: string;
  summary: string[];
  /** „In der Inbox“ bzw. „Unter „Projekte““. */
  place: string;
}

interface Target {
  id: string;
  label: string;
}

/** Kanonischer Befehl für einen übernommenen Vorschlag (versteht der Server). */
function cmdText(r: CommandResult): string {
  switch (r.kind) {
    case 'todo':
      return '/todo';
    case 'due':
      return `/due ${r.value}`;
    case 'date':
      return `/termin ${r.value}`;
    case 'repeat':
      return `/wdh ${r.value}`;
    case 'remind':
      return `/erinnerung ${r.value.split(',')[0].trim()}`;
  }
}

/** Übernommene Befehle hinter die erste Zeile hängen (nur dort wertet der Server sie aus). */
export function compose(text: string, accepted: CommandResult[]): string {
  const [first, ...rest] = text.split('\n');
  const line = [first.trimEnd(), ...accepted.map(cmdText)].filter(Boolean).join(' ');
  return [line, ...rest].join('\n');
}

function group(k: CommandResult['kind']) {
  return k === 'due' || k === 'date' ? 'date' : k;
}

function mergeCommand(list: CommandResult[], r: CommandResult): CommandResult[] {
  if (r.kind === 'todo') return list.some((x) => x.kind === 'todo') ? list.filter((x) => x.kind !== 'todo') : [...list, r];
  return [...list.filter((x) => group(x.kind) !== group(r.kind)), r];
}

/** Inhalt nach dem Doppelpunkt („Termin: Morgen 14:00“ → „Morgen 14:00“). */
const afterColon = (s: string) => s.slice(s.indexOf(':') + 1).trim();

function summaryIcon(s: string) {
  if (s.startsWith('Wiederholung')) return <Repeat size={12} />;
  if (s.startsWith('Erinnerung')) return <Bell size={12} />;
  return <CalendarClock size={12} />;
}

export function CaptureBox({ variant, onDone, onCancel, resetKey = 0 }: { variant: 'modal' | 'window'; onDone: (r: Captured, open: boolean) => void; onCancel: () => void; resetKey?: number }) {
  const [text, setText] = useState('');
  const [accepted, setAccepted] = useState<CommandResult[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Anchor | null>(null);
  const ref = useRef<InlineEditorHandle>(null);
  const commandTaken = useRef(false);
  const targetBtn = useRef<HTMLButtonElement>(null);
  const inboxTitle = useStore((s) => s.nodes[s.inbox]?.text ?? 'Inbox');

  const apply = (t: string, caret: number) => {
    // Nach einem übernommenen Befehl ein Leerzeichen, damit nicht gleich
    // die Vorschläge für ein davorstehendes #tag aufgehen.
    if (commandTaken.current) {
      commandTaken.current = false;
      if (caret === t.length && t && !/\s$/.test(t)) {
        t += ' ';
        caret += 1;
      }
      const [finalText, finalCaret] = [t, caret];
      // Nach der Nachprüfung des Hooks (mit dem Text ohne Leerzeichen) erneut prüfen.
      window.setTimeout(() => sug.update(finalText, finalCaret), 30);
    }
    setText(t);
    ref.current?.setText(t, caret);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const sug = useSuggest({
    anchorAt: (i) => ref.current?.coordsAt(i) ?? null,
    text,
    apply,
    commands: 'capture',
    onCommand: (r) => {
      commandTaken.current = true;
      setAccepted((list) => mergeCommand(list, r));
    },
  });

  // Zurücksetzen (Hotkey-Fenster wird neu gezeigt).
  useEffect(() => {
    setText('');
    setAccepted([]);
    setTarget(null);
    setPreview(null);
    setError(null);
    setPicker(null);
    setSaving(false);
    sug.close();
    requestAnimationFrame(() => ref.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Live-Vorschau der erkannten Befehle.
  useEffect(() => {
    const full = compose(text, accepted);
    if (!full.trim()) {
      setPreview(null);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      api.capturePreview(full, ac.signal).then(setPreview, () => undefined);
    }, 90);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [text, accepted]);

  // Esc zuerst für Vorschlagsliste und Zielauswahl (vor dem Dialog abfangen).
  const sugOpen = sug.open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (picker || (sugOpen && ref.current?.hasFocus()))) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (picker) setPicker(null);
        else sug.close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugOpen, picker]);

  const openPicker = () => {
    const r = targetBtn.current?.getBoundingClientRect();
    if (r) setPicker({ left: r.left, top: r.top, bottom: r.bottom });
  };

  const save = async (open: boolean) => {
    const full = compose(text, accepted);
    if (!full.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.capture(full, target?.id ?? null);
      const place = target ? `Unter „${target.label}“` : `In der ${inboxTitle}`;
      onDone({ id: res.id, text: plainText(res.node?.text ?? full.split('\n')[0]), summary: res.summary, place }, open);
      setText('');
      setAccepted([]);
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
      requestAnimationFrame(() => ref.current?.focus());
    }
  };

  const onKeyDown = (e: KeyboardEvent): boolean => {
    // Bei Slash-Befehlen speichert Enter direkt (der Server wertet sie aus);
    // Tab übernimmt den Vorschlag als Chip.
    if (e.key === 'Enter' && !e.shiftKey && sug.trigger?.kind === 'slash') {
      e.preventDefault();
      sug.close();
      void save(e.ctrlKey || e.metaKey);
      return true;
    }
    if (sug.onKeyDown(e)) return true;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save(mod);
      return true;
    }
    if (e.key === 'Tab' && !e.shiftKey && !mod) {
      e.preventDefault();
      openPicker();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return true;
    }
    return false;
  };

  // Chips: übernommene Befehle (entfernbar) und im Text erkannte (aus der Vorschau).
  const chips: { key: string; label: string; icon: React.ReactNode; remove?: () => void }[] = [];
  const todoAccepted = accepted.find((a) => a.kind === 'todo');
  if (preview?.task || todoAccepted) {
    chips.push({ key: 'todo', label: 'Todo', icon: <CheckSquare size={12} />, remove: todoAccepted ? () => setAccepted((l) => l.filter((x) => x !== todoAccepted)) : undefined });
  }
  for (const s of preview?.summary ?? []) {
    const acc = accepted.find((a) => a.kind !== 'todo' && afterColon(a.human) === afterColon(s));
    chips.push({ key: s, label: s, icon: summaryIcon(s), remove: acc ? () => setAccepted((l) => l.filter((x) => x !== acc)) : undefined });
  }
  for (const t of extractTags(preview?.text ?? text)) chips.push({ key: `#${t}`, label: `#${t}`, icon: <Hash size={12} /> });

  return (
    <div className={`capture-box is-${variant}`}>
      <InlineEditor
        handleRef={ref}
        className="capture-input"
        value={text}
        autoFocus
        multiline
        ownHistory
        placeholder="Idee, Todo oder Termin … /morgen 14 uhr #tag @person"
        onChange={(t, c) => {
          setText(t);
          sug.update(t, c);
        }}
        onSelectionChange={(t, c) => sug.update(t, c, false)}
        onKeyDown={onKeyDown}
        onBlur={() => sug.close()}
      />
      {sug.menu}
      <div className="capture-chips">
        {chips.map((c) => (
          <span key={c.key} className={`chip capture-chip${c.remove ? ' is-accepted' : ''}`}>
            {c.icon}
            {c.label}
            {c.remove && (
              <button className="chip-x" onMouseDown={(e) => e.preventDefault()} onClick={c.remove} aria-label="Entfernen">
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!chips.length && <span className="capture-help">/ für Datum, Wiederholung, Erinnerung · # Tag · @ Person · [[ Link</span>}
      </div>
      {error && <div className="capture-error">{error}</div>}
      <div className="capture-bar">
        <button ref={targetBtn} className="btn btn-ghost btn-sm capture-target" onMouseDown={(e) => e.preventDefault()} onClick={openPicker} title="Ziel wählen (Tab)">
          <span className="faint">Ziel:</span> {target?.label ?? inboxTitle}
          <ChevronDown size={13} />
        </button>
        {target && (
          <button className="btn btn-ghost btn-icon btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => setTarget(null)} title="Zurück zur Inbox">
            <X size={13} />
          </button>
        )}
        <span className="spacer" />
        <span className="capture-keys">
          <kbd>↵</kbd> speichern · <kbd>Strg</kbd>
          <kbd>↵</kbd> öffnen · <kbd>⇧</kbd>
          <kbd>↵</kbd> Zeile
        </span>
        <button className="btn btn-accent btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => void save(false)} disabled={saving || !compose(text, accepted).trim()}>
          {saving ? <span className="spinner" /> : <CornerDownLeft size={14} />} Speichern
        </button>
      </div>
      {picker && (
        <TargetPicker
          anchor={picker}
          onPick={(t) => {
            setTarget(t);
            setPicker(null);
            requestAnimationFrame(() => ref.current?.focus());
          }}
          onClose={() => {
            setPicker(null);
            requestAnimationFrame(() => ref.current?.focus());
          }}
        />
      )}
    </div>
  );
}

/** Fuzzy-Auswahl des Ziels (Seite oder Eintrag). */
function TargetPicker({ anchor, onPick, onClose }: { anchor: Anchor; onPick: (t: Target | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const nodes = useStore((s) => s.nodes);
  const inbox = useStore((s) => s.inbox);
  const listRef = useRef<HTMLDivElement>(null);
  const { list: raw } = useCandidates(q, () => allPages(nodes, inbox), 30);
  const list = raw.filter((c) => nodes[c.id] && nodes[c.id].kind !== 'root').slice(0, 30);
  const { active, setActive, onKey } = useListKeys(list.length, [q]);
  useScrollActive(listRef, active);
  const pick = (id: string) => onPick(id === inbox ? null : { id, label: nodeTitle(nodes[id]) || 'Unbenannt' });
  return (
    <Popover anchor={anchor} onClose={onClose} width={380} className="capture-picker">
      <div className="fp-body">
        <input
          className="input"
          autoFocus
          value={q}
          placeholder="Seite oder Eintrag suchen …"
          onChange={(e) => setQ(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (onKey(e)) return;
            if (e.key === 'Enter' && list[active]) {
              e.preventDefault();
              pick(list[active].id);
            } else if (e.key === 'Escape' || e.key === 'Tab') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
      </div>
      <div className="menu capture-picker-list" ref={listRef}>
        {list.map((c, i) => {
          const n = nodes[c.id];
          return (
            <button key={c.id} className={`menu-item${i === active ? ' is-active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => pick(c.id)}>
              <span className="menu-icon">
                <NodeIcon n={n} inbox={inbox} />
              </span>
              <span className="menu-label">
                <Highlighted text={nodeTitle(n)} ranges={c.hit?.titleRanges} />
                <span className="menu-path">
                  <PathLine parts={pathTitles(nodes, c.id)} ranges={c.hit?.pathRanges} />
                </span>
              </span>
            </button>
          );
        })}
        {!list.length && <div className="menu-empty">Nichts gefunden</div>}
      </div>
    </Popover>
  );
}

/** Schnellerfassung im Hauptfenster (Strg+N). */
export function CaptureModal() {
  const close = () => store().set({ captureOpen: false });
  return (
    <Dialog title="Schnell erfassen" onClose={close} width={660} className="capture-dialog">
      <CaptureBox
        variant="modal"
        onCancel={close}
        onDone={async (r, open) => {
          close();
          const there = await waitForNode(r.id);
          if (open && there) {
            store().reveal(r.id, { edit: true });
            return;
          }
          const extra = r.summary.length ? ` · ${r.summary.map(afterColon).join(' · ')}` : '';
          store().toast(`${r.place}: ${r.text || 'Eintrag'}${extra}`, 'success', there ? { label: 'Öffnen', run: () => store().reveal(r.id) } : undefined);
        }}
      />
    </Dialog>
  );
}
