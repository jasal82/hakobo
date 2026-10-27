// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Sammelt die Lizenztexte aller Bestandteile Dritter, die im Programm landen
// (Rust-Crates, npm-Pakete der Oberfläche samt Schriften und Icons), in einer
// Datei für Binärpakete. Die Datei liegt in jedem Paket neben dem Programm;
// daran erkennt das Selbst-Update auch, dass Hakobo aus einem Paket stammt.
//
// Aufruf: node scripts/third-party-licenses.mjs [Ausgabedatei]   (Standard: dist/THIRD-PARTY-LICENSES.txt)

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCT = 'Hakobo';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.argv[2] ?? 'dist/THIRD-PARTY-LICENSES.txt');
const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._].*)?$/i;

/** Lizenztexte im Paketordner (nur oberste Ebene). */
function licenseTexts(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile());
  } catch {
    return [];
  }
  return names.sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim());
}

function rustPackages() {
  const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
  const meta = JSON.parse(
    execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', host], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    }),
  );
  // Alles, was von hakobo über normale Abhängigkeiten erreichbar ist (ohne Build-
  // und Dev-Abhängigkeiten, die nicht im Programm landen).
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const own = meta.packages.find((p) => p.name === 'hakobo');
  const reachable = new Set();
  const visit = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null)) visit(dep.pkg);
    }
  };
  visit(own.id);
  return meta.packages
    .filter((p) => reachable.has(p.id) && p.id !== own.id)
    .map((p) => ({
      name: `${p.name} ${p.version}`,
      license: p.license ?? 'siehe Lizenzdatei',
      url: p.repository ?? '',
      texts: licenseTexts(path.dirname(p.manifest_path)),
    }));
}

function npmPackages() {
  // Produktionsabhängigkeiten der Oberfläche (Workspace web).
  const dirs = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
    .trim()
    .split(/\r?\n/)
    // Das eigene Workspace-Paket ist unter node_modules nur verlinkt.
    .filter((dir) => fs.realpathSync(dir).split(/[\\/]/).includes('node_modules'));
  const seen = new Map();
  for (const dir of dirs) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const name = `${pkg.name} ${pkg.version}`;
    if (seen.has(name)) continue;
    const license =
      typeof pkg.license === 'string' ? pkg.license : (pkg.licenses ?? []).map((l) => l.type ?? l).join(' OR ') || 'siehe Lizenzdatei';
    const repo = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
    seen.set(name, { name, license, url: repo, texts: licenseTexts(dir) });
  }
  return [...seen.values()];
}

/** Gruppiert Pakete mit identischem Lizenztext, damit jeder Text nur einmal erscheint. */
function render(title, packages) {
  const groups = new Map();
  const withoutText = [];
  for (const p of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    if (p.texts.length === 0) {
      withoutText.push(p);
      continue;
    }
    // Unterschiede in Zeilenumbrüchen und Einrückung zählen nicht.
    for (const text of p.texts) {
      const key = text.replace(/\s+/g, ' ');
      if (!groups.has(key)) groups.set(key, { text, list: [] });
      groups.get(key).list.push(p);
    }
  }
  const rule = '='.repeat(80);
  const line = (p) => `${p.name} – ${p.license}${p.url ? ` – ${p.url}` : ''}`;
  let out = `\n${rule}\n${title} (${packages.length})\n${rule}\n`;
  for (const { text, list } of groups.values()) {
    out += `\n${'-'.repeat(80)}\n${list.map(line).join('\n')}\n${'-'.repeat(80)}\n\n${text}\n`;
  }
  if (withoutText.length) {
    out += `\n${'-'.repeat(80)}\nOhne eigene Lizenzdatei im Paket (Lizenz laut Paketangabe; Standardtexte unter https://spdx.org/licenses/):\n${'-'.repeat(80)}\n`;
    out += withoutText.map(line).join('\n') + '\n';
  }
  return out;
}

const rust = rustPackages();
const npm = npmPackages();

let text = `${PRODUCT} – Lizenzen von Drittanbieter-Komponenten
${'='.repeat(PRODUCT.length + 41)}

${PRODUCT} steht unter der GNU Affero General Public License, Version 3 oder später
(siehe LICENSE.txt). Das Programm enthält die folgenden Komponenten Dritter, die
jeweils unter ihren eigenen Lizenzen stehen. Die Schriften der Oberfläche (Inter,
JetBrains Mono) sind bei ihren Paketen @fontsource-variable/inter und
@fontsource/jetbrains-mono aufgeführt, die Icons beim Paket lucide-react.
`;
text += render('Rust-Bibliotheken (Programm, Server, Git, Fenster)', rust);
text += render('JavaScript-Bibliotheken (Oberfläche)', npm);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, text);
console.log(`${path.relative(root, output)}: ${rust.length} Rust-Pakete, ${npm.length} npm-Pakete, ${(text.length / 1024).toFixed(0)} KB`);
