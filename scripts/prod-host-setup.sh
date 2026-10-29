#!/usr/bin/env bash
# Richtet einmalig den prod-Checkout auf dem Mac Studio ein (D-036). Aufruf auf dem Entwicklungsrechner: npm run prod:setup
# Klont main per SSH (Deploy-Key, nur lesend, D-038) nach ~/$POKER_PROD_REMOTE_DIR und prüft git, Docker und .env.prod.
# Doku: docs/OPERATIONS.md, Abschnitt "prod-Host einrichten".
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/prod-host.sh

dir="~/$POKER_PROD_REMOTE_DIR"
echo "→ prod-Host $POKER_PROD_HOST, Checkout $dir"
prod_remote_raw "command -v git >/dev/null && command -v docker >/dev/null" ||
  { echo "✗ git oder docker fehlt auf $POKER_PROD_HOST (Homebrew-git und Colima/Docker-CLI, siehe D-038)" >&2; exit 1; }

if prod_remote_raw "test -d $dir/.git"; then
  branch="$(prod_remote "git symbolic-ref --short HEAD 2>/dev/null || true")"
  [ "$branch" = main ] || { echo "✗ $dir ist nicht auf main (Branch: ${branch:-keiner})" >&2; exit 1; }
  echo "✓ Checkout vorhanden (main, $(prod_remote "git rev-parse --short HEAD"))"
else
  prod_remote_raw "test ! -e $dir" || { echo "✗ $dir existiert, ist aber kein Git-Checkout" >&2; exit 1; }
  prod_remote_raw "git clone -q --branch main $POKER_PROD_REPO_URL $dir"
  echo "✓ Checkout angelegt: $dir"
fi

if prod_remote_raw "test -f $dir/.env.prod"; then
  echo "✓ $dir/.env.prod vorhanden"
else
  echo
  echo "Nächster Schritt: .env.prod auf dem Studio anlegen (gitignored, nie committen):"
  echo "    npm run prod:ssh   # dann: cp .env.prod.example .env.prod und POSTGRES_PASSWORD, TUNNEL_TOKEN setzen"
fi
echo "Danach: npm run prod:tunnel:up (bzw. prod:up ohne Tunnel)."
