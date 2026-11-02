// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Seitenleiste: Inbox, Agenda, Seitenbaum, Tag-Baum, Typen, Sync-Status.

import { memo, useMemo, useState, type KeyboardEvent } from 'react';
import { CalendarDays, CalendarRange, ChevronRight, Cloud, CloudOff, FileText, Hash, Inbox, ListTodo, Notebook, Plus, RefreshCw, Search, Settings, Table2 } from 'lucide-react';
import { api } from '../lib/api';
import { relativeTime } from '../lib/dates';
import { createSubpage } from '../lib/outline';
import { store, useStore } from '../lib/store';
import type { Node } from '../lib/types';
import { pendingVersion, useUpdate } from '../lib/update';
import { openUpdates } from './UpdateProgress';
import { moveFocus, RouteLink } from './ui';
import { calendarRoute } from '../views/parts/calendar';
import { endDrag, startDrag, useIntoTarget } from '../lib/drag';
import { compareText, L } from '../i18n';

/** Elemente der Seitenleiste, zwischen denen ↑ und ↓ wechseln. */
const NAV = '[data-nav]';

/**
 * → und ← in Baum und Abschnitten: aufklappen bzw. zum ersten Kind,
 * zuklappen bzw. zum übergeordneten Eintrag.
 */
function treeKeys(e: KeyboardEvent<HTMLElement>, expandable: boolean, open: boolean, setOpen: (v: boolean) => void) {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  const el = e.currentTarget;
  const list = [...(el.closest('.sidebar')?.querySelectorAll<HTMLElement>(NAV) ?? [])];
  const i = list.indexOf(el);
  const depth = Number(el.dataset.depth ?? -1);
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (expandable && !open) setOpen(true);
    else if (expandable && Number(list[i + 1]?.dataset.depth) > depth) list[i + 1].focus();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (expandable && open) setOpen(false);
    else {
      for (let j = i - 1; j >= 0; j--) {
        const d = list[j].dataset.depth;
        if (d === undefined) break;
        if (Number(d) < depth) {
          list[j].focus();
          break;
        }
      }
    }
  }
}

function useInboxCount(): number {
  return useStore((s) => s.nodes[s.inbox]?.children.length ?? 0);
}

const PageTree = memo(function PageTree({ parent, depth }: { parent: string; depth: number }) {
  const ids = useStore((s) => s.nodes[parent]?.children);
  const pages = useStore((s) => (ids ?? []).filter((c) => s.nodes[c]?.kind === 'page' && c !== s.inbox).join(','));
  if (!pages) return null;
  return (
    <div className="tree">
      {pages.split(',').map((id) => (
        <PageItem key={id} id={id} depth={depth} />
      ))}
    </div>
  );
});

function PageItem({ id, depth }: { id: string; depth: number }) {
  const node = useStore((s) => s.nodes[id]);
  const active = useStore((s) => s.route.view === 'node' && s.route.id === id);
  const hasSub = useStore((s) => s.nodes[id]?.children.some((c) => s.nodes[c]?.kind === 'page'));
  const [open, setOpen] = useState(() => localStorage.getItem(`hakobo-tree-${id}`) === '1');
  const setOpenSaved = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(`hakobo-tree-${id}`, v ? '1' : '0');
    } catch {
      /* egal */
    }
  };
  // Ablegen: Seiten werden Unterseiten, Einträge landen am Ende der Seite.
  const drop = useIntoTarget(id, () => hasSub && setOpenSaved(true));
  if (!node) return null;
  return (
    <>
      <div className={`nav-item tree-item${active ? ' is-active' : ''}${drop.over ? ' is-drop' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} {...drop.props}>
        <button className={`tree-fold${hasSub ? '' : ' is-hidden'}${open ? ' is-open' : ''}`} onClick={() => setOpenSaved(!open)} tabIndex={-1} aria-hidden="true">
          <ChevronRight size={12} />
        </button>
        <RouteLink
          route={{ view: 'node', id }}
          className="nav-link"
          data-nav=""
          data-depth={depth}
          aria-expanded={hasSub ? open : undefined}
          aria-current={active ? 'page' : undefined}
          onKeyDown={(e) => treeKeys(e, !!hasSub, open, setOpenSaved)}
          draggable
          onDragStart={(e) => startDrag(e, [id])}
          onDragEnd={endDrag}
        >
          <FileText size={14} />
          <span className="truncate">{node.text}</span>
        </RouteLink>
        {/* Per Tastatur: „Unterseite“ in der Seite selbst oder im Aktionsmenü. */}
        <button className="nav-add" title={L.app.sidebar.newSubpage} aria-label={L.app.sidebar.newSubpage} tabIndex={-1} onClick={() => createSubpage(id)}>
          <Plus size={13} />
        </button>
      </div>
      {open && hasSub && <PageTree parent={id} depth={depth + 1} />}
    </>
  );
}

interface TagNode {
  name: string;
  full: string;
  count: number;
  children: TagNode[];
}

function buildTagTree(nodes: Record<string, Node>): TagNode[] {
  const counts = new Map<string, number>();
  for (const n of Object.values(nodes)) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const root: TagNode = { name: '', full: '', count: 0, children: [] };
  for (const [tag, count] of [...counts].sort((a, b) => compareText(a[0], b[0]))) {
    let cur = root;
    const parts = tag.split('/');
    parts.forEach((p, i) => {
      const full = parts.slice(0, i + 1).join('/');
      let next = cur.children.find((c) => c.name === p);
      if (!next) {
        next = { name: p, full, count: 0, children: [] };
        cur.children.push(next);
      }
      if (i === parts.length - 1) next.count += count;
      cur = next;
    });
  }
  return root.children;
}

function TagTree({ tags, depth }: { tags: TagNode[]; depth: number }) {
  return (
    <>
      {tags.map((t) => (
        <TagItem key={t.full} t={t} depth={depth} />
      ))}
    </>
  );
}

function TagItem({ t, depth }: { t: TagNode; depth: number }) {
  const active = useStore((s) => s.route.view === 'tag' && s.route.tag === t.full);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`nav-item tree-item${active ? ' is-active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        <button className={`tree-fold${t.children.length ? '' : ' is-hidden'}${open ? ' is-open' : ''}`} onClick={() => setOpen(!open)} tabIndex={-1} aria-hidden="true">
          <ChevronRight size={12} />
        </button>
        <RouteLink
          route={{ view: 'tag', tag: t.full }}
          className="nav-link"
          data-nav=""
          data-depth={depth}
          aria-expanded={t.children.length ? open : undefined}
          aria-current={active ? 'page' : undefined}
          onKeyDown={(e) => treeKeys(e, t.children.length > 0, open, setOpen)}
        >
          <Hash size={13} />
          <span className="truncate">{t.name}</span>
        </RouteLink>
        {t.count > 0 && <span className="nav-count">{t.count}</span>}
      </div>
      {open && <TagTree tags={t.children} depth={depth + 1} />}
    </>
  );
}

/** `dropInto`: Knoten, unter den Abgelegtes kommt (z. B. die Wurzel für „Seiten“). */
function Section({ title, children, action, id, dropInto = '' }: { title: string; children: React.ReactNode; action?: React.ReactNode; id: string; dropInto?: string }) {
  const [open, setOpen] = useState(() => localStorage.getItem(`hakobo-sec-${id}`) !== '0');
  const setOpenSaved = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(`hakobo-sec-${id}`, v ? '1' : '0');
    } catch {
      /* egal */
    }
  };
  const drop = useIntoTarget(dropInto);
  return (
    <section className="nav-section">
      <div className={`nav-section-head${drop.over ? ' is-drop' : ''}`} {...(dropInto ? drop.props : {})}>
        <button data-nav="" data-depth={-1} aria-expanded={open} onClick={() => setOpenSaved(!open)} onKeyDown={(e) => treeKeys(e, true, open, setOpenSaved)}>
          <ChevronRight size={12} className={open ? 'is-open' : ''} />
          {title}
        </button>
        {action}
      </div>
      {open && children}
    </section>
  );
}

/** Zahnrad; mit Punkt und direkt zu den Updates, wenn es eine neue Version gibt. */
function SettingsButton() {
  const pending = useUpdate(pendingVersion);
  return (
    <button
      className={`btn btn-ghost btn-icon btn-sm${pending ? ' has-dot' : ''}`}
      onClick={() => (pending ? openUpdates() : store().set({ settingsOpen: true }))}
      title={pending ? L.app.sidebar.updateAvailable(pending) : L.app.sidebar.settings}
    >
      <Settings size={15} />
    </button>
  );
}

function SyncStatusLine() {
  const sync = useStore((s) => s.sync);
  const [, tick] = useState(0);
  if (!sync) return null;
  const t = L.app.sidebar;
  const label = sync.running ? t.syncing : sync.remote ? (sync.lastError ? t.syncError : t.synced(relativeTime(sync.lastSync))) : t.localVersion(relativeTime(sync.lastCommit));
  return (
    <button
      className={`sync-line${sync.lastError ? ' is-error' : ''}`}
      title={sync.lastError ?? sync.remote ?? t.localOnly}
      onClick={() => {
        if (sync.remote) {
          tick((x) => x + 1);
          void api.syncNow();
        } else store().set({ settingsOpen: true });
      }}
    >
      {sync.running ? <RefreshCw size={13} className="spin" /> : sync.remote ? <Cloud size={13} /> : <CloudOff size={13} />}
      <span className="truncate">{label}</span>
      {sync.pending > 0 && <span className="nav-count" title={t.pending}>{sync.pending}</span>}
    </button>
  );
}

export function Sidebar() {
  const route = useStore((s) => s.route);
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const types = useStore((s) => s.types);
  const nodes = useStore((s) => s.nodes);
  const inboxCount = useInboxCount();
  // Ablegen auf „Inbox“ (Einträge) und „Notizbuch“ (Seiten in die oberste Ebene)
  const inboxDrop = useIntoTarget(inbox);
  const rootDrop = useIntoTarget(root);
  const tagTree = useMemo(() => buildTagTree(nodes), [nodes]);
  const openTodos = useMemo(() => Object.values(nodes).filter((n) => n.kind === 'item' && (n.task === 'open' || n.task === 'doing')).length, [nodes]);
  const todayCount = useMemo(() => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let c = 0;
    for (const n of Object.values(nodes)) {
      const d = n.fields.find((f) => f.key === 'date' || f.key === 'due')?.value;
      if (!d || n.task === 'done' || n.task === 'cancelled') continue;
      if (d.slice(0, 10) === iso || (n.task && d.slice(0, 10) < iso)) c++;
    }
    return c;
  }, [nodes]);
  const is = (v: string) => route.view === v;
  const t = L.app.sidebar;
  const mainLink = (active: boolean) => ({ className: `nav-item nav-link${active ? ' is-active' : ''}`, 'data-nav': '', 'aria-current': active ? ('page' as const) : undefined });
  return (
    <aside
      className="sidebar"
      aria-label={t.label}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).matches(NAV)) moveFocus(e, e.currentTarget, NAV);
      }}
    >
      <button className="nav-search" data-nav="" onClick={() => store().set({ searchOpen: true })}>
        <Search size={14} />
        <span>{L.common.search}</span>
        <kbd>{t.searchKey}</kbd>
      </button>
      <nav className="nav-main">
        <RouteLink route={{ view: 'inbox' }} {...mainLink(is('inbox'))} className={`${mainLink(is('inbox')).className}${inboxDrop.over ? ' is-drop' : ''}`} title={t.inboxTitle} {...inboxDrop.props}>
          <Inbox size={15} />
          <span>{L.common.inbox}</span>
          {inboxCount > 0 && <span className="nav-count is-strong">{inboxCount}</span>}
        </RouteLink>
        <RouteLink route={{ view: 'agenda' }} {...mainLink(is('agenda'))} title={t.agendaTitle}>
          <CalendarDays size={15} />
          <span>{L.common.agenda}</span>
          {todayCount > 0 && <span className="nav-count">{todayCount}</span>}
        </RouteLink>
        <RouteLink route={{ view: 'todos' }} {...mainLink(is('todos'))} title={t.todosTitle}>
          <ListTodo size={15} />
          <span>{L.common.todos}</span>
          {openTodos > 0 && <span className="nav-count">{openTodos}</span>}
        </RouteLink>
        <RouteLink route={calendarRoute()} {...mainLink(is('week') || is('month'))} title={t.calendarTitle}>
          <CalendarRange size={15} />
          <span>{L.common.calendar}</span>
        </RouteLink>
        <RouteLink
          route={{ view: 'node', id: root }}
          {...mainLink(route.view === 'node' && route.id === root)}
          className={`${mainLink(route.view === 'node' && route.id === root).className}${rootDrop.over ? ' is-drop' : ''}`}
          title={t.notebookTitle}
          {...rootDrop.props}
        >
          <Notebook size={15} />
          <span>{t.notebook}</span>
        </RouteLink>
      </nav>
      <div className="nav-scroll">
        <Section
          id="pages"
          title={t.pages}
          dropInto={root}
          action={
            <button className="nav-add is-visible" title={t.newPage} aria-label={t.newPage} onClick={() => createSubpage(root)}>
              <Plus size={13} />
            </button>
          }
        >
          <PageTree parent={root} depth={0} />
        </Section>
        {Object.keys(types).length > 0 && (
          <Section id="types" title={t.types}>
            {Object.entries(types).map(([key, t]) => (
              <RouteLink key={key} route={{ view: 'type', type: key }} {...mainLink(route.view === 'type' && route.type === key)} data-depth={0}>
                <span className="type-dot" style={{ ['--type-color' as string]: `var(--t-${t.color ?? 'gray'})` }} />
                <span className="truncate">{t.label}</span>
                <Table2 size={13} className="nav-trailing" />
              </RouteLink>
            ))}
          </Section>
        )}
        {tagTree.length > 0 && (
          <Section id="tags" title={t.tags}>
            <TagTree tags={tagTree} depth={0} />
          </Section>
        )}
      </div>
      <div className="nav-footer">
        <SyncStatusLine />
        <SettingsButton />
      </div>
    </aside>
  );
}
