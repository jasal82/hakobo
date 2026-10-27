#!/usr/bin/env bash
# Baut Hakobo (Oberfläche und Programm) und legt das fertige Programm unter
# dist/ ab, das Archiv für Releases unter dist/packages/:
#   dist/hakobo   App (macOS: eigenes Fenster, Linux: im Browser), Server und Kommandozeile
#
# Linux benötigt außer Rust und Node.js nur einen C-Compiler, make und perl
# (für das statisch eingebundene OpenSSL).
set -euo pipefail
cd "$(dirname "$0")"
version=$(node scripts/version.mjs)

if [ "${HAKOBO_FRONTEND_READY:-}" = "1" ]; then
  [ -f web/dist/index.html ] || { echo "HAKOBO_FRONTEND_READY verlangt eine bereits gebaute Oberfläche (web/dist/index.html fehlt)." >&2; exit 1; }
  echo "[1-2/3] Vorbereitete Oberfläche verwenden …"
else
  echo "[1/3] Abhängigkeiten der Oberfläche …"
  npm ci --no-audit --no-fund
  echo "[2/3] Oberfläche bauen …"
  npm run build
fi

echo "[3/3] Programm bauen (Release) …"
cargo build --locked --release --bin hakobo
mkdir -p dist/packages
node scripts/third-party-licenses.mjs dist/THIRD-PARTY-LICENSES.txt

# Unter Windows (Git Bash) wie build.cmd: dist/Hakobo.exe, ohne Archiv.
if [ -f target/release/hakobo.exe ]; then
  cp target/release/hakobo.exe dist/Hakobo.exe
  echo
  echo "Fertig: dist/Hakobo.exe"
  exit 0
fi

cp target/release/hakobo dist/hakobo
case "$(uname -s)" in
  Darwin) platform=macos ;;
  *) platform=$(uname -s | tr '[:upper:]' '[:lower:]') ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) arch=$(uname -m) ;;
esac
# Nur ausdrücklich genannte Dateien verpacken, nie alte Pakete oder Arbeitsdaten.
tar -czf "dist/packages/Hakobo-$version-$platform-$arch.tar.gz" -C dist hakobo THIRD-PARTY-LICENSES.txt
echo
echo "Fertig: dist/hakobo und dist/packages/Hakobo-$version-$platform-$arch.tar.gz"
