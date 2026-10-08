# Betrieb

Wie dev und prod gestartet, gestoppt und released werden und wie der Cloudflare-Tunnel eingerichtet wird. Aufbau der Umgebungen: [ARCHITECTURE.md](ARCHITECTURE.md); Begründungen: D-002, D-005, D-006, D-010, D-014 in [DECISIONS.md](DECISIONS.md).

| | dev | prod |
|---|---|---|
| Branch | `dev` | `main` |
| Compose | `compose.dev.yml`, Projekt `poker-dev` | `compose.prod.yml`, Projekt `poker-prod` |
| Konfiguration | `.env` (optional, Vorlage `.env.example`) | `.env.prod` (Pflicht, Vorlage `.env.prod.example`) |
| App | http://localhost:4310 | http://localhost:4320, öffentlich https://poker.arthur-reuss.de (Tunnel) |
| Server direkt | http://localhost:4311 | http://localhost:4321 (nur Debugging) |
| Datenbank | `localhost:4312`, Volume `poker-dev-db` | nicht nach außen, Volume `poker-prod-db` |

Beide Umgebungen laufen gleichzeitig, ohne sich zu stören (eigene Projekte, Netze, Volumes, Ports). Alle Befehle nur über die npm-Skripte – sie fassen ausschließlich `poker-dev` bzw. `poker-prod` an, nie andere Container (z. B. Jarvis).

## dev
```sh
npm run dev:up     # bauen und starten (Hot-Reload)
npm run dev:logs   # Logs folgen
npm run dev:down   # stoppen, Volume poker-dev-db bleibt
```
Details: [README.md](../README.md#entwicklung-starten).

## prod
Einmalig `.env.prod` anlegen (gitignored, nie committen):
```sh
cp .env.prod.example .env.prod
# POSTGRES_PASSWORD setzen, z. B. Ausgabe von: openssl rand -hex 24
```

```sh
npm run prod:up          # baut die Images aus dem aktuellen Checkout und startet db, server, web (ohne Tunnel); wartet auf healthy
npm run prod:smoke       # Smoke-Test: /api/health und WebSocket über http://localhost:4320
npm run prod:logs        # Logs folgen
npm run prod:tunnel:up   # wie prod:up, zusätzlich cloudflared (braucht TUNNEL_TOKEN)
npm run prod:down        # alles stoppen inkl. cloudflared, Volume poker-prod-db bleibt
```
- Ohne `.env.prod` bricht `prod:up` mit Hinweis ab; `prod:tunnel:up` bricht ab, solange `TUNNEL_TOKEN` leer ist.
- Container haben `restart: unless-stopped`: nach einem Neustart von Docker Desktop laufen sie wieder, nach `prod:down` nicht.
- `POSTGRES_PASSWORD` wirkt nur beim **ersten** Start mit leerem Volume. Passwort später ändern = in Postgres ändern (`ALTER USER`) oder – nur ohne echte Daten – Volume löschen: `docker volume rm poker-prod-db`.
- Der Smoke-Test schickt als `Origin` den Wert von `PUBLIC_ORIGIN` aus `.env.prod`; andere Ziele per `SMOKE_URL=… SMOKE_ORIGIN=… npm run prod:smoke`.

## Release
`npm run release` (Skript `scripts/release.sh`):
1. prüft: auf `dev`, Arbeitsverzeichnis sauber, `.env.prod` vorhanden
2. `npm run check`
3. `git checkout main && git merge --no-ff dev`
4. `git push origin main dev`
5. `npm run prod:up` (baut aus `main`)
6. `npm run prod:smoke`
7. zurück auf `dev` (auch bei Fehlern)

Vorher dev lokal per Docker getestet haben (D-005). Schlägt der Smoke-Test fehl, steht main schon auf dem neuen Stand: Fehler auf dev beheben und erneut releasen.

## Cloudflare-Tunnel einrichten (Arthur, einmalig)
Poker bekommt einen **eigenen** Tunnel mit eigenem `cloudflared`-Container im Projekt `poker-prod` (D-014). Der Jarvis-Tunnel und sein Container bleiben unberührt – nichts davon anfassen oder umkonfigurieren.

1. https://one.dash.cloudflare.com → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Typ **Cloudflared** wählen, Name `poker`, speichern.
3. Bei „Install and run a connector“ eine beliebige Umgebung (z. B. Docker) wählen und aus dem angezeigten Befehl **nur das Token** kopieren (die lange Zeichenkette nach `--token`). Den Befehl selbst **nicht** ausführen.
4. Token in `.env.prod` eintragen: `TUNNEL_TOKEN=<token>` (die Datei ist gitignored; Token nirgends sonst ablegen).
5. Im Tunnel unter **Public Hostname** (bzw. „Published application routes“) → **Add**:
   - Subdomain `poker`, Domain `arthur-reuss.de`, Pfad leer
   - Service: Typ `HTTP`, URL `web:8080` (also `http://web:8080` – der Web-Container im Compose-Netz, nicht `localhost`)
6. Im Cloudflare-Dashboard der Domain `arthur-reuss.de` → **Network** → **WebSockets** muss **an** sein (Standard).
7. `PUBLIC_ORIGIN=https://poker.arthur-reuss.de` in `.env.prod` prüfen (exakt so, ohne Slash am Ende).
8. `npm run prod:tunnel:up`, dann `npm run prod:logs` – cloudflared meldet „Registered tunnel connection“; im Dashboard steht der Tunnel auf **Healthy**.
9. https://poker.arthur-reuss.de öffnen; Prüfen gegen die echte Domain: `SMOKE_URL=https://poker.arthur-reuss.de npm run prod:smoke`.

Tunnel stoppen: `npm run prod:down` (stoppt die ganze prod-Umgebung). Token erneuern: im Dashboard „Refresh token“, `.env.prod` aktualisieren, `npm run prod:tunnel:up`.

## Fehlersuche
- `npm run prod:logs` bzw. `docker compose -p poker-prod ps` (Status inkl. Healthchecks).
- Server direkt: `curl http://localhost:4321/api/health`.
- WebSocket-Upgrade mit `403`: `Origin` passt nicht zu `PUBLIC_ORIGIN`.
- Server startet nicht, Log „password authentication failed“: Volume `poker-prod-db` wurde mit einem anderen Passwort angelegt (siehe oben).
