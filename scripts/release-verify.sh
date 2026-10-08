#!/usr/bin/env bash
# Letzter Schritt von npm run release (WP-020): prüft das frisch gestartete prod – erst Smoke-Test, dann der
# E2E-Smoke-Test im Browser (zwei Test-Konten spielen eine Runde, D-028). Schlägt etwas fehl, bricht der Release
# mit Exit-Code 1 ab und nennt die Befehle zum Zurückrollen auf den vorherigen main-Stand.
#   scripts/release-verify.sh <vorheriger-main-commit> <prod-start-skript: prod:up|prod:tunnel:up>
# Umgebung: POKER_PROD_DIR (Pflicht). Für Tests überschreibbar: RELEASE_SMOKE_CMD, RELEASE_E2E_CMD.
set -uo pipefail
cd "$(dirname "$0")/.."

prev="${1:?vorheriger main-Commit fehlt}"
up_script="${2:?prod-Start-Skript fehlt}"
prod_dir="${POKER_PROD_DIR:?POKER_PROD_DIR fehlt}"
smoke_cmd="${RELEASE_SMOKE_CMD:-POKER_PROD_DIR=\"$prod_dir\" npm --prefix \"$prod_dir\" run prod:smoke}"
# Der E2E läuft aus dem Arbeitsordner (dort sind Playwright und der Test; der Prod-Worktree hat keine node_modules).
e2e_cmd="${RELEASE_E2E_CMD:-POKER_PROD_DIR=\"$prod_dir\" npm run prod:e2e}"

rollback_hint() {
  local step="$1"
  local current retry=prod:e2e
  [ "$step" = Smoke-Test ] && retry=prod:smoke
  current="$(git -C "$prod_dir" rev-parse --short HEAD 2>/dev/null || echo '?')"
  cat >&2 <<EOF

✗ Release abgebrochen: $step fehlgeschlagen.
  main ($current) ist gemergt und gepusht, prod läuft bereits mit diesem Stand.
  Erst prüfen, ob der Fehler bleibt: npm run $retry
  Zurückrollen auf den vorherigen Stand ($prev):
    git -C "$prod_dir" checkout --detach $prev
    npm run $up_script
    npm run prod:smoke
  Danach den Fehler auf dev beheben. Vor dem nächsten Release den Prod-Worktree zurück auf main:
    git -C "$prod_dir" checkout main
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
