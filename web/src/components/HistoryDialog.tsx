// Versionen einer Seite: Liste der Commits, Änderungen gegenüber heute, Wiederherstellen.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronsUpDown, History, RotateCcw, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, relativeTime } from '../lib/dates';
import { store, useStore } from '../lib/store';
import type { CommitInfo } from '../lib/types';
import { Dialog } from './ui';
import { diffBlocks, diffLines, diffStats, type DiffLine } from './settings/diff';

const CURRENT = '__current__';

/** Kurzfassung einer Commit-Nachricht. */
function describe(c: CommitInfo, path: string): { title: string; detail?: string } {
  const s = c.summary.trim();
  const page = path.replace(/\.md$/, '');
  if (s.startsWith('Bearbeitet: ')) {
    const list = s.slice('Bearbeitet: '.length);
    const others = list
      .split(/,\s*/)
      .map((x) => x.trim())
      .filter((x) => x && x.toLowerCase() !== page.toLowerCase());
    const rest = others.length ? `zusammen mit ${others.join(', ')}` : undefined;
    return { title: 'Bearbeitet', detail: rest };
  }
  if (/^Synchronisiert/.test(s)) return { title: 'Von anderem Gerät übernommen', detail: s.replace(/^Synchronisiert\s*/, '').replace(/^\((.*)\)$/, '$1') || undefined };
  if (s.endsWith('(wiederhergestellt)')) return { title: 'Ältere Fassung wiederhergestellt' };
  return { title: s || 'Version' };
}

/** Gerät/Autor: „Sqizzo (RECHNER)“ → „RECHNER“. */
function author(c: CommitInfo): string {
  const m = /^Sqizzo \((.+)\)$/.exec(c.author);
  return m ? m[1] : c.author;
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  const blocks = useMemo(() => diffBlocks(lines), [lines]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => setOpen(new Set()), [lines]);
  const stats = diffStats(lines);
  if (!stats.added && !stats.removed) {
    return <div className="hist-same">Diese Version stimmt mit dem aktuellen Stand überein.</div>;
  }
  return (
    <div className="hist-diff" role="table">
      {blocks.map((b, bi) => {
        if (b.kind === 'skip' && !open.has(bi)) {
          return (
            <button key={bi} className="hist-skip" onClick={() => setOpen(new Set(open).add(bi))}>
              <ChevronsUpDown size={13} /> {b.lines.length} unveränderte {b.lines.length === 1 ? 'Zeile' : 'Zeilen'}
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
    if (!confirm(`Die Fassung vom ${formatDateTime(sel.time)} wiederherstellen? Der aktuelle Stand bleibt als Version erhalten.`)) return;
    setRestoring(true);
    try {
      await api.restore(id, sel.id);
      store().toast('Ältere Fassung wiederhergestellt', 'success');
      close();
    } catch (e) {
      setError((e as Error).message);
      setRestoring(false);
    }
  };

  const title = (
    <span className="hist-title">
      <History size={16} /> Versionen von „{page?.text ?? path.replace(/\.md$/, '')}“
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
          <h3>Noch keine Versionen</h3>
          <p>Versionen entstehen automatisch kurz nach dem Bearbeiten. Schau gleich noch einmal vorbei.</p>
        </div>
      ) : commits ? (
        <div className="hist-layout">
          <div className="hist-list" role="listbox" aria-label="Versionen">
            <button className={`hist-item${selected === CURRENT ? ' is-active' : ''}`} onClick={() => setSelected(CURRENT)}>
              <span className="hist-item-title">Aktueller Stand</span>
              <span className="hist-item-meta">so wie die Seite jetzt ist</span>
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
                      Änderungen bis heute
                    </button>
                    <button className={mode === 'text' ? 'is-active' : ''} onClick={() => setMode('text')}>
                      Inhalt damals
                    </button>
                  </div>
                  {mode === 'diff' && changed && (
                    <span className="hist-stats">
                      <span className="is-del">−{stats.removed}</span> <span className="is-add">+{stats.added}</span>
                    </span>
                  )}
                  <span className="spacer" />
                  <button className="btn btn-sm" disabled={!sel || restoring || !file || file.text === null || !changed} onClick={() => void restore()}>
                    <RotateCcw size={14} /> {restoring ? 'Stelle wieder her …' : 'Diese Version wiederherstellen'}
                  </button>
                </>
              ) : (
                <span className="hist-hint">Wähle links eine Version, um zu sehen, was sich seitdem geändert hat.</span>
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
                <div className="hist-same">In dieser Version gab es die Seite noch nicht (oder sie hieß anders).</div>
              ) : mode === 'diff' ? (
                <>
                  {changed && (
                    <div className="hist-legend">
                    <span className="is-del">− nur in der Version vom {sel ? formatDateTime(sel.time) : ''}</span>
                    <span className="is-add">+ seitdem hinzugekommen</span>
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
