#!/bin/sh
# Log-Rotation für prod (WP-022, D-025): Server- und nginx-Logs enthalten IP-Adressen und dürfen höchstens
# 14 Tage aufbewahrt werden. Docker rotiert seine Container-Logs nur nach Größe, deshalb schreiben server und web
# ihre Request-Logs in Dateien (Volumes, eingehängt unter LOG_DIR) und dieser Dienst rotiert sie nach Zeit.
#
# Ablauf (busybox-sh im Dienst logrotate von compose.prod.yml, auf dem Mac auch im Test scripts/test/log-rotate.test.mjs):
#   - Einmal pro Kalendertag (UTC) wird jede nicht leere *.log-Datei nach <datei>.<JJJJMMTTTHHMMSSZ> kopiert und
#     geleert (copytruncate: die Dienste schreiben mit O_APPEND weiter, kein Signal nötig).
#   - Rotierte Dateien werden gelöscht, sobald sie älter als LOG_DELETE_AFTER_DAYS (Standard 12) sind.
#   - Geprüft wird beim Start und dann alle LOG_CHECK_INTERVAL_SECONDS (Standard 3600).
#   Schlimmster Fall für die älteste Zeile: ~25 h in der rotierten Datei + 12 Tage + 1 h Prüfabstand ≈ 13 Tage 2 h < 14 Tage.
#
# Aufruf: rotate.sh once | loop
set -eu

LOG_DIR="${LOG_DIR:-/logs}"
DELETE_AFTER_DAYS="${LOG_DELETE_AFTER_DAYS:-12}"
CHECK_INTERVAL="${LOG_CHECK_INTERVAL_SECONDS:-3600}"
STAMP="$LOG_DIR/.last-rotation"

run_once() {
  # LOG_ROTATE_TODAY nur für Tests (simuliert einen neuen Tag).
  today="${LOG_ROTATE_TODAY:-$(date -u +%Y-%m-%d)}"
  last="$(cat "$STAMP" 2>/dev/null || true)"
  if [ "$last" != "$today" ]; then
    suffix="$(date -u +%Y%m%dT%H%M%SZ)"
    find "$LOG_DIR" -type f -name '*.log' | while IFS= read -r file; do
      if [ -s "$file" ]; then
        cp "$file" "$file.$suffix"
        : >"$file"
        echo "rotiert: $file → $file.$suffix"
      fi
    done
    echo "$today" >"$STAMP"
  fi
  find "$LOG_DIR" -type f -name '*.log.*' -mmin +$((DELETE_AFTER_DAYS * 1440)) | while IFS= read -r file; do
    rm -f "$file"
    echo "gelöscht: $file"
  done
}

case "${1:-}" in
  once) run_once ;;
  loop)
    echo "logrotate: $LOG_DIR, rotierte Dateien werden nach $DELETE_AFTER_DAYS Tagen gelöscht"
    while true; do
      run_once || echo "logrotate: Fehler beim Rotieren" >&2
      sleep "$CHECK_INTERVAL"
    done
    ;;
  *)
    echo "Aufruf: $0 once|loop" >&2
    exit 2
    ;;
esac
