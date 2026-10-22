#!/usr/bin/env bash
# Steuert prod auf dem Mac Studio vom Entwicklungsrechner aus (D-036). Aufruf über npm run prod:*.
#   up | tunnel-up | down | logs | status | backup | restore <dump> [--yes]   → Skript läuft per SSH auf dem Studio
#   compose <args…>                                                         → docker compose -p poker-prod <args> dort
#   ssh                                                                      → Shell im Checkout auf dem Studio
#   smoke | e2e                                                              → läuft hier, über eine SSH-Portweiterleitung
# Doku: docs/OPERATIONS.md
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/prod-host.sh

fail() {
  echo "✗ $*" >&2
  exit 1
}

port_open() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }

# Startet eine SSH-Portweiterleitung 127.0.0.1:<WEB_PORT> → Web-Port des Studios und setzt FORWARD_URL/FORWARD_ORIGIN.
# Die prod-Ports sind auf dem Studio nur an 127.0.0.1 gebunden, deshalb kein direkter Zugriff übers Netz.
start_forward() {
  local remote_port
  remote_port="$(prod_remote_env_value WEB_PORT)"
  remote_port="${remote_port:-4320}"
  FORWARD_ORIGIN="$(prod_remote_env_value PUBLIC_ORIGIN | cut -d, -f1 | tr -d ' ')"
  [ -n "$FORWARD_ORIGIN" ] || fail "PUBLIC_ORIGIN fehlt in ~/$POKER_PROD_REMOTE_DIR/.env.prod auf $POKER_PROD_HOST"
  local port="${PROD_FORWARD_PORT:-$remote_port}"
  port_open "$port" && fail "Port $port ist hier schon belegt (läuft noch ein lokales prod?) – anderer Port: PROD_FORWARD_PORT=4329"
  $POKER_PROD_SSH -N -o ExitOnForwardFailure=yes -o ConnectTimeout=10 \
    -L "127.0.0.1:$port:127.0.0.1:$remote_port" "$POKER_PROD_HOST" &
  FORWARD_PID=$!
  trap 'kill "$FORWARD_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 50); do
    port_open "$port" && break
    kill -0 "$FORWARD_PID" 2>/dev/null || fail "SSH-Portweiterleitung zu $POKER_PROD_HOST fehlgeschlagen"
    sleep 0.2
  done
  port_open "$port" || fail "SSH-Portweiterleitung zu $POKER_PROD_HOST antwortet nicht"
  FORWARD_URL="http://127.0.0.1:$port"
}

action="${1:-}"
[ $# -gt 0 ] && shift
case "$action" in
  up | tunnel-up | down | logs) prod_remote_script prod.sh "$action" ;;
  status) prod_remote_script status.sh ;;
  backup) prod_remote_script backup-now.sh ;;
  restore) prod_remote_script restore.sh "$@" ;;
  compose)
    args=""
    [ $# -gt 0 ] && args="$(printf ' %q' "$@")"
    prod_remote "docker compose -p poker-prod$args"
    ;;
  ssh) $POKER_PROD_SSH -t "$POKER_PROD_HOST" "$PROD_REMOTE_PATH; cd ~/$POKER_PROD_REMOTE_DIR && exec \$SHELL -l" ;;
  smoke)
    # Smoke-Test (scripts/smoke-prod.mjs) mit der ersten PUBLIC_ORIGIN; anderes Ziel per SMOKE_URL/SMOKE_ORIGIN.
    if [ -n "${SMOKE_URL:-}" ]; then
      node scripts/smoke-prod.mjs
    else
      start_forward
      SMOKE_URL="$FORWARD_URL" SMOKE_ORIGIN="${SMOKE_ORIGIN:-$FORWARD_ORIGIN}" node scripts/smoke-prod.mjs
    fi
    ;;
  e2e)
    # E2E-Smoke-Test im Browser (WP-020, D-028) über den lokalen Origin-Proxy; ein https-Ziel
    # (E2E_BASE_URL=https://poker.arthur-reuss.de) braucht weder Proxy noch Weiterleitung.
    case "${E2E_BASE_URL:-}" in
      https://*) npm run test:e2e -w @poker/web ;;
      *)
        start_forward
        E2E_BASE_URL="$FORWARD_URL" E2E_ORIGIN="${E2E_ORIGIN:-$FORWARD_ORIGIN}" npm run test:e2e -w @poker/web
        ;;
    esac
    ;;
  *)
    echo "Aufruf: $0 up|tunnel-up|down|logs|status|backup|restore|compose|ssh|smoke|e2e" >&2
    exit 2
    ;;
esac
