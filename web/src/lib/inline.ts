// Inline-Syntax in Knotentexten: Tags, Links, Formatierung (wie src/vault/inline.rs).

/** `s`/`e`: Bereich im Originaltext (für die Cursorposition beim Klicken). */
export type Segment = { s: number; e: number } & (
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold' | 'italic' | 'strike' | 'mark'; children: Segment[] }
  | { t: 'tag'; tag: string; raw: string }
  | { t: 'link'; key: string; target: string; anchor: string | null; alias: string | null; embed: boolean; raw: string }
  | { t: 'url'; href: string; label: string }
);

const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;

function tagAt(text: string, i: number): { raw: string; tag: string } | null {
  if (text[i] !== '#') return null;
  const prev = i > 0 ? text[i - 1] : '';
  if (prev && !/[\s(,;"']/.test(prev)) return null;
  let j = i + 1;
  while (j < text.length && TAG_CHAR.test(text[j])) j++;
  let tag = text.slice(i + 1, j);
  while (tag.endsWith('/') || tag.endsWith('-')) tag = tag.slice(0, -1);
  if (!tag || /^[\d/_-]+$/.test(tag) || tag.startsWith('/')) return null;
  return { raw: '#' + tag, tag };
}

/** Tags eines Textes (klein, ohne Dubletten), Codeblöcke ausgenommen. */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  const stripped = stripCode(text);
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '[' && stripped[i + 1] === '[') {
      const close = stripped.indexOf(']]', i + 2);
      if (close > 0) {
        i = close + 1;
        continue;
      }
    }
    const t = tagAt(stripped, i);
    if (t) {
      const low = t.tag.toLowerCase();
      if (!out.includes(low)) out.push(low);
      i += t.raw.length - 1;
    }
  }
  return out;
}

/** Ersetzt Code (Blöcke und Inline) durch Leerzeichen gleicher Länge. */
export function stripCode(text: string): string {
  let s = text.replace(/^([ \t]*)(```|~~~)[\s\S]*?^\1\2[^\n]*$/gm, (m) => ' '.repeat(m.length));
  s = s.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length));
  return s;
}

export interface LinkParts {
  target: string;
  anchor: string | null;
  alias: string | null;
}

export function parseLinkInner(inner: string): LinkParts {
  let dest = inner;
  let alias: string | null = null;
  const bar = inner.indexOf('|');
  if (bar >= 0) {
    dest = inner.slice(0, bar);
    alias = inner.slice(bar + 1).trim();
  }
  const hash = dest.indexOf('#');
  if (hash >= 0) return { target: dest.slice(0, hash).trim(), anchor: dest.slice(hash + 1).trim(), alias };
  return { target: dest.trim(), anchor: null, alias };
}

export function linkKey(p: LinkParts): string {
  return p.anchor !== null ? `${p.target}#${p.anchor}` : p.target;
}

const URL_RE = /^https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/;
const MARKS = [
  ['**', 'bold'],
  ['__', 'bold'],
  ['~~', 'strike'],
  ['==', 'mark'],
] as const;
const MD_LINK_RE = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;

/** Zerlegt einen einzeiligen Text in darstellbare Segmente. */
export function tokenize(text: string, base = 0): Segment[] {
  const out: Segment[] = [];
  let buf = '';
  let bufStart = 0;
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf, s: base + bufStart, e: base + bufStart + buf.length });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const rest = text.slice(i);
    // Inline-Code
    if (c === '`') {
      const run = /^`+/.exec(rest)![0];
      const close = text.indexOf(run, i + run.length);
      if (close > 0) {
        flush();
        out.push({ t: 'code', v: text.slice(i + run.length, close), s: base + i, e: base + close + run.length });
        i = close + run.length;
        continue;
      }
    }
    // Wiki-Links
    if ((c === '[' && text[i + 1] === '[') || (c === '!' && text.startsWith('[[', i + 1))) {
      const embed = c === '!';
      const start = embed ? i + 1 : i;
      const close = text.indexOf(']]', start + 2);
      const inner = close > 0 ? text.slice(start + 2, close) : '';
      if (close > 0 && inner.trim() && !inner.includes('[[')) {
        flush();
        const p = parseLinkInner(inner);
        out.push({ t: 'link', key: linkKey(p), ...p, embed, raw: text.slice(i, close + 2), s: base + i, e: base + close + 2 });
        i = close + 2;
        continue;
      }
    }
    // Markdown-Links
    if (c === '[') {
      const m = MD_LINK_RE.exec(rest);
      if (m) {
        flush();
        out.push({ t: 'url', href: m[2], label: m[1], s: base + i, e: base + i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    // URLs
    if (c === 'h' && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      const m = URL_RE.exec(rest);
      if (m) {
        flush();
        out.push({ t: 'url', href: m[0], label: m[0].replace(/^https?:\/\/(www\.)?/, ''), s: base + i, e: base + i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    // Tags
    if (c === '#') {
      const t = tagAt(text, i);
      if (t) {
        flush();
        out.push({ t: 'tag', tag: t.tag, raw: t.raw, s: base + i, e: base + i + t.raw.length });
        i += t.raw.length;
        continue;
      }
    }
    // Hervorhebungen
    let matched = false;
    for (const [mark, kind] of MARKS) {
      if (rest.startsWith(mark)) {
        const close = text.indexOf(mark, i + 2);
        if (close > i + 2) {
          flush();
          out.push({ t: kind, children: tokenize(text.slice(i + 2, close), base + i + 2), s: base + i, e: base + close + 2 });
          i = close + 2;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;
    if ((c === '*' || c === '_') && text[i + 1] !== c && text[i + 1] !== ' ') {
      const prev = i > 0 ? text[i - 1] : ' ';
      if (c === '*' || /[\s(]/.test(prev)) {
        const close = text.indexOf(c, i + 1);
        if (close > i + 1 && text[close - 1] !== ' ' && (c === '*' || close + 1 >= text.length || /[\s).,;:!?]/.test(text[close + 1]))) {
          flush();
          out.push({ t: 'italic', children: tokenize(text.slice(i + 1, close), base + i + 1), s: base + i, e: base + close + 1 });
          i = close + 1;
          continue;
        }
      }
    }
    if (!buf) bufStart = i;
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Überschrift-Ebene (`# `, `## `, `### `) und Text ohne Präfix. */
export function headingLevel(text: string): [number, string] {
  const m = /^(#{1,3}) (.*)$/.exec(text);
  return m ? [m[1].length, m[2]] : [0, text];
}

/** Klartext (für Titel, Linktexte, Suche). */
export function plainText(text: string, withTags = true): string {
  const parts: string[] = [];
  const walk = (segs: Segment[]) => {
    for (const s of segs) {
      switch (s.t) {
        case 'text':
        case 'code':
          parts.push(s.v);
          break;
        case 'tag':
          if (withTags) parts.push(s.raw);
          break;
        case 'link':
          parts.push(s.alias || s.target || '');
          break;
        case 'url':
          parts.push(s.label);
          break;
        default:
          walk(s.children);
      }
    }
  };
  walk(tokenize(headingLevel(text)[1]));
  return parts.join('').replace(/\s+/g, ' ').trim();
}
