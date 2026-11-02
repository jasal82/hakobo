// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Versionen einer Seite: Liste der Commits, Änderungen gegenüber heute, Wiederherstellen.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronsUpDown, History, RotateCcw, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, relativeTime } from '../lib/dates';
import { store, useStore } from '../lib/store';
import type { CommitInfo } from '../lib/types';
import { Dialog, moveFocus } from './ui';
import { diffBlocks, diffLines, diffStats, type DiffLine } from './settings/diff';
import { L } from '../i18n';

const CURRENT = '__current__';

/** Kurzfassung einer Commit-Nachricht (vom Server; bisher deutsch, evtl. künftig auch englisch). */
function describe(c: CommitInfo, path: string): { title: string; detail?: string } {
  const s = c.summary.trim();
  const page = path.replace(/\.md$/, '');
  const edited = /^(?:Bearbeitet|Edited): /.exec(s);
  if (edited) {
    const list = s.slice(edited[0].length);
    const others = list
      .split(/,\s*/)
      .map((x) => x.trim())
      .filter((x) => x && x.toLowerCase() !== page.toLowerCase());
    const rest = others.length ? L.dialogs.history.together(others.join(', ')) : undefined;
    return { title: L.dialogs.history.edited, detail: rest };
  }
  if (/^(?:Synchronisiert|Synced)/.test(s)) return { title: L.dialogs.history.synced, detail: s.replace(/^(?:Synchronisiert|Synced)\s*/, '').replace(/^\((.*)\)$/, '$1') || undefined };
  if (s.endsWith('(wiederhergestellt)') || s.endsWith('(restored)')) return { title: L.dialogs.history.restored };
  return { title: s || L.dialogs.history.version };
}

/** Gerät/Autor: „Hakobo (RECHNER)“ → „RECHNER“; ältere Versionen stammen von „Sqizzo (RECHNER)“. */
function author(c: CommitInfo): string {
  const m = /^(?:Hakobo|Sqizzo) \((.+)\)$/.exec(c.author);
  return m ? m[1] : c.author;
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  const blocks = useMemo(() => diffBlocks(lines), [lines]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => setOpen(new Set()), [lines]);
  const stats = diffStats(lines);
  if (!stats.added && !stats.removed) {
    return <div className="hist-same">{L.dialogs.history.same}</div>;
  }
  return (
    <div className="hist-diff" role="table">
      {blocks.map((b, bi) => {
        if (b.kind === 'skip' && !open.has(bi)) {
          return (
            <button key={bi} className="hist-skip" onClick={() => setOpen(new Set(open).add(bi))}>
              <ChevronsUpDown size={13} /> {L.dialogs.history.unchanged(b.lines.length)}
            </button>
          );
        }
        return b.lines.map((l, li) => (
          <div key={`${bi}-${li}`} className={`hist-line is-${l.t}`} role="row">
            <span className="hist-num">{l.a ?? ''}</span>
            <span className="hist-num">{l.b ?? ''}</span>
            <span className="hist-sign">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span>
            <span className="hist-text">{l.text || ' '}</span>
          </div>
        ));
      })}
    </div>
  );
}

function TextView({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  return (
    <div className="hist-diff">
      {lines.map((l, i) => (
        <div key={i} className="hist-line is-eq">
          <span className="hist-num">{i + 1}</span>
          <span className="hist-text">{l || ' '}</span>
        </div>
      ))}
    </div>
  );
}

export function HistoryDialog() {
  const id = useStore((s) => s.history);
  const page = useStore((s) => (s.history ? s.nodes[s.history] : undefined));
  const [path, setPath] = useState('');
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<{ text: string | null; current: string } | null>(null);
  const [mode, setMode] = useState<'diff' | 'text'>('diff');
  const [error, setError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const close = useCallback(() => store().set({ history: null }), []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.history(id).then(
      (r) => {
        if (!alive) return;
        setPath(r.path);
        setCommits(r.commits);
        setSelected(r.commits[0]?.id ?? null);
      },
      (e) => alive && setError((e as Error).message),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  // Nach dem Laden: Fokus in die Liste, damit ↑ ↓ sofort Versionen wählen.
  const loaded = !!commits?.length;
  useEffect(() => {
    const a = document.activeElement;
    if (loaded && (!a || a === document.body || a.matches('.dialog'))) document.querySelector<HTMLElement>('.history-dialog .hist-item.is-active')?.focus();
  }, [loaded]);

  useEffect(() => {
    if (!id || !selected) return;
    let alive = true;
    // Für „Aktueller Stand“ genügt der Inhalt aus einer beliebigen Version.
    const rev = selected === CURRENT ? commits?.[0]?.id : selected;
    if (!rev) return;
    setLoadingFile(true);
    api.historyFile(id, rev).then(
      (r) => {
        if (!alive) return;
        setFile({ text: r.text, current: r.current });
        setLoadingFile(false);
      },
      (e) => {
        if (!alive) return;
        setError((e as Error).message);
        setLoadingFile(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [id, selected, commits]);

  const lines = useMemo(() => (file && selected !== CURRENT ? diffLines(file.text ?? '', file.current) : []), [file, selected]);
  const sel = commits?.find((c) => c.id === selected);
  const stats = useMemo(() => diffStats(lines), [lines]);
  const changed = stats.added + stats.removed > 0;

  const restore = async () => {
    if (!id || !sel) return;
    if (!confirm(L.dialogs.history.confirmRestore(formatDateTime(sel.time)))) return;
    setRestoring(true);
    try {
      await api.restore(id, sel.id);
      store().toast(L.dialogs.history.restored, 'success');
      close();
    } catch (e) {
      setError((e as Error).message);
      setRestoring(false);
    }
  };

  const title = (
    <span className="hist-title">
      <History size={16} /> {L.dialogs.history.title(page?.text ?? path.replace(/\.md$/, ''))}
    </span>
  );

  return (
    <Dialog title={title} onClose={close} width={1000} className="history-dialog">
      {error && (
        <div className="set-notice is-error">
          <TriangleAlert size={15} /> {error}
        </div>
      )}
      {commits === null && !error ? (
        <div className="set-loading">
          <div className="spinner" />
        </div>
      ) : commits && commits.length === 0 ? (
        <div className="empty">
          <History size={28} />
          <h3>{L.dialogs.history.noVersions}</h3>
          <p>{L.dialogs.history.noVersionsHint}</p>
        </div>
      ) : commits ? (
        <div className="hist-layout">
          <div
            className="hist-list"
            role="listbox"
            aria-label={L.dialogs.history.versions}
            onKeyDown={(e) => {
              // ↑ ↓ wählen die vorige/nächste Version.
              if (!(e.target as HTMLElement).matches('.hist-item') || !moveFocus(e, e.currentTarget, '.hist-item')) return;
              (document.activeElement as HTMLElement | null)?.click();
            }}
          >
            <button className={`hist-item${selected === CURRENT ? ' is-active' : ''}`} onClick={() => setSelected(CURRENT)}>
              <span className="hist-item-title">{L.dialogs.history.current}</span>
              <span className="hist-item-meta">{L.dialogs.history.currentHint}</span>
            </button>
            {commits.map((c) => {
              const d = describe(c, path);
              return (
                <button key={c.id} className={`hist-item${selected === c.id ? ' is-active' : ''}`} onClick={() => setSelected(c.id)} title={c.summary}>
                  <span className="hist-item-title">
                    {relativeTime(c.time)}
                    <span className="hist-item-what"> · {d.title}</span>
                  </span>
                  <span className="hist-item-meta">
                    {formatDateTime(c.time)} · {author(c)}
                  </span>
                  {d.detail && <span className="hist-item-detail truncate">{d.detail}</span>}
                </button>
              );
            })}
          </div>
          <div className="hist-main">
            <div className="hist-toolbar">
              {selected !== CURRENT ? (
                <>
                  <div className="tabs">
                    <button className={mode === 'diff' ? 'is-active' : ''} onClick={() => setMode('diff')}>
                      {L.dialogs.history.tabDiff}
                    </button>
                    <button className={mode === 'text' ? 'is-active' : ''} onClick={() => setMode('text')}>
                      {L.dialogs.history.tabText}
                    </button>
                  </div>
                  {mode === 'diff' && changed && (
                    <span className="hist-stats">
                      <span className="is-del">−{stats.removed}</span> <span className="is-add">+{stats.added}</span>
                    </span>
                  )}
                  <span className="spacer" />
                  <button className="btn btn-sm" disabled={!sel || restoring || !file || file.text === null || !changed} onClick={() => void restore()}>
                    <RotateCcw size={14} /> {restoring ? L.dialogs.history.restoring : L.dialogs.history.restore}
                  </button>
                </>
              ) : (
                <span className="hist-hint">{L.dialogs.history.pick}</span>
              )}
            </div>
            <div className="hist-body">
              {loadingFile && !file ? (
                <div className="set-loading">
                  <div className="spinner" />
                </div>
              ) : !file ? null : selected === CURRENT ? (
                <TextView text={file.current} />
              ) : file.text === null ? (
                <div className="hist-same">{L.dialogs.history.missing}</div>
              ) : mode === 'diff' ? (
                <>
                  {changed && (
                    <div className="hist-legend">
                    <span className="is-del">{L.dialogs.history.legendDel(sel ? formatDateTime(sel.time) : '')}</span>
                    <span className="is-add">{L.dialogs.history.legendAdd}</span>
                    </div>
                  )}
                  <DiffView lines={lines} />
                </>
              ) : (
                <TextView text={file.text} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
