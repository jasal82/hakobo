// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Prüft ein fertig gebautes Hakobo-Programm von außen:
//   1. `hakobo add` schreibt ohne laufende App direkt ins Notizbuch und legt eine Version an.
//   2. `hakobo serve` liefert Oberfläche und API aus, verlangt das Zugangstoken, findet den
//      Eintrag und bietet im Server-Modus keine Updates an.
//
// Aufruf: node scripts/smoke-test.mjs <Pfad zum Programm>

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(binary)) {
  console.error('Aufruf: node scripts/smoke-test.mjs <Pfad zum Programm>');
  process.exit(2);
}
const version = spawnSync(process.execPath, [path.join(root, 'scripts/version.mjs')], { encoding: 'utf8' }).stdout.trim();

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hakobo-smoke-'));
const vault = path.join(work, 'vault');
// CI=1: unter Windows schreibt das GUI-Programm dann in die umgeleitete Ausgabe.
const env = { ...process.env, CI: '1', HAKOBO_VAULT: vault, HAKOBO_CONFIG_DIR: path.join(work, 'config'), RUST_LOG: 'warn' };
const TEXT = 'Rauchtest-Eintrag';

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function testAdd() {
  console.log(`hakobo add (${path.basename(binary)} ${version})`);
  const run = spawnSync(binary, ['add', `${TEXT} /morgen 14 uhr #rauchtest`], { env, encoding: 'utf8', timeout: 120_000 });
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr, run.error ?? '');
    throw new Error(`hakobo add endete mit ${run.status ?? run.signal}`);
  }
  check(run.stdout.includes(TEXT), 'Eintrag bestätigt');
  const inbox = fs.readFileSync(path.join(vault, 'Inbox.md'), 'utf8');
  check(inbox.includes(TEXT) && inbox.includes('#rauchtest'), 'Eintrag in Inbox.md');
  check(fs.existsSync(path.join(vault, '.git')), 'Notizbuch ist ein Git-Repository');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function testServer() {
  console.log('hakobo serve');
  const port = await freePort();
  const token = randomBytes(16).toString('hex');
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${token}` };
  let output = '';
  const server = spawn(binary, ['serve', '--host', '127.0.0.1', '--port', String(port), '--token', token], { env });
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  try {
    let info;
    for (let attempt = 0; attempt < 60 && !info; attempt++) {
      if (server.exitCode !== null) throw new Error(`Server beendet (${server.exitCode}):\n${output}`);
      info = await fetch(`${base}/api/info`, { headers: auth })
        .then((r) => (r.ok ? r.json() : undefined))
        .catch(() => undefined);
      if (!info) await new Promise((r) => setTimeout(r, 500));
    }
    if (!info) throw new Error(`Server antwortet nicht:\n${output}`);
    check(info.version === version, `API meldet Version ${info.version}`);
    check((await fetch(`${base}/api/info`)).status === 401, 'API ohne Token abgewiesen');
    const page = await fetch(`${base}/`, { headers: auth }).then((r) => r.text());
    check(/<div id="root">/.test(page) && /\/assets\/.+\.js/.test(page), 'Oberfläche eingebettet');
    const script = page.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    check(script && (await fetch(base + script, { headers: auth })).ok, 'Skripte der Oberfläche ausgeliefert');
    const snap = await fetch(`${base}/api/vault`, { headers: auth }).then((r) => r.json());
    check(snap.nodes.some((n) => n.text.includes(TEXT)), 'Eintrag im Notizbuch gefunden');
    const update = await fetch(`${base}/api/update`, { headers: auth }).then((r) => r.json());
    check(update.enabled === false && update.current === version, 'Server-Modus ohne Selbst-Update');
  } finally {
    server.kill();
  }
}

try {
  testAdd();
  await testServer();
  console.log('Rauchtest bestanden.');
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  // Ausdrücklich beenden: Offene Pipes eines eben beendeten Servers dürfen den
  // Aufrufer (Installer-Test, CI) nicht warten lassen.
  process.exit(0);
} catch (error) {
  console.error(`Rauchtest fehlgeschlagen: ${error.message}\nArbeitsordner: ${work}`);
  process.exit(1);
}
