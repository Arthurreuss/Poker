#!/bin/sh
# Hook des Dienstes backup (prodrigestivill/postgres-backup-local ruft alles in /hooks per run-parts auf, D-037):
# nach jedem DB-Backup eine verschlüsselte Kopie von .env.prod (POSTGRES_PASSWORD, TUNNEL_TOKEN …) in den
# Backup-Ordner. Aktionen: error | pre-backup | post-backup – nur post-backup tut etwas.
#   SECRETS_BACKUP_PASSPHRASE  Passphrase (aus .env.prod). Leer → laute Warnung, Exit 0: das DB-Backup bleibt gültig.
#   SECRETS_SRC_DIR            Ordner der Env-Datei, read-only eingehängt (Standard /prod-env)
#   PROD_ENV_NAME              Name der Env-Datei darin (Standard .env.prod); im Archiv heißt sie immer .env.prod
#   BACKUP_DIR                 Backup-Ordner im Container (vom Image gesetzt: /backups)
#   SECRETS_KEEP_DAYS          Aufbewahrung in Tagen (Standard 30)
# Ergebnis: $BACKUP_DIR/secrets/env-prod-JJJJMMTT.tar.gz.gpg (tar.gz mit .env.prod, gpg AES256 symmetrisch),
# ein Stand pro Tag, atomar ersetzt. Entschlüsseln: docs/OPERATIONS.md, Abschnitt „Backup“.
set -eu

[ "${1:-}" = post-backup ] || exit 0

src="${SECRETS_SRC_DIR:-/prod-env}/${PROD_ENV_NAME:-.env.prod}"
out_dir="${BACKUP_DIR:?BACKUP_DIR fehlt}/secrets"
keep_days="${SECRETS_KEEP_DAYS:-30}"

if [ -z "${SECRETS_BACKUP_PASSPHRASE:-}" ]; then
  echo "!!! WARNUNG: SECRETS_BACKUP_PASSPHRASE fehlt in .env.prod – .env.prod wird NICHT gesichert." >&2
  echo "!!! Das DB-Backup ist trotzdem erstellt. Passphrase setzen: docs/OPERATIONS.md, Abschnitt „Backup“." >&2
  exit 0
fi
if [ ! -s "$src" ]; then
  echo "✗ Secrets-Backup: $src fehlt oder ist leer" >&2
  exit 1
fi

stamp="$(date +%Y%m%d)"
target="$out_dir/env-prod-$stamp.tar.gz.gpg"
tmp="$out_dir/.env-prod-$stamp.tmp"
mkdir -p "$out_dir"

# Klartext nur kurz im eigenen Temp-Ordner (mit temporärem GNUPGHOME), danach und bei Fehlern weg.
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"; rm -f "$tmp"' EXIT
mkdir "$work/archive" "$work/gnupg"
cp "$src" "$work/archive/.env.prod"
tar -czf "$work/env.tar.gz" -C "$work/archive" .env.prod
GNUPGHOME="$work/gnupg"
export GNUPGHOME

# Passphrase über fd 3, nie als Argument (sonst stünde sie in der Prozessliste).
status=0
gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase-fd 3 --output "$tmp" "$work/env.tar.gz" 3<<PASS || status=$?
$SECRETS_BACKUP_PASSPHRASE
PASS
if [ "$status" -ne 0 ] || [ ! -s "$tmp" ]; then
  echo "✗ Secrets-Backup: Verschlüsseln von .env.prod fehlgeschlagen" >&2
  exit 1
fi
mv -f "$tmp" "$target"

find "$out_dir" -maxdepth 1 -type f -name 'env-prod-*.tar.gz.gpg' -mtime "+$keep_days" -exec rm -f {} +
echo "Secrets backup created: secrets/$(basename "$target")"
