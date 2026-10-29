#!/usr/bin/env bash
# Deploy und Rollback von prod als Lauf der Warteschlange (D-039, fleet README Abschnitt 2a). Aufrufer ist der
# Nomad-Job deploy-poker des Verbunds auf dem Studio, nicht ein Mensch: Er hat den Checkout (~fleet/poker) schon
# geholt, beim Deploy auf origin/main vorgespult und geprüft, dass <ref> auf main liegt; DOCKER_HOST zeigt auf die
# Prod-VM. Von hier aus: npm run prod:deploy / prod:rollback (scripts/fleet-deploy.sh).
#   scripts/deploy_job.sh deploy [<ref>]   prod aus <ref> bauen und starten (ohne <ref>: Stand des Checkouts = main)
#   scripts/deploy_job.sh rollback <ref>   prod aus dem früheren Stand <ref> bauen und starten (Checkout detached;
#                                          der nächste Deploy setzt ihn zurück auf main)
# Mit Tunnel, wenn TUNNEL_TOKEN in .env.prod steht (wie release.sh). Exit (Vertrag des Verbunds): 0 prod läuft
# gesund, 1 Start fehlgeschlagen (prod prüfen), 2 Aufruf ungültig, 75 nicht gestartet (nichts verändert).
# Compose-Projekt aus FLEET_DEPLOY_COMPOSE (Eintrag in deploy.toml des Verbunds, Standard poker-prod), z. B. für eine
# Test-Instanz. Tests: POKER_DEPLOY_PROD_SH ersetzt scripts/prod.sh.
set -uo pipefail

# Alles in einer Funktion: bash liest sie ganz, bevor git checkout diese Datei im Checkout austauscht.
main() {
  local aktion="${1:-}" ref="${2:-}"
  case "$aktion" in
    deploy) ;;
    rollback)
      [ -n "$ref" ] || {
        echo "✗ rollback braucht den Stand, auf den zurück (Commit oder Tag auf main)" >&2
        return 2
      }
      ;;
    *)
      echo "Aufruf: $0 deploy [<ref>] | rollback <ref>" >&2
      return 2
      ;;
  esac
  [ $# -le 2 ] || {
    echo "✗ zu viele Argumente" >&2
    return 2
  }

  cd "$(dirname "$0")/.." || return 75
  local dir
  dir="$(pwd)"
  if [ ! -f .env.prod ]; then
    echo "✗ .env.prod fehlt in $dir (docs/OPERATIONS.md) – nichts verändert" >&2
    return 75
  fi
  if [ -n "$ref" ]; then
    local sha
    sha="$(git rev-parse -q --verify "$ref^{commit}")" || {
      echo "✗ $ref gibt es im Checkout nicht" >&2
      return 2
    }
    if [ "$sha" != "$(git rev-parse HEAD)" ]; then
      git checkout -q --detach "$sha" || {
        echo "✗ git checkout $ref fehlgeschlagen – nichts verändert" >&2
        return 75
      }
    fi
  fi

  local action=up
  if [ -n "$(sed -n 's/^TUNNEL_TOKEN=//p' .env.prod | tail -n 1)" ]; then action=tunnel-up; fi
  echo "→ $aktion: prod.sh $action aus $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"
  if ! POKER_PROD_DIR="$dir" PROD_PROJECT="${FLEET_DEPLOY_COMPOSE:-poker-prod}" bash "${POKER_DEPLOY_PROD_SH:-scripts/prod.sh}" "$action"; then
    echo "✗ prod.sh $action fehlgeschlagen – prod prüfen (npm run prod:status, prod:logs)" >&2
    return 1
  fi
  echo "✓ prod läuft aus $(git rev-parse --short HEAD)"
}

main "$@"
exit $?
