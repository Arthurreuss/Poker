#!/usr/bin/env bash
# Kurzer Zustandsbericht der prod-Umgebung (WP-021). Aufruf: npm run prod:status
# Zeigt Container-Status/Health, letztes Backup (Zeitpunkt, Größe, Alter), Speicherplatz des Backup-Ordners
# und den Health-Endpoint (lokal und – falls erreichbar – öffentlich). Exit-Code 1, wenn etwas nicht stimmt.
# Doku: docs/OPERATIONS.md, Abschnitt "Status".
set -euo pipefail
. "$(dirname "$0")/lib/prod-env.sh"

# Ein Backup älter als das gilt als überfällig (täglicher Lauf + Puffer).
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-26}"
problems=0
ok() { echo "  ✓ $*"; }
bad() {
  echo "  ✗ $*"
  problems=$((problems + 1))
}
warn() { echo "  ! $*"; }

# Änderungszeit einer Datei in Sekunden seit Epoch (macOS/BSD und GNU).
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"; }

require_env_file

echo "Container ($PROD_PROJECT):"
expected="db server web backup"
running="$($COMPOSE --env-file "$ENV_FILE" ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
if [ -n "$(env_value TUNNEL_TOKEN)" ]; then expected="$expected cloudflared"; fi
for service in $expected; do
  line="$(echo "$running" | awk -v s="$service" '$1 == s' | head -n 1)"
  state="$(echo "$line" | awk '{print $2}')"
  health="$(echo "$line" | awk '{print $3}')"
  if [ -z "$line" ]; then
    if [ "$service" = cloudflared ]; then
      warn "cloudflared: nicht gestartet (Tunnel: npm run prod:tunnel:up)"
    else
      bad "$service: kein Container"
    fi
  elif [ "$state" != running ]; then
    bad "$service: $state"
  elif [ -n "$health" ] && [ "$health" != healthy ]; then
    bad "$service: running, $health"
  else
    ok "$service: running${health:+, $health}"
  fi
done

echo "Backups ($BACKUP_DIR):"
latest="$(ls -t "$BACKUP_DIR/last/$POSTGRES_DB_VALUE"-[0-9]*.sql.gz 2>/dev/null | head -n 1 || true)"
if [ -z "$latest" ]; then
  bad "noch kein Backup vorhanden (sofort: npm run prod:backup)"
else
  age_hours=$((($(date +%s) - $(mtime "$latest")) / 3600))
  when="$(date -r "$(mtime "$latest")" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$(mtime "$latest")" '+%Y-%m-%d %H:%M')"
  size="$(du -h "$latest" | cut -f1 | tr -d ' ')"
  info="letztes Backup $when ($size, vor ${age_hours} h): $(basename "$latest")"
  if [ "$age_hours" -ge "$MAX_BACKUP_AGE_HOURS" ]; then bad "$info – älter als $MAX_BACKUP_AGE_HOURS h"; else ok "$info"; fi
  count="$(find "$BACKUP_DIR" -name "$POSTGRES_DB_VALUE-[0-9]*.sql.gz" -type f | wc -l | tr -d ' ')"
  ok "Dateien: $count, Ordner gesamt $(du -sh "$BACKUP_DIR" | cut -f1 | tr -d ' ')"
fi
if [ -d "$BACKUP_DIR" ]; then
  # df -P: stabile Spalten auf macOS und Linux (Kilobyte-Blöcke).
  free_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 {print $4}')"
  free_h="$(df -h "$BACKUP_DIR" | awk 'NR == 2 {print $4}')"
  if [ "$free_kb" -lt 1048576 ]; then bad "freier Speicher: $free_h (< 1 GB)"; else ok "freier Speicher: $free_h"; fi
fi

echo "Health:"
local_url="http://localhost:$WEB_PORT_VALUE/api/health"
if body="$(curl -fsS -m 5 "$local_url" 2>&1)"; then ok "$local_url → $body"; else bad "$local_url → $body"; fi
# Mehrere Origins (D-023): Health über die erste (Hauptadresse).
public_origin="$(env_value PUBLIC_ORIGIN | cut -d, -f1 | tr -d ' ')"
if [ -n "$public_origin" ] && [ -n "$(env_value TUNNEL_TOKEN)" ]; then
  public_url="$public_origin/api/health"
  if body="$(curl -fsS -m 10 "$public_url" 2>&1)"; then ok "$public_url → $body"; else bad "$public_url → $body"; fi
fi

if [ "$problems" -eq 0 ]; then
  echo "✓ Alles in Ordnung."
else
  echo "✗ $problems Problem(e) – Details: docs/OPERATIONS.md, Abschnitt \"Status\"."
  exit 1
fi
