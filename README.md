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

| Branch | Umgebung |
|---|---|
| `dev` | lokal testen, http://localhost:4310 |
| `main` | Release, später öffentlich über Cloudflare Tunnel |

Arbeitsweise, Stand und Entscheidungen: [CLAUDE.md](CLAUDE.md) → [docs/WORKFLOW.md](docs/WORKFLOW.md), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md).
