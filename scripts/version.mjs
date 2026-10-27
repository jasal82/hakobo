// Eine Version für Programm, Installer, Pakete und Release-Tag.
//
//   node scripts/version.mjs              prüft und gibt die Version aus
//   node scripts/version.mjs set 1.2.3    setzt die Version überall (inkl. Lockdateien)

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['web/package.json'];
const VERSION = /^\d+\.\d+\.\d+$/;
const CARGO_VERSION = /^(\[package\][^[]*?^version\s*=\s*")([^"]+)(")/m;

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function current() {
  const version = read('Cargo.toml').match(CARGO_VERSION)?.[2];
  const mismatched = PACKAGES.filter((file) => JSON.parse(read(file)).version !== version);
  if (!version || !VERSION.test(version) || mismatched.length) {
    throw new Error(
      `Cargo.toml und ${PACKAGES.join(', ')} brauchen dieselbe Version major.minor.patch` +
        (mismatched.length ? ` (abweichend: ${mismatched.join(', ')})` : '') +
        '. Setzen mit: node scripts/version.mjs set X.Y.Z',
    );
  }
  return version;
}

function set(version) {
  if (!VERSION.test(version ?? '')) throw new Error('Aufruf: node scripts/version.mjs set X.Y.Z');
  fs.writeFileSync(path.join(root, 'Cargo.toml'), read('Cargo.toml').replace(CARGO_VERSION, `$1${version}$3`));
  for (const file of PACKAGES) {
    // Nur das Versionsfeld ersetzen, damit Formatierung und Reihenfolge erhalten bleiben.
    const text = read(file).replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
    fs.writeFileSync(path.join(root, file), text);
  }
  execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { cwd: root, stdio: 'inherit' });
  execFileSync('cargo', ['update', '--workspace', '--offline'], { cwd: root, stdio: 'inherit' });
}

if (process.argv[2] === 'set') {
  set(process.argv[3]);
}
const version = current();
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`Der Release-Tag muss v${version} heißen, ist aber ${process.env.GITHUB_REF_NAME}.`);
}
console.log(version);
