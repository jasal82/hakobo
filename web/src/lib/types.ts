// Datentypen der API (Spiegel der Rust-Strukturen).

export type Kind = 'root' | 'page' | 'item';
export type Task = 'open' | 'doing' | 'done' | 'cancelled';

export interface Field {
  key: string;
  value: string;
}

export interface LinkInfo {
  key: string;
  id: string | null;
}

export interface Node {
  id: string;
  kind: Kind;
  parent: string | null;
  children: string[];
  text: string;
  body: string;
  fields: Field[];
  task?: Task;
  tags: string[];
  links?: LinkInfo[];
  path?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'date' | 'select' | 'ref' | 'url' | 'email' | 'phone' | 'checkbox' | string;
  options?: string[];
  target?: string;
  multiple?: boolean;
}

export interface TypeDef {
  label: string;
  color?: string;
  icon?: string;
  page?: string;
  fields: FieldDef[];
}

export type Types = Record<string, TypeDef>;

export interface Snapshot {
  root: string;
  inbox: string;
  nodes: Node[];
  types: Types;
  typesError: string | null;
  version: number;
  vault: string;
  today: string;
}

export type Op =
  | { op: 'create'; id: string; parent: string; index?: number; text?: string; body?: string; fields?: Field[]; task?: Task | null; page?: boolean }
  | { op: 'update'; id: string; text?: string; body?: string; task?: Task | null; fields?: Field[] }
  | { op: 'move'; id: string; parent: string; index?: number }
  | { op: 'delete'; id: string }
  /** Nur über `commitRemote` (wird nicht lokal vorweggenommen). */
  | { op: 'toPage'; id: string };

export interface Patch {
  nodes: Node[];
  removed: string[];
}

export interface Snippet {
  text: string;
  ranges: [number, number][];
}

export interface Hit {
  id: string;
  score: number;
  titleRanges: [number, number][];
  pathRanges: [number, number, number][];
  snippet?: Snippet | null;
  matchedTags: string[];
}

export interface TagHit {
  tag: string;
  count: number;
  ranges: [number, number][];
}

export interface When {
  start: string;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
}

export interface AgendaEntry {
  id: string;
  when: When;
  value: string;
  human: string;
  kind: 'todo' | 'event';
  task?: Task;
  overdue: boolean;
  repeat?: string;
  text: string;
  page: string;
  pageId: string;
  tags: string[];
}

export interface Agenda {
  from: string;
  to: string;
  today: string;
  overdue: AgendaEntry[];
  entries: AgendaEntry[];
}

export interface CommandResult {
  kind: 'todo' | 'due' | 'date' | 'repeat' | 'remind';
  field: string;
  value: string;
  human: string;
  consumed: number;
  date?: string;
}

export interface ParseResult {
  value: string;
  human: string;
  consumed: number;
  complete: boolean;
}

export interface SyncStatus {
  remote: string | null;
  enabled: boolean;
  running: boolean;
  gitCli: boolean;
  lastSync: number | null;
  lastError: string | null;
  lastCommit: number | null;
  pending: number;
  resolved: string[];
}

export interface Settings {
  vault: string | null;
  hotkey: string;
  closeToTray: boolean;
  autostart: boolean;
  commitDelaySecs: number;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  eventReminderMinutes: number | null;
  allDayReminders: boolean;
  allDayTime: string;
  theme: 'system' | 'light' | 'dark';
  uiScale: number;
}

export interface CommitInfo {
  id: string;
  short: string;
  summary: string;
  author: string;
  time: number;
}

export type ServerEvent =
  | { type: 'patch'; origin: string | null; nodes: Node[]; removed: string[] }
  | { type: 'reload' }
  | { type: 'types' }
  | { type: 'sync'; status: SyncStatus }
  | { type: 'navigate'; id: string }
  | { type: 'settings' };
