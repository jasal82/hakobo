#!/usr/bin/env bash
# Entwicklungsserver mit Demo-Notizbuch und eigenem Einstellungsordner.
#   SQIZZO_DEMO_VAULT  Ordner des Notizbuchs (Standard: ./.dev/vault)
#   SQIZZO_DEMO_CONFIG Einstellungsordner      (Standard: ./.dev/config)
set -e
cd "$(dirname "$0")/.."
vault="${SQIZZO_DEMO_VAULT:-.dev/vault}"
config="${SQIZZO_DEMO_CONFIG:-.dev/config}"
exec ./target/debug/sqizzo --no-open --token dev --port 4590 --vault "$vault" --config-dir "$config" "$@"
