#!/usr/bin/env bash
# Deploy oder Rollback von prod über die Warteschlange des Server-Verbunds (D-039): startet den Nomad-Job
# deploy-poker auf dem Studio (fleet.py deploy) und zeigt sein Log bis zum Ende. Dort läuft scripts/deploy_job.sh.
#   scripts/fleet-deploy.sh deploy [<ref>]    npm run prod:deploy [-- <ref>]
#   scripts/fleet-deploy.sh rollback <ref>    npm run prod:rollback -- <ref>
# Exit = Exit des Laufs (0 gut, 1 fehlgeschlagen, 2 Aufruf ungültig, 75 nicht gestartet: schon ein Lauf offen,
# Nomad nicht erreichbar oder Voraussetzung auf dem Studio fehlt).
#   POKER_FLEET_DIR   Checkout des fleet-Repos (Standard: ~/code/Arthurreuss/fleet)
#   POKER_FLEET_CMD   Befehl statt "uv run … fleet.py" (Tests)
set -uo pipefail

aktion="${1:-}"
ref="${2:-}"
case "$aktion" in
  deploy) ;;
  rollback)
    [ -n "$ref" ] || {
      echo "Aufruf: $0 rollback <ref>   (der Stand, auf den zurück; release-verify.sh nennt ihn)" >&2
      exit 2
    }
    ;;
  *)
    echo "Aufruf: $0 deploy [<ref>] | rollback <ref>" >&2
    exit 2
    ;;
esac

fleet_dir="${POKER_FLEET_DIR:-$HOME/code/Arthurreuss/fleet}"
if [ -n "${POKER_FLEET_CMD:-}" ]; then
  read -r -a fleet <<<"$POKER_FLEET_CMD"
else
  [ -f "$fleet_dir/fleet.py" ] || {
    echo "✗ fleet-Repo fehlt in $fleet_dir (POKER_FLEET_DIR setzen) – nichts verändert" >&2
    exit 75
  }
  fleet=(uv run --quiet --python 3.12 --no-project "$fleet_dir/fleet.py")
fi

args=(deploy poker)
[ -n "$ref" ] && args+=("$ref")
[ "$aktion" = rollback ] && args+=(--rollback)
"${fleet[@]}" "${args[@]}"
