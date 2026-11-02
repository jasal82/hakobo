// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Bilder (wie in Workflowy): liegen im Ordner `assets/` des Notizbuchs und hängen als
// Markdown in der Notiz eines Eintrags: `![Name](/assets/bild.png)`, mit Breite
// `![Name|320](/assets/bild.png)` (wie in Obsidian).

import { api } from './api';
import { createOp, store } from './store';
import type { Op } from './types';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/** Adresse zum Anzeigen eines Bildpfads aus dem Notizbuch (`/assets/…`, `assets/…`, `../assets/…`); sonst `null`. */
export function fileUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = /^(?:\.\.\/)*\/?(assets\/.+)$/.exec(href.trim());
  if (!m) return null;
  return `/api/files/${m[1]
    .split('/')
    .map((s) => encodeURIComponent(decodeSafe(s)))
    .join('/')}`;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Pfad im Notizbuch (`assets/…`) zu einem Bildpfad aus Markdown. */
export function vaultPath(href: string): string | null {
  const m = /^(?:\.\.\/)*\/?(assets\/.+)$/.exec(href.trim());
  return m ? decodeSafe(m[1]) : null;
}

/** `Name|320` → Name und Breite. */
export function splitAlt(alt: string): { alt: string; width: number | null } {
  const m = /^(.*?)\|\s*(\d+)(?:x\d+)?\s*$/.exec(alt);
  return m ? { alt: m[1].trim(), width: Number(m[2]) || null } : { alt, width: null };
}

export function imageMarkdown(alt: string, path: string): string {
  return `![${alt.replace(/[[\]|]/g, ' ').trim()}](${path})`;
}

// ---------------------------------------------------------------------------
// Dateien aus Zwischenablage und Ziehen
// ---------------------------------------------------------------------------

/** Wird eine Datei von außen (Explorer, Browser) gezogen? */
export function hasFiles(dt: DataTransfer | null | undefined): boolean {
  return !!dt && [...dt.types].includes('Files');
}

export function imageFiles(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const out = [...dt.files].filter((f) => f.type.startsWith('image/') || IMAGE.test(f.name));
  // Manche Quellen liefern das Bild nur als Eintrag (z. B. kopierte Bilder aus dem Browser).
  if (!out.length) for (const it of dt.items ?? []) if (it.kind === 'file' && it.type.startsWith('image/')) {
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  return out;
}

/** Bilder in der Zwischenablage – nur ohne Text (Excel legt z. B. zusätzlich ein Bild der Zellen ab). */
export function pastedImages(dt: DataTransfer | null | undefined): File[] {
  if (!dt || dt.getData('text/plain').trim()) return [];
  return imageFiles(dt);
}

/** Name für ein Bild: der Dateiname, bei Bildschirmfotos aus der Zwischenablage Datum und Uhrzeit. */
function nameOf(f: File): string {
  const stem = f.name.replace(/\.[^.]+$/, '').trim();
  if (stem && !/^(image|bild|unbenannt|untitled|clipboard)$/i.test(stem)) return f.name;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ext = (/\/(\w+)/.exec(f.type)?.[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  return `Bild ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
}

/** Lädt die Bilder hoch; liefert Markdown und Anzeigenamen der gespeicherten. */
async function upload(files: File[]): Promise<{ alt: string; md: string }[]> {
  const out: { alt: string; md: string }[] = [];
  for (const f of files) {
    const name = nameOf(f);
    try {
      const { path } = await api.uploadFile(f, name);
      const alt = name.replace(/\.[^.]+$/, '');
      out.push({ alt, md: imageMarkdown(alt, path) });
    } catch (e) {
      store().toast(`${name}: ${(e as Error).message}`, 'error');
    }
  }
  return out;
}

/** Bilder an einen Eintrag hängen (an seine Notiz). Ein leerer Titel bekommt den Bildnamen. */
export async function attachImages(id: string, files: File[]) {
  const saved = await upload(files);
  const s = store();
  const n = s.nodes[id];
  if (!saved.length || !n) return;
  const body = [n.body.trimEnd(), ...saved.map((x) => x.md)].filter(Boolean).join('\n\n');
  const op: Op = { op: 'update', id, body };
  if (!n.text.trim() && n.kind === 'item') op.text = saved[0].alt;
  s.flushPending();
  s.commit([op], { focusAfter: null });
}

/** Je Bild ein neuer Eintrag (Titel = Bildname, Bild in der Notiz) unter `parent` an Position `index`. */
export async function insertImageNodes(parent: string, index: number | undefined, files: File[]) {
  const saved = await upload(files);
  if (!saved.length) return;
  const ops = saved.map((x, i) => createOp(parent, index === undefined ? undefined : index + i, x.alt, { body: x.md }));
  store().commit(ops, { focusAfter: null });
  return ops.map((o) => o.id);
}

/** Bilder dort einfügen, wo sie nicht an einem Eintrag hängen: in die Inbox, mit Meldung. */
export async function imagesToInbox(files: File[]) {
  const s = store();
  const ids = await insertImageNodes(s.inbox, undefined, files);
  if (ids?.length) s.toast(`${ids.length === 1 ? 'Bild' : `${ids.length} Bilder`} in der Inbox`, 'success', { label: 'Öffnen', run: () => store().reveal(ids[0]) });
}

/** Markdown der Bilder zum Einfügen in eine Notiz (nach dem Hochladen). */
export async function imagesAsMarkdown(files: File[]): Promise<string> {
  return (await upload(files)).map((x) => x.md).join('\n\n');
}

// ---------------------------------------------------------------------------
// Breite
// ---------------------------------------------------------------------------

/** Bilder im Markdown einer Notiz (nicht in Codeblöcken), mit Position. */
function imagesIn(body: string): { start: number; end: number; alt: string; href: string; rest: string }[] {
  const out: { start: number; end: number; alt: string; href: string; rest: string }[] = [];
  const re = /!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\s*\)/g;
  // Codeblöcke und Inline-Code überspringen (dort zeigt die Vorschau keine Bilder).
  const skip: [number, number][] = [];
  for (const m of body.matchAll(/^(```|~~~)[\s\S]*?^\1/gm)) skip.push([m.index!, m.index! + m[0].length]);
  for (const m of body.matchAll(/`[^`\n]+`/g)) skip.push([m.index!, m.index! + m[0].length]);
  for (const m of body.matchAll(re)) {
    const i = m.index!;
    if (skip.some(([a, b]) => i >= a && i < b)) continue;
    out.push({ start: i, end: i + m[0].length, alt: m[1], href: m[2], rest: m[3] });
  }
  return out;
}

/** Breite des `k`-ten Bilds mit Pfad `href` in der Notiz von `id` setzen (`null`: automatisch). */
export function setImageWidth(id: string, href: string, k: number, width: number | null) {
  const s = store();
  const n = s.nodes[id];
  if (!n) return;
  const hit = imagesIn(n.body).filter((x) => x.href === href)[k];
  if (!hit) return;
  const { alt } = splitAlt(hit.alt);
  const md = `![${alt}${width ? `|${Math.round(width)}` : ''}](${hit.href}${hit.rest})`;
  const body = n.body.slice(0, hit.start) + md + n.body.slice(hit.end);
  if (body === n.body) return;
  s.flushPending();
  s.commit([{ op: 'update', id, body }], { focusAfter: null });
}
