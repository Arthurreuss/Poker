#!/usr/bin/env bash
# Legt einmalig den dauerhaften Prod-Worktree auf main an (D-017). Aufruf: npm run prod:setup
# Standardpfad: Ordner "poker-prod" neben dem Haupt-Checkout; anderer Pfad per POKER_PROD_DIR=/abs/pfad.
# Der Arbeitsordner bleibt auf dev; prod wird nur noch aus diesem Worktree gebaut und betrieben.
# Doku: docs/OPERATIONS.md, Abschnitt "Prod-Worktree einrichten".
set -euo pipefail
PROD_DIR_OPTIONAL=1
. "$(dirname "$0")/lib/prod-env.sh"

cd "$SCRIPTS_DIR/.."

if [ -e "$POKER_PROD_DIR" ]; then
  branch="$(git -C "$POKER_PROD_DIR" symbolic-ref --short HEAD 2>/dev/null || true)"
  if [ "$branch" = main ]; then
    echo "✓ Prod-Worktree existiert bereits: $POKER_PROD_DIR (Branch main)"
  else
    echo "✗ $POKER_PROD_DIR existiert, ist aber kein Worktree auf main (Branch: ${branch:-keiner})." >&2
    echo "  Ordner prüfen/umbenennen oder anderen Pfad wählen: POKER_PROD_DIR=/abs/pfad npm run prod:setup" >&2
    exit 1
  fi
else
  git show-ref --verify --quiet refs/heads/main || {
    echo "✗ Lokaler Branch main fehlt (git fetch origin main:main)" >&2
    exit 1
  }
  echo "→ git worktree add $POKER_PROD_DIR main"
  git worktree add "$POKER_PROD_DIR" main
  echo "✓ Prod-Worktree angelegt: $POKER_PROD_DIR"
fi

if [ -f "$POKER_PROD_DIR/.env.prod" ]; then
  echo "✓ $POKER_PROD_DIR/.env.prod vorhanden"
else
  echo
  echo "Nächster Schritt: .env.prod gehört in den Prod-Worktree (nicht in den Arbeitsordner):"
  if [ -f .env.prod ] && [ "$(pwd -P)" != "$(cd "$POKER_PROD_DIR" && pwd -P)" ]; then
    echo "    mv \"$(pwd)/.env.prod\" \"$POKER_PROD_DIR/.env.prod\"   # vorhandene Datei aus dem Arbeitsordner übernehmen"
  else
    echo "    cp \"$(pwd)/.env.prod.example\" \"$POKER_PROD_DIR/.env.prod\"   # dann POSTGRES_PASSWORD (und TUNNEL_TOKEN) setzen"
  fi
fi
echo "Danach: npm run prod:up (bzw. prod:tunnel:up) – baut aus $POKER_PROD_DIR."
