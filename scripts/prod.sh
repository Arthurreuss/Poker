#!/bin/sh
# Wrapper um compose.prod.yml (Projekt poker-prod, D-005). Läuft auf dem prod-Host im Checkout von main (D-036);
# vom Entwicklungsrechner aus über npm run prod:* (scripts/prod-remote.sh, per SSH).   up | down | logs | tunnel-up
set -eu
. "$(dirname "$0")/lib/prod-env.sh"

# App-Version für das Web-Image (Feedback-Kontext, WP-024): Commit des prod-Checkouts.
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
  *)
    echo "Aufruf: $0 up|down|logs|tunnel-up" >&2
    exit 2
    ;;
esac
