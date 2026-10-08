#!/bin/sh
# Wrapper um compose.prod.yml (Projekt poker-prod, D-005). Aufruf über npm run prod:*.
#   up | down | logs | tunnel-up
set -eu
cd "$(dirname "$0")/.."

ENV_FILE=.env.prod
COMPOSE="docker compose -f compose.prod.yml -p poker-prod"

require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "✗ $ENV_FILE fehlt. Anlegen mit:" >&2
    echo "    cp .env.prod.example .env.prod   # dann POSTGRES_PASSWORD (und für den Tunnel TUNNEL_TOKEN) setzen" >&2
    echo "  Details: docs/OPERATIONS.md" >&2
    exit 1
  fi
}

# Liest einen Wert aus .env.prod (ohne die Datei auszuführen).
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

case "${1:-}" in
  up)
    require_env_file
    $COMPOSE --env-file "$ENV_FILE" up -d --build --wait
    echo "✓ poker-prod läuft: http://localhost:$(env_value WEB_PORT | grep . || echo 4320)"
    ;;
  tunnel-up)
    require_env_file
    if [ -z "$(env_value TUNNEL_TOKEN)" ]; then
      echo "✗ TUNNEL_TOKEN ist in $ENV_FILE leer – Tunnel einrichten: docs/OPERATIONS.md" >&2
      exit 1
    fi
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
