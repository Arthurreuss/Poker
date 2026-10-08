#!/usr/bin/env bash
# Restore-Test (WP-021). Aufruf: npm run prod:test-restore
# Fährt eine isolierte Kopie der prod-Umgebung aus dem aktuellen Checkout hoch (Projekt poker-restoretest,
# eigenes Volume, keine Host-Ports, temporärer Backup-Ordner – echte prod-Daten bleiben unberührt) und prüft:
#   1. Testdaten einfügen → npm run prod:backup erzeugt einen gültigen Dump
#   2. Daten nach dem Backup ändern → prod:restore (bestehende DB) stellt exakt den Backup-Stand her
#   3. Datenbank komplett löschen → prod:restore (leere DB) stellt den Backup-Stand her
# Danach wird alles wieder entfernt (Container, Volume, Image, temporäre Dateien) – auch bei Fehlern.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
tmp_base="${TMPDIR:-/tmp}"
TMP="$(mktemp -d "${tmp_base%/}/poker-restoretest.XXXXXX")"

export POKER_PROD_DIR="$ROOT"
export PROD_PROJECT=poker-restoretest
export PROD_ENV_FILE="$TMP/env"
export PROD_COMPOSE_FILES="-f $ROOT/scripts/test/compose.restore-test.yml"
export BACKUP_DIR="$TMP/backups"
mkdir -p "$BACKUP_DIR"

cat >"$PROD_ENV_FILE" <<EOF
POSTGRES_USER=poker
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=poker
PUBLIC_ORIGIN=http://localhost
EOF

. "$ROOT/scripts/lib/prod-env.sh"
compose() { $COMPOSE --env-file "$ENV_FILE" "$@"; }
sql() { compose exec -T db psql -v ON_ERROR_STOP=1 -U poker -d poker -tAc "$1"; }

cleanup() {
  echo "→ Aufräumen"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm poker-restoretest-server >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

step() { echo; echo "== $*"; }
fail() {
  echo "✗ $*" >&2
  exit 1
}
expect() {
  # expect <Beschreibung> <erwartet> <tatsächlich>
  if [ "$2" = "$3" ]; then echo "  ✓ $1: $3"; else fail "$1: erwartet '$2', erhalten '$3'"; fi
}
users() { sql "SELECT string_agg(username, ',' ORDER BY username) FROM users"; }
server_health() { compose exec -T server wget -qO- http://127.0.0.1:4321/api/health; }

step "Isolierte prod-Kopie starten (db, server, backup)"
compose down -v --remove-orphans >/dev/null 2>&1 || true
compose up -d --build --wait db server backup
echo "  Health: $(server_health)"

step "Testdaten einfügen"
sql "INSERT INTO users (username, password_hash) VALUES ('restore_alice', 'x'), ('restore_bob', 'y')" >/dev/null
migrations="$(sql 'SELECT count(*) FROM schema_migrations')"
expect "users" "restore_alice,restore_bob" "$(users)"

step "Backup ziehen (npm run prod:backup)"
bash "$ROOT/scripts/backup-now.sh"
dump="$(ls -t "$BACKUP_DIR/last/poker"-[0-9]*.sql.gz | head -n 1)"
[ -n "$dump" ] || fail "kein Dump erzeugt"
for sub in daily weekly monthly; do
  ls "$BACKUP_DIR/$sub/poker"-[0-9]*.sql.gz >/dev/null 2>&1 || fail "Rotation: $sub/ fehlt"
done
echo "  ✓ Rotation: daily/, weekly/, monthly/ vorhanden"

step "Daten nach dem Backup ändern, dann Restore in die bestehende DB"
sql "INSERT INTO users (username, password_hash) VALUES ('after_backup', 'z')" >/dev/null
sql "DELETE FROM users WHERE username = 'restore_bob'" >/dev/null
expect "users vor Restore" "after_backup,restore_alice" "$(users)"
bash "$ROOT/scripts/restore.sh" "$dump" --yes
expect "users nach Restore" "restore_alice,restore_bob" "$(users)"
expect "schema_migrations" "$migrations" "$(sql 'SELECT count(*) FROM schema_migrations')"
ls "$BACKUP_DIR/pre-restore/poker"-*.sql.gz >/dev/null 2>&1 || fail "kein Sicherungs-Dump in pre-restore/"
echo "  ✓ Sicherungs-Dump in pre-restore/ angelegt"
echo "  ✓ Server healthy: $(server_health)"

step "Datenbank komplett löschen, dann Restore in eine leere, neu angelegte DB"
compose stop server
compose exec -T db psql -v ON_ERROR_STOP=1 -q -U poker -d postgres -c 'DROP DATABASE poker WITH (FORCE)'
expect "DB nach DROP vorhanden (leer = nein)" "" "$(compose exec -T db psql -U poker -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'poker'")"
bash "$ROOT/scripts/restore.sh" "$dump" --yes
expect "users nach Restore" "restore_alice,restore_bob" "$(users)"
expect "schema_migrations" "$migrations" "$(sql 'SELECT count(*) FROM schema_migrations')"
echo "  ✓ Server healthy: $(server_health)"

step "Status-Skript"
# Ohne Host-Ports und ohne web schlägt der lokale Health-Check erwartbar fehl; geprüft wird die Backup-Ausgabe.
status_out="$(bash "$ROOT/scripts/status.sh" 2>&1 || true)"
echo "$status_out" | sed 's/^/  | /'
echo "$status_out" | grep -q "✓ letztes Backup" || fail "status.sh meldet kein Backup"

echo
echo "✓ Restore-Test erfolgreich."
