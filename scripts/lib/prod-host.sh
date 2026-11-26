# Verbindung zum prod-Host (D-036, D-038). Wird per "." eingebunden (bash), auf dem Entwicklungsrechner.
# prod läuft auf mac-2 unter dem Dienst-Nutzer fleet aus einem Checkout von main (~fleet/poker), Docker in der
# Prod-VM prod-spiele des Server-Verbunds (fleet prod.toml, deploy.toml [poker]); die prod-Skripte laufen dort per SSH.
#   POKER_PROD_HOST        SSH-Ziel                        (Standard: fleet@mac-2, Tailscale-Name)
#   POKER_PROD_REMOTE_DIR  Checkout auf dem Host, relativ zu ~ (Standard: poker)
#   POKER_PROD_COLIMA      Colima-Profil der Prod-VM auf dem Host (Standard: spiele); Docker über
#                          DOCKER_HOST=unix://$HOME/.colima/<profil>/docker.sock, wie im Deploy-Job
#   POKER_PROD_SSH         SSH-Befehl, für Tests ersetzbar  (Standard: ssh)
#   POKER_PROD_REPO_URL    Quelle für prod:setup; Standard über den Host-Alias github-poker (Deploy-Key in ~/.ssh/config des Nutzers)

POKER_PROD_HOST="${POKER_PROD_HOST:-fleet@mac-2}"
POKER_PROD_REMOTE_DIR="${POKER_PROD_REMOTE_DIR:-poker}"
POKER_PROD_COLIMA="${POKER_PROD_COLIMA:-spiele}"
POKER_PROD_SSH="${POKER_PROD_SSH:-ssh}"
POKER_PROD_REPO_URL="${POKER_PROD_REPO_URL:-git@github-poker:Arthurreuss/Poker.git}"

# Umgebung jeder SSH-Sitzung auf dem Host. Docker-CLI und git kommen von Homebrew (/opt/homebrew/bin), das nicht
# im PATH einer SSH-Sitzung ohne Login-Shell liegt; /usr/local/bin bleibt harmlos im PATH (Intel-Homebrew, alte
# Installationen). DOCKER_HOST zeigt auf den Socket der Prod-VM, nicht auf das Standard-Profil von Colima.
case "$POKER_PROD_COLIMA" in
  '' | *[!A-Za-z0-9._-]*)
    echo "✗ POKER_PROD_COLIMA ungültig: '$POKER_PROD_COLIMA' (nur Buchstaben, Ziffern, . _ -)" >&2
    exit 2
    ;;
esac
PROD_REMOTE_ENV="export PATH=\"/usr/local/bin:/opt/homebrew/bin:\$PATH\" DOCKER_HOST=\"unix://\$HOME/.colima/$POKER_PROD_COLIMA/docker.sock\""

# Führt einen Befehl (als ein String) auf dem Host aus, im Checkout. Mit -t bei interaktivem Terminal
# (Rückfragen wie in prod:restore, logs -f mit Strg-C).
prod_remote() {
  local tty=""
  if [ -t 0 ] && [ -t 1 ]; then tty=-t; fi
  # shellcheck disable=SC2086
  $POKER_PROD_SSH $tty -o ConnectTimeout=10 "$POKER_PROD_HOST" \
    "$PROD_REMOTE_ENV; cd ~/$POKER_PROD_REMOTE_DIR && $1"
}

# Wie prod_remote, aber ohne Terminal und ohne cd (für Prüfungen, ob der Checkout existiert).
prod_remote_raw() {
  # shellcheck disable=SC2086
  $POKER_PROD_SSH -o ConnectTimeout=10 "$POKER_PROD_HOST" "$PROD_REMOTE_ENV; $1"
}

# Führt ein prod-Skript im Checkout auf dem Host aus; Argumente werden sicher gequotet.
prod_remote_script() {
  local script="$1"
  shift
  local args=""
  if [ $# -gt 0 ]; then args="$(printf ' %q' "$@")"; fi
  prod_remote "POKER_PROD_DIR=\"\$HOME/$POKER_PROD_REMOTE_DIR\" bash scripts/$script$args"
}

# Wert aus der .env.prod auf dem Host (ohne sie auszuführen); leer, wenn nicht gesetzt.
prod_remote_env_value() {
  prod_remote_raw "sed -n 's/^$1=//p' ~/$POKER_PROD_REMOTE_DIR/.env.prod 2>/dev/null | tail -n 1"
}
