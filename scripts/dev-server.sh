#!/usr/bin/env bash
# Entwicklungsserver mit Demo-Notizbuch und eigenem Einstellungsordner.
#   HAKOBO_DEMO_VAULT  Ordner des Notizbuchs (Standard: ./.dev/vault)
#   HAKOBO_DEMO_CONFIG Einstellungsordner      (Standard: ./.dev/config)
set -e
cd "$(dirname "$0")/.."
vault="${HAKOBO_DEMO_VAULT:-.dev/vault}"
config="${HAKOBO_DEMO_CONFIG:-.dev/config}"
exec ./target/debug/hakobo --no-open --token dev --port 4590 --vault "$vault" --config-dir "$config" "$@"
