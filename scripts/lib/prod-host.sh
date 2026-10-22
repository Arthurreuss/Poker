# Verbindung zum prod-Host (D-036). Wird per "." eingebunden (bash), auf dem Entwicklungsrechner.
# prod läuft auf dem Mac Studio aus einem Checkout von main; die prod-Skripte laufen dort per SSH.
#   POKER_PROD_HOST        SSH-Ziel                        (Standard: areuss-studio.local)
#   POKER_PROD_REMOTE_DIR  Checkout auf dem Host, relativ zu ~ (Standard: poker)
#   POKER_PROD_SSH         SSH-Befehl, für Tests ersetzbar  (Standard: ssh)

POKER_PROD_HOST="${POKER_PROD_HOST:-areuss-studio.local}"
POKER_PROD_REMOTE_DIR="${POKER_PROD_REMOTE_DIR:-poker}"
POKER_PROD_SSH="${POKER_PROD_SSH:-ssh}"
POKER_PROD_REPO_URL="${POKER_PROD_REPO_URL:-https://github.com/Arthurreuss/Poker.git}"

# Docker Desktop und Homebrew liegen nicht im PATH einer SSH-Sitzung ohne Login-Shell.
PROD_REMOTE_PATH='export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"'

# Führt einen Befehl (als ein String) auf dem Host aus, im Checkout. Mit -t bei interaktivem Terminal
# (Rückfragen wie in prod:restore, logs -f mit Strg-C).
prod_remote() {
  local tty=""
  if [ -t 0 ] && [ -t 1 ]; then tty=-t; fi
  # shellcheck disable=SC2086
  $POKER_PROD_SSH $tty -o ConnectTimeout=10 "$POKER_PROD_HOST" \
    "$PROD_REMOTE_PATH; cd ~/$POKER_PROD_REMOTE_DIR && $1"
}

# Wie prod_remote, aber ohne Terminal und ohne cd (für Prüfungen, ob der Checkout existiert).
prod_remote_raw() {
  # shellcheck disable=SC2086
  $POKER_PROD_SSH -o ConnectTimeout=10 "$POKER_PROD_HOST" "$PROD_REMOTE_PATH; $1"
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
