#!/usr/bin/env bash
# Release dev → main (D-005) und Neustart der Prod-Umgebung aus dem Prod-Worktree (D-017). Aufruf: npm run release
# Der Arbeitsordner bleibt auf dev; gemergt wird im Prod-Worktree, der main ausgecheckt hat.
# Ablauf: docs/OPERATIONS.md, Abschnitt "Release".
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "✗ $*" >&2
  exit 1
}

PROD_DIR_OPTIONAL=1
. scripts/lib/prod-env.sh

# 1. Arbeitsordner: auf dev, sauber, Check grün.
[ "$(git symbolic-ref --short HEAD 2>/dev/null)" = dev ] || fail "Release nur von dev aus (git checkout dev)."
[ -z "$(git status --porcelain)" ] || fail "Arbeitsverzeichnis nicht sauber – erst committen oder stashen."

# 2. Prod-Worktree: vorhanden, auf main, sauber (.env.prod ist gitignored), .env.prod vorhanden.
[ -d "$POKER_PROD_DIR" ] || fail "Prod-Worktree fehlt: $POKER_PROD_DIR – einmalig: npm run prod:setup"
[ "$(git -C "$POKER_PROD_DIR" symbolic-ref --short HEAD 2>/dev/null)" = main ] ||
  fail "$POKER_PROD_DIR ist nicht auf main."
[ -z "$(git -C "$POKER_PROD_DIR" status --porcelain)" ] ||
  fail "Prod-Worktree $POKER_PROD_DIR hat lokale Änderungen – dort wird nie direkt gearbeitet; prüfen und verwerfen."
[ -f "$POKER_PROD_DIR/.env.prod" ] || fail "$POKER_PROD_DIR/.env.prod fehlt (siehe docs/OPERATIONS.md)."

echo "→ npm run check"
npm run check

# 3. Merge im Prod-Worktree. main enthält nur Merges von dev, deshalb gibt es keine Konflikte; falls doch,
#    wird der Merge abgebrochen und main bleibt unverändert. Ein Merge löst den pre-commit-Hook nicht aus.
echo "→ merge dev → main (in $POKER_PROD_DIR)"
if ! git -C "$POKER_PROD_DIR" merge --no-ff --no-stat dev -m "Release: merge dev → main"; then
  git -C "$POKER_PROD_DIR" merge --abort 2>/dev/null || true
  fail "Merge dev → main fehlgeschlagen – main ist unverändert."
fi

echo "→ push main und dev"
git push origin main dev

# 4. prod aus dem Prod-Worktree neu bauen und starten (mit Tunnel, wenn TUNNEL_TOKEN gesetzt ist), dann Smoke-Test.
if [ -n "$(sed -n 's/^TUNNEL_TOKEN=//p' "$POKER_PROD_DIR/.env.prod" | tail -n 1)" ]; then
  echo "→ prod:tunnel:up (baut aus main)"
  POKER_PROD_DIR="$POKER_PROD_DIR" npm --prefix "$POKER_PROD_DIR" run prod:tunnel:up
else
  echo "→ prod:up (baut aus main)"
  POKER_PROD_DIR="$POKER_PROD_DIR" npm --prefix "$POKER_PROD_DIR" run prod:up
fi

echo "→ Smoke-Test"
POKER_PROD_DIR="$POKER_PROD_DIR" npm --prefix "$POKER_PROD_DIR" run prod:smoke

echo "✓ Release fertig. Arbeitsordner weiter auf dev, prod läuft aus $POKER_PROD_DIR."
