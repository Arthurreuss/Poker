# Poker

Texas Hold'em für Freunde – **nur Spielgeld**, läuft per Docker auf dem eigenen Rechner.

## Setup
Voraussetzung: Node 22 (`.nvmrc`, z. B. `nvm use`).
```sh
npm ci          # Abhängigkeiten aller Workspaces installieren
npm run setup   # einmalig: aktiviert den Pre-Commit-Hook
npm run check   # Doku-Check + Typecheck + Lint + Tests
```
Einzeln: `npm run typecheck`, `npm run lint`, `npm test`, `npm run format`. Aufbau und Skripte: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Entwicklung starten
Voraussetzung: Docker Desktop.
```sh
cp .env.example .env   # optional – alle Werte haben Defaults
npm run dev:up         # baut und startet Postgres, Server und Web (Projekt poker-dev)
npm run dev:logs       # Logs folgen
npm run dev:down       # stoppen (DB-Volume poker-dev-db bleibt)
```
- App: http://localhost:4310 (Hot-Reload für `apps/web` und `apps/server`)
- Frontend allein gegen den laufenden dev-Server (z. B. aus einem Worktree): `API_PROXY_TARGET=http://localhost:4311 WEB_DEV_PORT=4315 npm run dev -w @poker/web`
- Prod-Build des Frontends inkl. PWA (Manifest, Service Worker): `npm run build -w @poker/web`, ansehen mit `npm run preview -w @poker/web`; Icons neu erzeugen: `npm run icons -w @poker/web` (Aufbau: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), Abschnitt „Frontend“)
- Health: http://localhost:4310/api/health (über den Vite-Proxy) bzw. http://localhost:4311/api/health
- Postgres: `localhost:4312`, Benutzer/Passwort/DB `poker` (nur dev)

DB-Integrationstests (Schema, Migrationen, Auth) gegen die Test-DB `poker_test`: `npm run test:db -w @poker/server`.
Der Health-Integrationstest läuft nur mit gesetzter `DATABASE_URL` (sonst übersprungen):
```sh
DATABASE_URL=postgres://poker:poker@localhost:4312/poker npm test
```
Nach Änderungen an Abhängigkeiten `npm run dev:up` erneut ausführen (baut das Image neu).

## Prod lokal starten
```sh
cp .env.prod.example .env.prod   # POSTGRES_PASSWORD setzen (gitignored)
npm run prod:up                  # Projekt poker-prod unter http://localhost:4320 (läuft parallel zu dev)
npm run prod:smoke               # Health + WebSocket prüfen
npm run prod:down
```
Release, Tunnel-Einrichtung und Fehlersuche: [docs/OPERATIONS.md](docs/OPERATIONS.md).

| Branch | Umgebung |
|---|---|
| `dev` | lokal testen, http://localhost:4310 |
| `main` | Release (`npm run release`), lokal http://localhost:4320, öffentlich über Cloudflare Tunnel unter poker.arthur-reuss.de |

## Admin
Kein Passwort-Reset per Mail (D-011) – Passwörter setzt ein Admin per CLI zurück. Die Skripte brauchen `DATABASE_URL` und laufen mit `tsx` (dev-Abhängigkeit). Benutzernamen sind case-insensitive.
```sh
# dev, vom Host aus (Postgres auf localhost:4312)
export DATABASE_URL=postgres://poker:poker@localhost:4312/poker

# Neues Zufallspasswort erzeugen und einmalig ausgeben; beendet alle Sessions des Users
npm run admin:reset-password -w @poker/server -- <benutzername>
# … oder ein bestimmtes Passwort über stdin setzen (nicht als Argument → landet nicht in der Shell-History)
printf '%s\n' 'neues-passwort' | npm run admin:reset-password -w @poker/server -- <benutzername>

# Admin-Flag setzen bzw. entziehen
npm run admin:make-admin -w @poker/server -- <benutzername>
npm run admin:make-admin -w @poker/server -- <benutzername> --revoke
```

In **prod** sind die Skripte mitgebündelt (kein `tsx` nötig) und laufen im Server-Container:
```sh
docker compose -p poker-prod exec server node cli/reset-password.mjs <benutzername>
docker compose -p poker-prod exec server node cli/make-admin.mjs <benutzername> [--revoke]
```
Im dev-Container geht es auch ohne `DATABASE_URL` (ist dort gesetzt): `docker compose -p poker-dev exec server npm run admin:reset-password -w @poker/server -- <benutzername>`. Exit-Code `1` bei unbekanntem User oder ungültigem Passwort, `2` bei falschem Aufruf.

Arbeitsweise, Stand und Entscheidungen: [CLAUDE.md](CLAUDE.md) → [docs/WORKFLOW.md](docs/WORKFLOW.md), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md).
