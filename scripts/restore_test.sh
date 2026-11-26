#!/bin/bash
# Rücksicherungs-Test als Lauf der Warteschlange des fleet-Verbunds (Vertrag: fleet-Repo,
# docs/ueberwachung.md „Platz und Sicherungen“). Aufrufer ist der periodische Job
# `ruecksicherung-poker` auf der Maschine der Prod-VM (mac-2, Zeitplan: `ruecksicherung` in
# deploy.toml): Arbeitsverzeichnis = Prod-Checkout, Nutzer `fleet`, DOCKER_HOST = Docker der
# Prod-VM, kein Terminal. Betrieb: docs/OPERATIONS.md „Restore“.
#
#   scripts/restore_test.sh     neueste Tagessicherung aus /Users/Shared/fleet/backups/poker/ in eine
#                               Wegwerf-Datenbank einspielen und prüfen; Prod nie berühren
#
# Wegwerf-Datenbank: ein Container aus dem Postgres-Image von compose.prod.yml (Dienst db), ohne
# Netz, Daten auf tmpfs. Der Dump (plain SQL, gzip) wird mit psql in einer Transaktion eingespielt;
# dann müssen alle Tabellen und der Stand der Migrationen da und die Konten lesbar sein. Der Stand
# darf neuer sein als der Checkout (nach einem Rollback bleibt die Datenbank, docs/OPERATIONS.md).
# Ordner: BACKUP_DIR aus .env.prod (leer = /Users/Shared/fleet/backups/poker), für Proben
# überschreibbar mit RUECKSICHERUNG_ORDNER.
#
# Exit: 0 bestanden, sonst rot (Alarm JobFehlgeschlagen; ohne Erfolg über 9 Tage RuecksicherungAlt),
# 75 nicht gestartet (DOCKER_HOST fehlt). Die erste Zeile mit ❌ nennt, was fehlt, nie einen Inhalt.
# Nach 30 min bricht der Job ab (SIGALRM): der Container geht über `trap … EXIT` weg.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 75
[ -n "${DOCKER_HOST:-}" ] || { echo "❌ DOCKER_HOST fehlt" >&2; exit 75; }
[ -f .env.prod ] || { echo "❌ .env.prod fehlt im Checkout" >&2; exit 1; }

TABELLEN="schema_migrations users sessions tables rounds round_players hands hand_actions feedback admin_audit_log"
env_wert() { sed -n "s/^$1=//p" .env.prod | tail -n 1; }

ordner=${RUECKSICHERUNG_ORDNER:-$(env_wert BACKUP_DIR)}
ordner=${ordner:-/Users/Shared/fleet/backups/poker}
case "$ordner" in
    /*) ;;
    *) echo "❌ BACKUP_DIR in .env.prod ist kein absoluter Pfad" >&2; exit 1 ;;
esac
nutzer=$(env_wert POSTGRES_USER)
nutzer=${nutzer:-poker}
db=$(env_wert POSTGRES_DB)
db=${db:-poker}

# Dateinamen nach festem Muster ohne Leerzeichen, daher ls zulässig; poker-latest ist nur ein Verweis.
# shellcheck disable=SC2012
sicherung=$(ls -1t "$ordner"/daily/"$db"-[0-9]*.sql.gz 2>/dev/null | head -n 1)
[ -n "$sicherung" ] || { echo "❌ keine Tagessicherung in $ordner/daily" >&2; exit 1; }
gzip -t "$sicherung" 2>/dev/null || { echo "❌ $(basename "$sicherung") ist kein gültiges gzip-Archiv" >&2; exit 1; }
image=$(sed -n 's/^ *image: *\(postgres:[^ ]*\) *$/\1/p' compose.prod.yml | head -n 1)
[ -n "$image" ] || { echo "❌ kein Postgres-Image in compose.prod.yml" >&2; exit 1; }
docker image inspect "$image" >/dev/null 2>&1 \
    || { echo "❌ Image $image fehlt in der Prod-VM (erst ausrollen)" >&2; exit 1; }

name="poker-ruecksicherung-$$"
trap 'docker rm -f -v "$name" >/dev/null 2>&1' EXIT
trap 'echo "❌ abgebrochen (Frist)" >&2; exit 1' ALRM TERM
echo "Rücksicherung: $(basename "$sicherung") mit $image"

docker run -d --name "$name" --network none --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER="$nutzer" -e POSTGRES_DB="$db" -e POSTGRES_HOST_AUTH_METHOD=trust \
    "$image" >/dev/null \
    || { echo "❌ Wegwerf-Postgres startet nicht" >&2; exit 1; }
bereit=""
for _ in $(seq 60); do
    # Über TCP: Der Entrypoint startet erst einen Postgres nur auf dem Socket, dann den richtigen.
    if docker exec "$name" pg_isready -U "$nutzer" -d "$db" -h 127.0.0.1 >/dev/null 2>&1; then bereit=1; break; fi
    sleep 1
done
[ -n "$bereit" ] || { echo "❌ Wegwerf-Postgres wird nicht bereit" >&2; exit 1; }

if ! gzip -dc "$sicherung" | docker exec -i "$name" \
    psql -U "$nutzer" -h 127.0.0.1 -d "$db" -v ON_ERROR_STOP=1 -q --single-transaction >/dev/null; then
    echo "❌ Sicherung lässt sich nicht einspielen" >&2
    exit 1
fi

abfrage() { docker exec "$name" psql -U "$nutzer" -h 127.0.0.1 -d "$db" -tAc "$1"; }
for tabelle in $TABELLEN; do
    [ "$(abfrage "SELECT to_regclass('public.$tabelle') IS NOT NULL")" = t ] \
        || { echo "❌ Tabelle $tabelle fehlt nach der Rücksicherung" >&2; exit 1; }
done
stand=$(abfrage "SELECT max(version) FROM schema_migrations")
[[ $stand =~ ^[0-9]{4}_[a-z0-9_]+$ ]] \
    || { echo "❌ Stand der Migrationen fehlt nach der Rücksicherung" >&2; exit 1; }
konten=$(abfrage "SELECT count(*) FROM users") || { echo "❌ Konten nach der Rücksicherung nicht lesbar" >&2; exit 1; }
echo "✅ Rücksicherung bestanden: $(basename "$sicherung"), alle Tabellen da, Migration $stand, $konten Konto/Konten"
