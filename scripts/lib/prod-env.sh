# Gemeinsame Helfer für die prod-Skripte (prod.sh, backup-now.sh, restore.sh, status.sh, test-restore.sh).
# Wird per "." eingebunden (POSIX-sh-kompatibel, auch aus bash).
#
# prod läuft aus einem eigenen, dauerhaften Git-Worktree auf main (D-017), nicht aus dem Arbeitsordner (dev).
# Die Skripte wechseln deshalb in den Prod-Worktree und nehmen compose.prod.yml und .env.prod von dort.
#   POKER_PROD_DIR      Prod-Worktree (Standard: Ordner "poker-prod" neben dem Haupt-Checkout,
#                       z. B. ~/code/Arthurreuss/poker-prod). Einrichten: npm run prod:setup
# Nur für scripts/test-restore.sh gedacht, damit der Test echte prod-Daten nie anfasst:
#   PROD_PROJECT        Compose-Projekt          (Standard: poker-prod)
#   PROD_ENV_FILE       Env-Datei                (Standard: .env.prod im Prod-Worktree)
#   PROD_COMPOSE_FILES  zusätzliche -f-Argumente (Standard: leer; absolute Pfade verwenden)

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Standardpfad des Prod-Worktrees: neben dem Haupt-Checkout (dem Ordner, der .git enthält),
# auch wenn das Skript aus einem anderen Worktree aufgerufen wird.
default_prod_dir() {
  _common="$(git -C "$SCRIPTS_DIR" rev-parse --path-format=absolute --git-common-dir)"
  _main_root="$(dirname "$_common")"
  echo "$(dirname "$_main_root")/poker-prod"
}

POKER_PROD_DIR="${POKER_PROD_DIR:-$(default_prod_dir)}"
case "$POKER_PROD_DIR" in
  /*) ;;
  *)
    echo "✗ POKER_PROD_DIR muss ein absoluter Pfad sein: $POKER_PROD_DIR" >&2
    exit 1
    ;;
esac

if [ "${PROD_DIR_OPTIONAL:-0}" != 1 ]; then
  if [ ! -d "$POKER_PROD_DIR" ]; then
    echo "✗ Prod-Worktree fehlt: $POKER_PROD_DIR" >&2
    echo "  Einmalig einrichten mit: npm run prod:setup   (Details: docs/OPERATIONS.md)" >&2
    exit 1
  fi
  if [ ! -f "$POKER_PROD_DIR/compose.prod.yml" ]; then
    echo "✗ $POKER_PROD_DIR enthält kein compose.prod.yml – main ist noch nicht released: npm run release" >&2
    exit 1
  fi
  cd "$POKER_PROD_DIR"
fi

PROD_PROJECT="${PROD_PROJECT:-poker-prod}"
ENV_FILE="${PROD_ENV_FILE:-.env.prod}"
COMPOSE="docker compose -f compose.prod.yml ${PROD_COMPOSE_FILES:-} -p $PROD_PROJECT"

require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "✗ $ENV_FILE fehlt in $POKER_PROD_DIR. Anlegen mit:" >&2
    echo "    cd \"$POKER_PROD_DIR\" && cp .env.prod.example .env.prod   # dann POSTGRES_PASSWORD (und für den Tunnel TUNNEL_TOKEN) setzen" >&2
    echo "  Details: docs/OPERATIONS.md" >&2
    exit 1
  fi
}

# Liest einen Wert aus der Env-Datei (ohne sie auszuführen). Leer, wenn nicht gesetzt.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

# Wert aus der Env-Datei oder Standard ($2), falls leer.
env_value_or() {
  _v="$(env_value "$1")"
  if [ -n "$_v" ]; then echo "$_v"; else echo "$2"; fi
}

# Backup-Ordner auf dem Host (außerhalb von Docker-Volumes). Compose kann "~" nicht expandieren,
# deshalb wird der Pfad hier aufgelöst und als Umgebungsvariable an Compose übergeben
# (Shell-Variablen haben Vorrang vor --env-file). Standard: ~/poker-backups.
resolve_backup_dir() {
  _dir="${BACKUP_DIR:-$(env_value BACKUP_DIR)}"
  [ -n "$_dir" ] || _dir="$HOME/poker-backups"
  case "$_dir" in
    "~") _dir="$HOME" ;;
    "~/"*) _dir="$HOME/${_dir#\~/}" ;;
  esac
  case "$_dir" in
    /*) ;;
    *)
      echo "✗ BACKUP_DIR muss ein absoluter Pfad sein (oder mit ~/ beginnen): $_dir" >&2
      exit 1
      ;;
  esac
  BACKUP_DIR="$_dir"
  export BACKUP_DIR
}

POSTGRES_USER_VALUE="$(env_value_or POSTGRES_USER poker)"
POSTGRES_DB_VALUE="$(env_value_or POSTGRES_DB poker)"
WEB_PORT_VALUE="$(env_value_or WEB_PORT 4320)"
resolve_backup_dir
