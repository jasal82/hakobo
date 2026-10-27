import type { Agenda, CommandResult, CommitInfo, Field, Hit, Node, Op, ParseResult, Patch, Settings, Snapshot, SyncStatus, TagHit, Task, Types, UpdateStatus } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', signal };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = res.statusText || `Fehler ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new ApiError(msg, res.status);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

const get = <T>(url: string, signal?: AbortSignal) => request<T>('GET', url, undefined, signal);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
const put = <T>(url: string, body?: unknown) => request<T>('PUT', url, body);

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export interface CapturePreview {
  text: string;
  body: string;
  task: Task | null;
  fields: Field[];
  summary: string[];
}

export interface Info {
  version: string;
  vault: string;
  host: string;
  local: boolean;
  desktop: boolean;
  gitCli: boolean;
}

export const api = {
  info: () => get<Info>('/api/info'),
  snapshot: () => get<Snapshot>('/api/vault'),
  ops: (client: string, ops: Op[]) => post<Patch>('/api/ops', { client, ops }),
  capturePreview: (text: string, signal?: AbortSignal) => get<CapturePreview>(`/api/capture/preview${q({ text })}`, signal),
  capture: (text: string, parent?: string | null) => post<{ id: string; summary: string[]; node: Node | null }>('/api/capture', { text, parent }),
  search: (query: string, limit = 50, signal?: AbortSignal) => get<{ hits: Hit[] }>(`/api/search${q({ q: query, limit })}`, signal),
  tags: (query: string, limit = 30, signal?: AbortSignal) => get<TagHit[]>(`/api/tags${q({ q: query, limit })}`, signal),
  agenda: (from?: string, to?: string) => get<Agenda>(`/api/agenda${q({ from, to })}`),
  parseCommand: (text: string, signal?: AbortSignal) => get<CommandResult | null>(`/api/parse${q({ kind: 'command', q: text })}`, signal),
  parse: (kind: 'date' | 'repeat' | 'remind', text: string, signal?: AbortSignal) => get<ParseResult | null>(`/api/parse${q({ kind, q: text })}`, signal),
  link: (id: string) => post<{ link: string }>('/api/link', { id }),
  types: () => get<{ types: Types; error: string | null }>('/api/types'),
  saveTypes: (types: Types) => put<{ types: Types; error: string | null }>('/api/types', { types }),
  settings: () => get<{ settings: Settings; vault: string; defaultVault: string }>('/api/settings'),
  saveSettings: (s: Settings) => put<{ settings: Settings; restartRequired: boolean; warnings: string[] }>('/api/settings', s),
  sync: () => get<SyncStatus>('/api/sync'),
  syncNow: () => post<SyncStatus>('/api/sync'),
  setRemote: (url: string | null) => put<SyncStatus>('/api/sync/remote', { url }),
  history: (id: string) => get<{ path: string; commits: CommitInfo[]; pending: number }>(`/api/history${q({ id })}`),
  historyFile: (id: string, rev: string) => get<{ path: string; text: string | null; current: string }>(`/api/history/file${q({ id, rev })}`),
  restore: (id: string, rev: string) => post<{ ok: boolean }>('/api/history/restore', { id, rev }),
  focus: () => post('/api/system/focus'),
  showCapture: () => post('/api/system/capture'),
  hideCapture: () => post('/api/system/capture/hide'),
  openFolder: () => post('/api/system/open-folder'),
  openUrl: (url: string) => post('/api/system/open-url', { url }),
  quit: () => post('/api/system/quit'),
  update: {
    status: () => get<UpdateStatus>('/api/update'),
    check: () => post<UpdateStatus>('/api/update/check'),
    install: () => post<UpdateStatus>('/api/update/install'),
  },
};
