# Poker

Texas Hold'em für Freunde – **nur Spielgeld**. Entwickelt wird auf dem MacBook, gehostet per Docker auf einem Mac Studio, öffentlich über einen Cloudflare-Tunnel.

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

## Prod (Mac Studio)
prod läuft auf dem Mac Studio (`areuss-studio.local`) als Dienst-Nutzer `fleet` aus einem Checkout von `main` unter `~fleet/poker` (D-036, D-038). Das MacBook ist nur Entwicklungsrechner: Alle Befehle unten laufen dort im Arbeitsordner und steuern den Studio per SSH.
```sh
npm run prod:setup               # einmalig: main auf dem Studio (als fleet) klonen, dann dort .env.prod anlegen (npm run prod:ssh)
npm run release                  # dev → main mergen, pushen, Studio holt main, baut neu, Smoke- und E2E-Test
npm run prod:status              # Container, letztes Backup, Health
npm run prod:smoke               # Health + WebSocket prüfen (über eine SSH-Portweiterleitung)
npm run prod:e2e                 # Browser-Test: zwei Test-Konten spielen eine Runde (WP-020)
npm run prod:logs                # Container-Logs folgen
npm run prod:compose -- ps       # beliebiger docker-compose-Befehl für poker-prod auf dem Studio
npm run prod:tunnel:up / prod:down
```
Release, Tunnel-Einrichtung, Backup/Restore, Betrieb nach Neustart und Fehlersuche: [docs/OPERATIONS.md](docs/OPERATIONS.md).

| Branch | Umgebung |
|---|---|
| `dev` | MacBook, http://localhost:4310 |
| `main` | Release (`npm run release`), läuft auf dem Mac Studio, öffentlich über Cloudflare Tunnel unter poker.arthur-reuss.de und poker.deinemudda.win |

## Admin-Sonderfunktionen am Tisch
Admins (Flag nur per CLI, siehe unten) haben am Tisch zwei Extras. Die Mitspieler sehen davon nichts, jede Nutzung steht aber im Admin-Protokoll.
- **Karten der anderen sehen** (D-027): Während einer laufenden Hand auf die verdeckten Karten eines Mitspielers tippen, dann drehen sie sich um. Nochmal tippen dreht sie zurück. Geht nur am eigenen Tisch und nur bei Spielern, die noch nicht gefoldet haben.
- **Eigene Karten austauschen** (D-032): Während der Setzphase auf die eigenen Karten tippen, dann gibt es zwei neue aus dem Restdeck. Das geht beliebig oft, solange man nicht gefoldet hat. Karten von Mitspielern, vom Board oder verbrannte Karten kommen dabei nie in Frage. Die Hand-Historie zeigt danach die tatsächlich gespielten Karten.

Beides verschafft einen großen Vorteil. Admin-Rechte deshalb nur an Vertrauenspersonen geben.

## Admin
Kein Passwort-Reset per Mail (D-011) – Passwörter setzt ein Admin per CLI zurück. Die Skripte brauchen `DATABASE_URL` und laufen mit `tsx` (dev-Abhängigkeit). Benutzernamen sind case-insensitive.
```sh
# dev, vom Host aus (Postgres auf localhost:4312)
export DATABASE_URL=postgres://poker:poker@localhost:4312/poker

# Neues Zufallspasswort erzeugen und einmalig ausgeben; beendet alle Sessions des Users
npm run admin:reset-password -w @poker/server -- <benutzername>
# … oder ein bestimmtes Passwort über stdin setzen (nicht als Argument → landet nicht in der Shell-History)
printf '%s\n' 'neues-passwort' | npm run admin:reset-password -w @poker/server -- <benutzername>

# Admin-Flag setzen bzw. entziehen (nur per CLI, D-029; steht wie Reset im Admin-Protokoll)
npm run admin:make-admin -w @poker/server -- <benutzername>
npm run admin:make-admin -w @poker/server -- <benutzername> --revoke

# Feedback der Spieler lesen (neueste zuerst, Standard: 20, alle Status)
npm run admin:feedback -w @poker/server -- [--status new|read|done|all] [--limit N]
```

In **prod** sind die Skripte mitgebündelt (kein `tsx` nötig) und laufen im Server-Container auf dem Studio (vom MacBook aus):
```sh
npm run prod:compose -- exec server node cli/reset-password.mjs <benutzername>
npm run prod:compose -- exec server node cli/make-admin.mjs <benutzername> [--revoke]
npm run prod:compose -- exec server node cli/feedback.mjs [--status new|read|done|all] [--limit N]
```
Feedback lässt sich auch im Browser unter `/admin/feedback` lesen und dort auf gelesen/erledigt setzen (Details: [docs/OPERATIONS.md](docs/OPERATIONS.md#feedback-lesen)).
Im dev-Container geht es auch ohne `DATABASE_URL` (ist dort gesetzt): `docker compose -p poker-dev exec server npm run admin:reset-password -w @poker/server -- <benutzername>`. Exit-Code `1` bei unbekanntem User oder ungültigem Passwort, `2` bei falschem Aufruf.

Arbeitsweise, Stand und Entscheidungen: [CLAUDE.md](CLAUDE.md) → [docs/WORKFLOW.md](docs/WORKFLOW.md), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md).
