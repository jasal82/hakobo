#!/usr/bin/env bash
# Baut Hakobo (Oberfläche und Programm) und legt das Ergebnis unter dist/ ab.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${HAKOBO_FRONTEND_READY:-}" = "1" ]; then
  [ -f web/dist/index.html ] || { echo "HAKOBO_FRONTEND_READY verlangt eine bereits gebaute Oberfläche (web/dist/index.html fehlt)."; exit 1; }
  echo "[1-2/3] Vorbereitete Oberfläche verwenden ..."
else
  echo "[1/3] Abhängigkeiten der Oberfläche ..."
  npm ci --no-audit --no-fund
  echo "[2/3] Oberfläche bauen ..."
  npm run build
fi

echo "[3/3] Programm bauen (Release) ..."
cargo build --locked --release --bin hakobo

mkdir -p dist
exe=target/release/hakobo
[ -f "$exe.exe" ] && exe="$exe.exe"
cp "$exe" "dist/$(basename "$exe" | sed 's/^hakobo/Hakobo/')"
echo
echo "Fertig: dist/$(ls dist | grep -i '^hakobo' | head -1)"
