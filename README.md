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
- Health: http://localhost:4310/api/health (über den Vite-Proxy) bzw. http://localhost:4311/api/health
- Postgres: `localhost:4312`, Benutzer/Passwort/DB `poker` (nur dev)

Der DB-Integrationstest läuft nur mit gesetzter `DATABASE_URL` (sonst übersprungen):
```sh
DATABASE_URL=postgres://poker:poker@localhost:4312/poker npm test
```
Nach Änderungen an Abhängigkeiten `npm run dev:up` erneut ausführen (baut das Image neu).

| Branch | Umgebung |
|---|---|
| `dev` | lokal testen, http://localhost:4310 |
| `main` | Release, später öffentlich über Cloudflare Tunnel |

Arbeitsweise, Stand und Entscheidungen: [CLAUDE.md](CLAUDE.md) → [docs/WORKFLOW.md](docs/WORKFLOW.md), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md).
