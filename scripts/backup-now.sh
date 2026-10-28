#!/usr/bin/env bash
# Sofortiges Backup der prod-DB (WP-021). Aufruf: npm run prod:backup
# Nutzt denselben Ablauf wie das tägliche Backup im Dienst "backup" (inkl. Rotation daily/weekly/monthly).
# Ergebnis: $BACKUP_DIR/last/<db>-<JJJJMMTT-HHMMSS>.sql.gz und – mit SECRETS_BACKUP_PASSPHRASE – die verschlüsselte
# Kopie von .env.prod in $BACKUP_DIR/secrets/ (Hook, D-037). Doku: docs/OPERATIONS.md, Abschnitt "Backup".
set -euo pipefail
. "$(dirname "$0")/lib/prod-env.sh"

require_env_file

if [ -z "$($COMPOSE --env-file "$ENV_FILE" ps -q --status running backup)" ]; then
  echo "✗ Dienst backup läuft nicht in $PROD_PROJECT – erst npm run prod:up" >&2
  exit 1
fi

echo "→ Backup von $POSTGRES_DB_VALUE nach $BACKUP_DIR"
# Startzeit mit 60 s Spielraum (die Uhr der Docker-VM kann leicht abweichen), für die Prüfung des Secrets-Backups.
started="$(($(date +%s) - 60))"
$COMPOSE --env-file "$ENV_FILE" exec -T backup /backup.sh >/dev/null

# Neueste Datei in last/ (ohne den Symlink <db>-latest.sql.gz).
latest="$(ls -t "$BACKUP_DIR/last/$POSTGRES_DB_VALUE"-[0-9]*.sql.gz 2>/dev/null | head -n 1 || true)"
if [ -z "$latest" ] || ! gzip -t "$latest"; then
  echo "✗ Kein gültiges Backup in $BACKUP_DIR/last gefunden" >&2
  exit 1
fi
echo "✓ Backup erstellt: $latest ($(du -h "$latest" | cut -f1 | tr -d ' '))"

# Secrets-Backup (D-037): ohne Passphrase hat der Hook oben schon gewarnt, das DB-Backup gilt trotzdem.
if [ -n "$(env_value SECRETS_BACKUP_PASSPHRASE)" ]; then
  secrets="$(ls -t "$BACKUP_DIR/secrets/env-prod-"[0-9]*.tar.gz.gpg 2>/dev/null | head -n 1 || true)"
  if [ -z "$secrets" ] || [ "$(mtime "$secrets")" -lt "$started" ]; then
    echo "✗ Keine neue verschlüsselte Kopie von .env.prod in $BACKUP_DIR/secrets – Logs: docker logs ${PROD_PROJECT}-backup-1" >&2
    exit 1
  fi
  echo "✓ Secrets verschlüsselt: $secrets"
fi
