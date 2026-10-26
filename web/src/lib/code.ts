// Codeblöcke: Zaun lesen/schreiben, Sprachen, Erkennung, Einrückung.

import type { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Node } from './types';

const FENCE = /^(`{3,}|~{3,})([^`\n]*)\n([\s\S]*?)\n?\1[ \t]*$/;

export interface CodeBlock {
  lang: string;
  code: string;
  fence: string;
}

/** Ist der Knoten ein reiner Codeblock (leerer Text, Notiz = ein Zaun)? */
export function isCodeNode(n: Node | undefined): boolean {
  return !!n && n.kind === 'item' && !n.text.trim() && !n.task && /^(```|~~~)/.test(n.body) && !!parseFence(n.body);
}

export function parseFence(body: string): CodeBlock | null {
  const m = FENCE.exec(body.replace(/\r\n/g, '\n').trim());
  if (!m) {
    // Noch nicht geschlossener Zaun (während des Tippens).
    const open = /^(`{3,}|~{3,})([^`\n]*)\n?([\s\S]*)$/.exec(body);
    if (!open) return null;
    return { fence: open[1], lang: open[2].trim(), code: open[3] };
  }
  return { fence: m[1], lang: m[2].trim(), code: m[3] };
}

export function formatFence(lang: string, code: string): string {
  // Enthält der Code selbst ```, braucht der Zaun mehr Backticks.
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${code.replace(/\n+$/, '')}\n${fence}`;
}

/** Häufige Sprachen zuerst (Bezeichnung, Kürzel im Zaun). */
export const COMMON: [string, string][] = [
  ['TypeScript', 'ts'],
  ['JavaScript', 'js'],
  ['TSX', 'tsx'],
  ['Rust', 'rust'],
  ['Python', 'python'],
  ['C', 'c'],
  ['C++', 'cpp'],
  ['C#', 'csharp'],
  ['Java', 'java'],
  ['Kotlin', 'kotlin'],
  ['Go', 'go'],
  ['SQL', 'sql'],
  ['Bash', 'bash'],
  ['PowerShell', 'powershell'],
  ['JSON', 'json'],
  ['YAML', 'yaml'],
  ['TOML', 'toml'],
  ['HTML', 'html'],
  ['CSS', 'css'],
  ['XML', 'xml'],
  ['Markdown', 'markdown'],
  ['Dockerfile', 'dockerfile'],
  ['PHP', 'php'],
  ['Ruby', 'ruby'],
  ['Swift', 'swift'],
  ['Lua', 'lua'],
];

export interface LangOption {
  label: string;
  id: string;
}

let all: LangOption[] | null = null;

/** Alle Sprachen (häufige zuerst). */
export function languageOptions(): LangOption[] {
  if (all) return all;
  const seen = new Set<string>();
  const out: LangOption[] = [];
  for (const [label, id] of COMMON) {
    out.push({ label, id });
    seen.add(label.toLowerCase());
  }
  for (const d of languages) {
    if (seen.has(d.name.toLowerCase())) continue;
    seen.add(d.name.toLowerCase());
    const id = (d.alias.find((a) => /^[a-z0-9+#-]+$/.test(a)) ?? d.name).toLowerCase().replace(/\s+/g, '-');
    out.push({ label: d.name, id });
  }
  all = out;
  return out;
}

const ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', sh: 'bash', shell: 'bash', zsh: 'bash', ps1: 'powershell', ps: 'powershell', yml: 'yaml', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', py: 'python', rs: 'rust', md: 'markdown', docker: 'dockerfile', kt: 'kotlin', golang: 'go' };

export function findLanguage(lang: string): LanguageDescription | null {
  const l = lang.trim().toLowerCase();
  if (!l) return null;
  const name = ALIASES[l] ?? l;
  return languages.find((d) => d.name.toLowerCase() === name || d.alias.includes(name) || d.alias.includes(l) || d.extensions.includes(l)) ?? null;
}

/** Anzeigename einer Sprache. */
export function languageLabel(lang: string): string {
  const c = COMMON.find(([, id]) => id === lang.toLowerCase());
  if (c) return c[0];
  return findLanguage(lang)?.name ?? lang;
}

/** Einrückungseinheit je Sprache. */
export function indentFor(lang: string, code = ''): string {
  // Vorhandene Einrückung des Codes hat Vorrang.
  const m = /^( +|\t)\S/m.exec(code);
  if (m) return m[1] === '\t' ? '\t' : m[1].length <= 2 ? '  ' : '    ';
  const l = (ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()) || '';
  if (l === 'go' || l === 'makefile') return '\t';
  if (['javascript', 'typescript', 'tsx', 'jsx', 'json', 'html', 'css', 'scss', 'yaml', 'xml', 'vue', 'ruby', 'lua', 'markdown', 'toml'].includes(l)) return '  ';
  return '    ';
}

/** Rät die Sprache eines Codeblocks (nur für die Anzeige und als Vorschlag). */
export function guessLanguage(code: string): string | null {
  const c = code.trim();
  if (!c) return null;
  if (/^[{[]/.test(c)) {
    try {
      JSON.parse(c);
      return 'json';
    } catch {
      /* kein JSON */
    }
  }
  if (/^<\?xml/i.test(c)) return 'xml';
  if (/^<(!doctype|html|head|body|div|span|p|a|ul|section|template)\b/i.test(c)) return 'html';
  if (/^#!\/(usr\/)?bin\/(env )?(ba|z)?sh/.test(c)) return 'bash';
  if (/^\s*#include\s*[<"]|\bstd::|\busing namespace\b|\btemplate\s*</m.test(c)) return 'cpp';
  if (/\bfn\s+\w+\s*[(<]|\blet\s+mut\b|\bimpl\b.*\{|\buse\s+[\w:]+::|\bpub\s+(fn|struct|enum)\b/.test(c)) return 'rust';
  if (/^\s*package\s+main\b|\bfunc\s+(\(\w+ \*?\w+\)\s*)?\w+\(/m.test(c)) return 'go';
  if (/\busing System\b|\bnamespace\s+[\w.]+\s*\{|\bpublic\s+(async\s+)?Task\b/.test(c)) return 'csharp';
  if (/\b(public|private|protected)\s+(static\s+)?(final\s+)?(class|void|int|String)\b/.test(c)) return 'java';
  if (/^\s*(def|class)\s+\w+.*:\s*$/m.test(c) || /^\s*(from\s+[\w.]+\s+)?import\s+\w+(\s+as\s+\w+)?\s*$/m.test(c) || /\bprint\(f?["']/.test(c)) return 'python';
  if (/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|VIEW)|ALTER\s+TABLE|WITH)\b/im.test(c)) return 'sql';
  if (/^\s*(Get|Set|New|Remove|Invoke|Write)-\w+|\$env:\w+/m.test(c)) return 'powershell';
  if (/:\s*(string|number|boolean|void)\b|\binterface\s+\w+\s*\{|\btype\s+\w+\s*=|\bas\s+const\b|<\w+>\(/.test(c)) return 'ts';
  if (/\b(const|let|var)\s+\w+\s*=|\bfunction\s*\w*\s*\(|=>|\bconsole\.log\(|\brequire\(|\bexport\s+(default\s+)?/.test(c)) return 'js';
  if (/^\s*\[[\w.-]+\]\s*$/m.test(c) && /^\s*[\w.-]+\s*=\s*\S/m.test(c)) return 'toml';
  if (/^\s*(\$\s+)?(sudo|apt|npm|cargo|git|cd|ls|echo|export|curl|docker)\b/m.test(c)) return 'bash';
  if (/^[\w.#:-][\w\s.#:>,-]*\{[^}]*:[^}]*;/m.test(c)) return 'css';
  if (/^\s*[\w-]+:\s+\S/m.test(c) && !/[;{}()]/.test(c)) return 'yaml';
  if (/\b(int|void|char|float|double|long|unsigned)\s+\*?\w+\s*\(|\bprintf\s*\(|\breturn\s+0\s*;/.test(c)) return 'cpp';
  return null;
}

/** Sieht eingefügter Text nach Code aus (statt nach einer Liste oder Prosa)? */
export function looksLikeCode(text: string): boolean {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;
  if (/^(```|~~~)/.test(text.trim())) return true;
  if (lines.every((l) => /^\s*([-*+]|\d+[.)])\s/.test(l))) return false;
  const codeish = lines.filter((l) => /[;{}()=<>[\]]\s*$|^\s{2,}\S|^\s*(\/\/|#|--|\/\*)/.test(l)).length;
  return codeish / lines.length >= 0.5 && guessLanguage(text) !== null;
}
