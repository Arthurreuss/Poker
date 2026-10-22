#!/usr/bin/env bash
# Letzter Schritt von npm run release (WP-020): prüft das frisch gestartete prod – erst Smoke-Test, dann der
# E2E-Smoke-Test im Browser (zwei Test-Konten spielen eine Runde, D-028). Schlägt etwas fehl, bricht der Release
# mit Exit-Code 1 ab und nennt die Befehle zum Zurückrollen auf den vorherigen main-Stand auf dem Studio (D-036).
#   scripts/release-verify.sh <vorheriger-main-commit> <prod-start-skript: prod:up|prod:tunnel:up> [<neuer-main-commit>]
# Für Tests überschreibbar: RELEASE_SMOKE_CMD, RELEASE_E2E_CMD.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/prod-host.sh

prev="${1:?vorheriger main-Commit fehlt}"
up_script="${2:?prod-Start-Skript fehlt}"
current="${3:-?}"
smoke_cmd="${RELEASE_SMOKE_CMD:-npm run prod:smoke}"
e2e_cmd="${RELEASE_E2E_CMD:-npm run prod:e2e}"

rollback_hint() {
  local step="$1"
  local retry=prod:e2e
  [ "$step" = Smoke-Test ] && retry=prod:smoke
  cat >&2 <<EOF

✗ Release abgebrochen: $step fehlgeschlagen.
  main ($current) ist gemergt und gepusht, prod auf $POKER_PROD_HOST läuft bereits mit diesem Stand.
  Erst prüfen, ob der Fehler bleibt: npm run $retry
  Zurückrollen auf den vorherigen Stand ($prev):
    ssh $POKER_PROD_HOST 'cd ~/$POKER_PROD_REMOTE_DIR && git checkout --detach $prev'
    npm run $up_script
    npm run prod:smoke
  Danach den Fehler auf dev beheben. Vor dem nächsten Release den Studio-Checkout zurück auf main:
    ssh $POKER_PROD_HOST 'cd ~/$POKER_PROD_REMOTE_DIR && git checkout main'
  Hat der neue Stand DB-Migrationen ausgeführt, läuft der alte Server auf dem neueren Schema – im Zweifel
  das letzte Backup zurückspielen (npm run prod:restore). Details: docs/OPERATIONS.md, Abschnitt "Release".
EOF
  exit 1
}

echo "→ Smoke-Test"
eval "$smoke_cmd" || rollback_hint Smoke-Test

echo "→ E2E-Smoke-Test (Browser, zwei Test-Konten)"
eval "$e2e_cmd" || rollback_hint E2E-Test

echo "✓ prod geprüft: Smoke-Test und E2E grün."
