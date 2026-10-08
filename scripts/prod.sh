#!/bin/sh
# Wrapper um compose.prod.yml (Projekt poker-prod, D-005) im Prod-Worktree auf main (D-017).
# Aufruf über npm run prod:*.   up | down | logs | tunnel-up | smoke | e2e
set -eu
. "$(dirname "$0")/lib/prod-env.sh"

# App-Version für das Web-Image (Feedback-Kontext, WP-024): Commit des Prod-Worktrees.
APP_VERSION="${APP_VERSION:-$(git -C "$POKER_PROD_DIR" rev-parse --short HEAD 2>/dev/null || true)}"
export APP_VERSION

case "${1:-}" in
  up)
    require_env_file
    mkdir -p "$BACKUP_DIR"
    $COMPOSE --env-file "$ENV_FILE" up -d --build --wait
    echo "✓ poker-prod läuft: http://localhost:$WEB_PORT_VALUE (Backups: $BACKUP_DIR)"
    ;;
  tunnel-up)
    require_env_file
    if [ -z "$(env_value TUNNEL_TOKEN)" ]; then
      echo "✗ TUNNEL_TOKEN ist in $ENV_FILE leer – Tunnel einrichten: docs/OPERATIONS.md" >&2
      exit 1
    fi
    mkdir -p "$BACKUP_DIR"
    $COMPOSE --env-file "$ENV_FILE" --profile tunnel up -d --build --wait
    ;;
  down | logs)
    # Zum Stoppen/Loggen reichen Platzhalterwerte, falls .env.prod (noch) fehlt.
    file="$ENV_FILE"
    [ -f "$file" ] || file=.env.prod.example
    if [ "$1" = down ]; then
      POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-unused}" $COMPOSE --env-file "$file" --profile tunnel down
    else
      POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-unused}" $COMPOSE --env-file "$file" --profile tunnel logs -f
    fi
    ;;
  smoke)
    # Smoke-Test mit WEB_PORT/PUBLIC_ORIGIN aus der .env.prod des Prod-Worktrees.
    case "$ENV_FILE" in
      /*) env_path="$ENV_FILE" ;;
      *) env_path="$(pwd)/$ENV_FILE" ;;
    esac
    PROD_ENV_FILE="$env_path" node "$SCRIPTS_DIR/smoke-prod.mjs"
    ;;
  e2e)
    # E2E-Smoke-Test im Browser (WP-020, D-028): zwei Test-Konten spielen eine Runde, danach werden sie gelöscht.
    # Playwright läuft aus dem Checkout dieses Skripts (der Prod-Worktree hat keine node_modules). Gegen
    # http://localhost:<WEB_PORT> über den lokalen Origin-Proxy mit der ersten PUBLIC_ORIGIN; ein https-Ziel
    # (E2E_BASE_URL=https://poker.arthur-reuss.de) braucht keinen Proxy.
    base="${E2E_BASE_URL:-http://127.0.0.1:$WEB_PORT_VALUE}"
    case "$base" in
      https://*) origin="" ;;
      *)
        origin="${E2E_ORIGIN:-$(env_value PUBLIC_ORIGIN | cut -d, -f1 | tr -d ' ')}"
        if [ -z "$origin" ]; then
          echo "✗ PUBLIC_ORIGIN fehlt in $ENV_FILE (oder E2E_ORIGIN setzen)" >&2
          exit 1
        fi
        ;;
    esac
    cd "$SCRIPTS_DIR/.."
    if [ -n "$origin" ]; then
      E2E_BASE_URL="$base" E2E_ORIGIN="$origin" npm run test:e2e -w @poker/web
    else
      E2E_BASE_URL="$base" npm run test:e2e -w @poker/web
    fi
    ;;
  *)
    echo "Aufruf: $0 up|down|logs|tunnel-up|smoke|e2e" >&2
    exit 2
    ;;
esac
