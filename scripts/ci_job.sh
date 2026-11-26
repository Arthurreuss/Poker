#!/bin/bash
# Ein Paket einer Prüfung auf einem Knoten des fleet-Verbunds (Vertrag: fleet-Repo,
# docs/pruefungen.md „Prüfungen in Paketen“). Der Job des Prüfpakets (scripts/pruefung.py, fleet
# `paket_job`) holt den Stand in einen festen Arbeitsordner (git-Checkout, `.venv` und
# `node_modules` bleiben) und ruft:
#
#   scripts/ci_job.sh <argumente>
#
# Argumente nur aus [A-Za-z0-9 =_./-], ohne `..` (Stufennamen, Einstellungen, Pfade im Repo);
# was sie bedeuten, bestimmt das Projekt. Exit = Exit der Prüfung; 75 = Einrichtung gescheitert,
# 2 = Argument ungültig oder Stufe nicht eingerichtet.
# Das Ende der Einrichtung meldet die Zeile `⏱  einrichtung: N s` (fleet zeigt sie je Paket).
# Ergebnisdateien kommen nach `$NOMAD_ALLOC_DIR/data/` (der Aufrufer holt sie danach).
#
# Stufen: `static` (Wächter) ist ab dem ersten Branch eingerichtet. Ohne Argument laufen alle
# eingerichteten; eine Stufe, die das Projekt noch nicht eingerichtet hat, endet mit Exit 2 und
# Hinweis. Eine neue Stufe kommt nach `STUFEN` mit einer Funktion `<stufe>_stufe`, in `DAUER` von
# scripts/pruefung.py und, soll der Zug sie prüfen, in fleet.toml [zug] (Abschnitt Stufen in
# .agents/rules/testing.md).
# Optional `scripts/ci_job.sh live`: Live-Tests gegen die echten Modelle, JUnit nach
# `$FLEET_LIVE_JUNIT` (Jobs `live-poker`, fleet-Repo docs/pruefungen.md „Live-Tests“).
#
# poker: Stellen mit `<...>` anpassen.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 75
exec </dev/null

RUN_LABEL="poker.run"   # Label für alles, was der Lauf in Docker anlegt
setup_start=$SECONDS
say() { echo "ci-job: $*"; }

# Ohne Login-Shell (Nomad, ssh): Werkzeuge hinter dem PATH des Aufrufers.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
# DOCKER_HOST kommt vom Verbund (Socket der Test-VM); es bleibt, wie es kommt. Ohne die Variable
# nimmt das Skript den Socket der Colima-VM, wenn es ihn gibt (lokal, ohne Server).
if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ] && [ -S "$HOME/.colima/default/docker.sock" ]; then
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
fi
# Testcontainers: Der Mac-Pfad des Colima-Sockets existiert in der VM nicht.
case "${DOCKER_HOST:-}" in
    unix://*/.colima/*)
        export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE="${TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE:-/var/run/docker.sock}" ;;
esac

# Lauf-ID: im Job die Allocation-ID von Nomad, sonst eine neue UUID.
if [ -z "${RUN_ID:-}" ]; then
    RUN_ID="${NOMAD_ALLOC_ID:-$( (uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())') | tr '[:upper:]' '[:lower:]')}"
fi
if ! [[ $RUN_ID =~ ^[A-Za-z0-9_.-]{1,64}$ ]]; then
    say "ungültige RUN_ID '$RUN_ID'"
    exit 2
fi
export RUN_ID

# Nur Ressourcen mit dem Label dieses Laufs; nie maschinenweit aufräumen, es laufen andere
# Läufe daneben. Docker-Anlagen des Laufs bekommen `--label "$RUN_LABEL=$RUN_ID"`.
docker_cleanup() (
    trap '' PIPE
    command -v docker >/dev/null 2>&1 || return 0
    local filter="label=$RUN_LABEL=$RUN_ID" containers networks volumes
    containers=$(docker ps -aq --filter "$filter" 2>/dev/null)
    # shellcheck disable=SC2086
    [ -z "$containers" ] || docker rm -f -v $containers >/dev/null 2>&1
    networks=$(docker network ls -q --filter "$filter" 2>/dev/null)
    # shellcheck disable=SC2086
    [ -z "$networks" ] || docker network rm $networks >/dev/null 2>&1
    volumes=$(docker volume ls -q --filter "$filter" 2>/dev/null)
    # shellcheck disable=SC2086
    [ -z "$volumes" ] || docker volume rm $volumes >/dev/null 2>&1
    say "Docker aufgeräumt ($RUN_LABEL=$RUN_ID)"
)

if [ "${1:-}" = "--cleanup" ]; then
    docker_cleanup
    exit 0
fi

stages=()
for arg in "$@"; do
    case "$arg" in
        *..*) say "ungültiges Argument '$arg'"; exit 2 ;;
        *=*) say "unbekannte Einstellung '$arg'"; exit 2 ;;
        *) stages+=("$arg") ;;
    esac
done
STUFEN=(static)
[ "${#stages[@]}" -gt 0 ] || stages=("${STUFEN[@]}")
for stage in "${stages[@]}"; do
    case " ${STUFEN[*]} " in
        *" $stage "*) ;;
        *) say "Stufe '$stage' ist nicht eingerichtet (eingerichtet: ${STUFEN[*]}; Abschnitt Stufen in .agents/rules/testing.md)"
           exit 2 ;;
    esac
done

trap docker_cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Einrichtung: installieren, was fehlt (uv sync, npm ci nur bei geändertem Lockfile).
# poker: anpassen, bei Fehlschlag `exit 75`.
# uv sync --frozen -q || { say "uv sync gescheitert"; exit 75; }
# Die Wächter brauchen Python ab 3.11 (tomllib), sonst Python 3.12 über uv.
py=(python3)
if ! python3 -c 'import tomllib' >/dev/null 2>&1; then
    command -v uv >/dev/null 2>&1 || { say "python3 ab 3.11 oder uv fehlt"; exit 75; }
    py=(uv run -q --python 3.12 --no-project python)
fi

# Test-Postgres des Verbunds: ist FLEET_TEST_POSTGRES_URL gesetzt, nutzt die Testsuite ihn
# (Vorlage-Datenbanken `poker_tpl_<hash>`, Läufe `poker_lauf_<alloc8>_…`), sonst startet
# sie einen eigenen. Das Skript reicht die Variablen unverändert durch.
[ -z "${NOMAD_ALLOC_DIR:-}" ] || mkdir -p "$NOMAD_ALLOC_DIR/data"

# Marke für die Messung (fleet-Repo docs/pruefungen.md „Buchung je Paket“): direkt bevor die
# Worker starten, wenn Server und Datenbank schon laufen. Was vorher lief, ist Einrichtung; was
# davon weiterläuft, Grundlast; der Rest zählt je Worker. Ohne Marke zählt alles je Worker.
einheiten_starten() { [ -z "${FLEET_MESSEN_EINHEITEN:-}" ] || : >"$FLEET_MESSEN_EINHEITEN"; }

# Vorarbeit (fleet-Repo docs/pruefungen.md „Vorarbeit“): was mehrere Pakete gleich bauen (etwa das
# Frontend), einmal je Maschine und Stand; lokal läuft nur der Befehl. Wer darauf wartet, startet
# derweil Unabhängiges (Server, Migrationen) und wartet erst, wo das Ergebnis gebraucht wird:
#   vorarbeit --name web-dist --ergebnis web/dist --quelle web --quelle ':!web/e2e' -- npm --prefix web run build &
#   bau=$!; <server starten>; wait "$bau" || exit 1
vorarbeit() {
    if [ -n "${FLEET_VORARBEIT:-}" ]; then
        python3 "$FLEET_VORARBEIT" "$@"
        return
    fi
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
    shift
    "$@"
}

say "Lauf $RUN_ID auf $(hostname -s), Stufen: ${stages[*]}"
echo "⏱  einrichtung: $((SECONDS - setup_start)) s"
# Je Stufe eine Funktion `<stufe>_stufe`, rot bei Exit ungleich 0. Ergebnisdateien (Coverage,
# Testzeiten) nach "$NOMAD_ALLOC_DIR/data/". Beispiel für Tests mit Workern, ihre Zahl nur aus
# `FLEET_EINHEITEN` (Einheiten des Pakets nach Buchung), nie aus den Kernen:
#   test_stufe() { einheiten_starten; uv run pytest -n "${FLEET_EINHEITEN:-1}"; }
static_stufe() {
    local rot=0
    "${py[@]}" scripts/check_struktur.py || rot=1
    "${py[@]}" scripts/check_drift.py || rot=1
    "${py[@]}" scripts/adr.py || rot=1
    "${py[@]}" scripts/check_gespiegelt.py || rot=1
    return "$rot"
}
ergebnis=0
for stage in "${stages[@]}"; do
    stufe_rot=0
    "${stage}_stufe" || stufe_rot=1
    say "Stufe $stage: $([ "$stufe_rot" -eq 0 ] && echo grün || echo rot)"
    [ "$stufe_rot" -eq 0 ] || ergebnis=1
done
exit "$ergebnis"
