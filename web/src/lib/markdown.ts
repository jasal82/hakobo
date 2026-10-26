// Markdown der Notizen → sicheres HTML; Wiki-Links, Tags und
// Syntax-Hervorhebung von Codeblöcken werden danach im DOM ergänzt.

import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { linkKey, parseLinkInner } from './inline';

const md = new Marked({ gfm: true, breaks: true, async: false });

export function renderMarkdown(text: string): string {
  // Maskierte Aufzählungszeichen aus dem Dateiformat sind normale Listen.
  const html = md.parse(text) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cache = new Map<string, string | null>();

/** Hebt Code mit dem Lezer-Parser der Sprache hervor (`null`: Sprache unbekannt). */
export async function highlight(code: string, lang: string): Promise<string | null> {
  const key = `${lang}\u0000${code}`;
  if (cache.has(key)) return cache.get(key)!;
  const desc = LanguageDescription.matchLanguageName(languages, lang, true);
  if (!desc) {
    cache.set(key, null);
    return null;
  }
  const support = desc.support ?? (await desc.load());
  const tree = support.language.parser.parse(code);
  let html = '';
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      html += classes ? `<span class="${classes}">${esc(text)}</span>` : esc(text);
    },
    () => {
      html += '\n';
    },
  );
  if (cache.size > 500) cache.clear();
  cache.set(key, html);
  return html;
}

export interface Enhancer {
  /** Anzeigetext und Ziel eines Wiki-Links. */
  link: (key: string, alias: string | null, target: string) => { label: string; id: string | null; person: boolean };
}

const WIKI = /!?\[\[([^\[\]\n]+?)\]\]/g;
const TAG = /(^|[\s(,;"'])#([\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)/gu;

/** Ergänzt Wiki-Links, Tags und Code-Hervorhebung im gerenderten HTML. */
export function enhance(root: HTMLElement, e: Enhancer) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('code, pre, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    const s = t.data;
    if (!s.includes('[[') && !s.includes('#')) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    const re = new RegExp(`${WIKI.source}|${TAG.source}`, 'gu');
    let m: RegExpExecArray | null;
    let changed = false;
    while ((m = re.exec(s))) {
      if (m[1] !== undefined) {
        frag.append(s.slice(last, m.index));
        const p = parseLinkInner(m[1]);
        const r = e.link(linkKey(p), p.alias, p.target);
        const a = document.createElement('a');
        a.className = `wikilink${r.id ? '' : ' is-broken'}${r.person ? ' is-person' : ''}`;
        a.textContent = (r.person ? '@' : '') + r.label;
        if (r.id) a.dataset.id = r.id;
        frag.append(a);
        last = m.index + m[0].length;
        changed = true;
      } else if (m[3] !== undefined) {
        let tag = m[3];
        while (tag.endsWith('/') || tag.endsWith('-')) tag = tag.slice(0, -1);
        const start = m.index + m[2].length;
        frag.append(s.slice(last, start));
        const a = document.createElement('a');
        a.className = 'tag';
        a.dataset.tag = tag.toLowerCase();
        a.textContent = '#' + tag;
        frag.append(a);
        last = start + 1 + tag.length;
        changed = true;
      }
    }
    if (!changed) continue;
    frag.append(s.slice(last));
    t.replaceWith(frag);
  }
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/.test(href)) a.setAttribute('target', '_blank');
  });
  root.querySelectorAll('pre > code').forEach((code) => {
    const el = code as HTMLElement;
    const lang = /language-([\w+#.-]+)/.exec(el.className)?.[1];
    el.parentElement?.classList.add('md-code');
    if (lang) el.parentElement?.setAttribute('data-lang', lang);
    if (!lang || el.dataset.hl) return;
    el.dataset.hl = '1';
    const src = el.textContent ?? '';
    void highlight(src, lang).then((html) => {
      if (html !== null && el.isConnected && el.textContent === src) el.innerHTML = html;
    });
  });
}
