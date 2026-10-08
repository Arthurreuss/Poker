#!/bin/sh
# Release dev → main (D-005) und Neustart der Prod-Umgebung. Aufruf: npm run release
# Ablauf: docs/OPERATIONS.md, Abschnitt "Release".
set -eu
cd "$(dirname "$0")/.."

fail() {
  echo "✗ $*" >&2
  exit 1
}

[ "$(git symbolic-ref --short HEAD 2>/dev/null)" = dev ] || fail "Release nur von dev aus (git checkout dev)."
[ -z "$(git status --porcelain)" ] || fail "Arbeitsverzeichnis nicht sauber – erst committen oder stashen."
[ -f .env.prod ] || fail ".env.prod fehlt (siehe docs/OPERATIONS.md)."

echo "→ npm run check"
npm run check

echo "→ merge dev → main"
git checkout main
# Bei Fehlern zurück auf dev, damit niemand versehentlich auf main weiterarbeitet.
trap 'git checkout dev >/dev/null 2>&1 || true' EXIT
git merge --no-ff dev -m "Release: merge dev → main"

echo "→ push main und dev"
git push origin main dev

echo "→ prod:up (baut aus main)"
npm run prod:up

echo "→ Smoke-Test"
npm run prod:smoke

git checkout dev
trap - EXIT
echo "✓ Release fertig, zurück auf dev."
