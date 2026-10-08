#!/bin/sh
# Wrapper um compose.prod.yml (Projekt poker-prod, D-005) im Prod-Worktree auf main (D-017).
# Aufruf über npm run prod:*.   up | down | logs | tunnel-up | smoke
set -eu
. "$(dirname "$0")/lib/prod-env.sh"

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
  *)
    echo "Aufruf: $0 up|down|logs|tunnel-up|smoke" >&2
    exit 2
    ;;
esac
