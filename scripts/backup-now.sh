#!/usr/bin/env bash
# Sofortiges Backup der prod-DB (WP-021). Aufruf: npm run prod:backup
# Nutzt denselben Ablauf wie das tägliche Backup im Dienst "backup" (inkl. Rotation daily/weekly/monthly).
# Ergebnis: $BACKUP_DIR/last/<db>-<JJJJMMTT-HHMMSS>.sql.gz. Doku: docs/OPERATIONS.md, Abschnitt "Backup".
set -euo pipefail
. "$(dirname "$0")/lib/prod-env.sh"

require_env_file

if [ -z "$($COMPOSE --env-file "$ENV_FILE" ps -q --status running backup)" ]; then
  echo "✗ Dienst backup läuft nicht in $PROD_PROJECT – erst npm run prod:up" >&2
  exit 1
fi

echo "→ Backup von $POSTGRES_DB_VALUE nach $BACKUP_DIR"
$COMPOSE --env-file "$ENV_FILE" exec -T backup /backup.sh >/dev/null

# Neueste Datei in last/ (ohne den Symlink <db>-latest.sql.gz).
latest="$(ls -t "$BACKUP_DIR/last/$POSTGRES_DB_VALUE"-[0-9]*.sql.gz 2>/dev/null | head -n 1 || true)"
if [ -z "$latest" ] || ! gzip -t "$latest"; then
  echo "✗ Kein gültiges Backup in $BACKUP_DIR/last gefunden" >&2
  exit 1
fi
echo "✓ Backup erstellt: $latest ($(du -h "$latest" | cut -f1 | tr -d ' '))"
