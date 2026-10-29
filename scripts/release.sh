#!/usr/bin/env bash
# Release dev → main (D-005) und Neustart von prod auf dem Mac Studio (D-036). Aufruf: npm run release
# Der Arbeitsordner bleibt auf dev; gemergt wird in einem temporären Worktree, danach baut der Deploy-Job des
# Server-Verbunds (D-039) prod auf dem Studio aus dem neuen main. Ablauf: docs/OPERATIONS.md, Abschnitt "Release".
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/prod-host.sh

fail() {
  echo "✗ $*" >&2
  exit 1
}

# 1. Arbeitsordner: auf dev, sauber, Check grün.
[ "$(git symbolic-ref --short HEAD 2>/dev/null)" = dev ] || fail "Release nur von dev aus (git checkout dev)."
[ -z "$(git status --porcelain)" ] || fail "Arbeitsverzeichnis nicht sauber – erst committen oder stashen."

# 2. prod-Checkout auf dem Studio: erreichbar, ohne lokale Änderungen (.env.prod ist gitignored). Auf main muss er
#    nicht stehen: Nach einem Rollback ist er detached, der Deploy-Job setzt ihn zurück auf main.
echo "→ prod-Host $POKER_PROD_HOST prüfen"
remote_state="$(prod_remote "git status --porcelain | wc -l | tr -d ' '; test -f .env.prod && echo env" 2>/dev/null)" ||
  fail "prod-Checkout auf $POKER_PROD_HOST nicht erreichbar (~/$POKER_PROD_REMOTE_DIR) – einmalig: npm run prod:setup"
[ "$(echo "$remote_state" | sed -n 1p)" = 0 ] ||
  fail "~/$POKER_PROD_REMOTE_DIR auf $POKER_PROD_HOST hat lokale Änderungen – dort wird nie gearbeitet; prüfen und verwerfen."
[ "$(echo "$remote_state" | sed -n 2p)" = env ] || fail ".env.prod fehlt auf $POKER_PROD_HOST (siehe docs/OPERATIONS.md)."

echo "→ npm run check"
npm run check

# 3. Lokales main auf den Stand von origin bringen (nur Fast-Forward), dann Merge in einem temporären Worktree.
#    main enthält nur Merges von dev, deshalb gibt es keine Konflikte; falls doch, bleibt main unverändert.
git fetch -q origin
git merge-base --is-ancestor main origin/main && git update-ref refs/heads/main origin/main
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] ||
  fail "Lokales main weicht von origin/main ab – prüfen (main ändert sich nur per Release)."
PREV_MAIN="$(git rev-parse --short main)" # Ziel eines Rollbacks (release-verify.sh)
MERGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/poker-release.XXXXXX")"
trap 'git worktree remove --force "$MERGE_DIR" 2>/dev/null || true; rm -rf "$MERGE_DIR"' EXIT
git worktree add -q "$MERGE_DIR" main
echo "→ merge dev → main"
if ! git -C "$MERGE_DIR" merge --no-ff --no-stat dev -m "Release: merge dev → main"; then
  git -C "$MERGE_DIR" merge --abort 2>/dev/null || true
  fail "Merge dev → main fehlgeschlagen – main ist unverändert."
fi
NEW_MAIN="$(git rev-parse --short main)"

echo "→ push main und dev"
git push origin main dev

# 4. Deploy über die Warteschlange (D-039): Der Job deploy-poker spult den Checkout auf dem Studio auf main vor und
#    baut prod aus $NEW_MAIN neu (scripts/deploy_job.sh, mit Tunnel, wenn TUNNEL_TOKEN gesetzt ist).
echo "→ Deploy $NEW_MAIN auf $POKER_PROD_HOST (Nomad-Job deploy-poker)"
bash scripts/fleet-deploy.sh deploy "$NEW_MAIN" ||
  fail "Deploy fehlgeschlagen (Log oben, Nomad-UI: Job deploy-poker). main ($NEW_MAIN) ist gepusht; prod prüfen: npm run prod:status – zurück: npm run prod:rollback -- $PREV_MAIN"

# 5. Smoke-Test und E2E gegen das neue prod (WP-020); bei Fehler Abbruch mit Rollback-Hinweis.
bash scripts/release-verify.sh "$PREV_MAIN" "$NEW_MAIN"

echo "✓ Release fertig. Arbeitsordner weiter auf dev, prod läuft auf $POKER_PROD_HOST ($NEW_MAIN)."
