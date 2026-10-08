#!/usr/bin/env bash
# Restore der prod-DB aus einem Dump (WP-021). Aufruf: npm run prod:restore -- <dump.sql.gz> [--yes]
# Ablauf: Dump prüfen → Sicherheitsabfrage → Sicherungs-Dump des aktuellen Stands nach $BACKUP_DIR/pre-restore/
# → Server stoppen → Datenbank löschen und leer neu anlegen → Dump einspielen (eine Transaktion) → Server starten.
# Doku: docs/OPERATIONS.md, Abschnitt "Restore".
set -euo pipefail
# Relative Dump-Pfade gelten ab dem Aufrufort (npm setzt INIT_CWD); prod-env.sh wechselt das Verzeichnis.
CALLER_DIR="${INIT_CWD:-$(pwd)}"
. "$(dirname "$0")/lib/prod-env.sh"

usage() {
  echo "Aufruf: npm run prod:restore -- <dump.sql.gz|dump.sql> [--yes]" >&2
  exit 2
}

dump=""
assume_yes=0
for arg in "$@"; do
  case "$arg" in
    --yes | -y) assume_yes=1 ;;
    -*) usage ;;
    *)
      [ -z "$dump" ] || usage
      dump="$arg"
      ;;
  esac
done
[ -n "$dump" ] || usage
case "$dump" in
  /*) ;;
  *) dump="$CALLER_DIR/$dump" ;;
esac

require_env_file

if [ ! -f "$dump" ]; then
  echo "✗ Dump nicht gefunden: $dump" >&2
  exit 1
fi
case "$dump" in
  *.gz)
    gzip -t "$dump" || {
      echo "✗ $dump ist kein gültiges gzip-Archiv" >&2
      exit 1
    }
    cat_dump() { gzip -dc "$dump"; }
    ;;
  *) cat_dump() { cat "$dump"; } ;;
esac

compose() { $COMPOSE --env-file "$ENV_FILE" "$@"; }
psql_db() { compose exec -T db psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER_VALUE" "$@"; }

if [ -z "$(compose ps -q --status running db)" ]; then
  echo "✗ Dienst db läuft nicht in $PROD_PROJECT – erst npm run prod:up" >&2
  exit 1
fi

echo "Restore in $PROD_PROJECT, Datenbank \"$POSTGRES_DB_VALUE\" aus:"
echo "  $dump"
echo "Alle aktuellen Daten dieser Datenbank werden ersetzt (vorher wird ein Sicherungs-Dump angelegt)."
if [ "$assume_yes" -ne 1 ]; then
  printf 'Zum Fortfahren "restore" eingeben: '
  read -r answer || answer=""
  if [ "$answer" != "restore" ]; then
    echo "Abgebrochen."
    exit 1
  fi
fi

# 1. Sicherungs-Dump des aktuellen Stands (falls die DB existiert), damit ein Fehlgriff umkehrbar ist.
db_exists="$(psql_db -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB_VALUE'")"
if [ "$db_exists" = "1" ]; then
  mkdir -p "$BACKUP_DIR/pre-restore"
  safety="$BACKUP_DIR/pre-restore/$POSTGRES_DB_VALUE-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "→ Sicherungs-Dump des aktuellen Stands: $safety"
  compose exec -T db pg_dump -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" | gzip >"$safety"
fi

# 2. Server stoppen, damit niemand während des Restores schreibt. web bleibt an (liefert solange 502 für /api).
echo "→ Server stoppen"
compose stop server

# Bei einem Fehler ab hier bleibt der Server bewusst gestoppt: Er würde sonst auf einer leeren DB
# frische Migrationen anlegen und mit leeren Daten weiterlaufen.
trap 'echo "✗ Restore fehlgeschlagen – Server bleibt gestoppt. Nach Klärung: npm run prod:up" >&2' ERR

# 3. Datenbank leer neu anlegen. WITH (FORCE) trennt noch offene Verbindungen (z. B. Backup-Lauf).
echo "→ Datenbank $POSTGRES_DB_VALUE neu anlegen"
if [ "$db_exists" = "1" ]; then
  psql_db -d postgres -c "DROP DATABASE \"$POSTGRES_DB_VALUE\" WITH (FORCE)"
fi
psql_db -d postgres -c "CREATE DATABASE \"$POSTGRES_DB_VALUE\" OWNER \"$POSTGRES_USER_VALUE\""

# 4. Dump einspielen – alles oder nichts.
echo "→ Dump einspielen"
cat_dump | psql_db -d "$POSTGRES_DB_VALUE" --single-transaction >/dev/null

trap - ERR

# 5. Server wieder starten (führt beim Start ggf. neuere Migrationen aus) und auf healthy warten.
echo "→ Server starten"
compose up -d --no-build --no-deps --wait server
echo "✓ Restore abgeschlossen."
