# Architektur

_Wird mit den ersten Code-WPs gefüllt. Beschreibt immer den **aktuellen** Stand, nicht Pläne – Pläne stehen in den WPs._

## Komponenten
npm-Workspaces-Monorepo (D-004). Alle Workspaces sind TypeScript (ESM, `strict`).

| Workspace | Paket | Zweck |
|---|---|---|
| `packages/engine` | `@poker/engine` | reine Poker-Logik, keine I/O-Abhängigkeiten |
| `apps/server` | `@poker/server` | Game-Server: Fastify mit `GET /api/health` (prüft die DB per `pg`) und Platzhalter-WebSocket `/ws` (`ws`); importiert `@poker/engine` |
| `apps/web` | `@poker/web` | Frontend: React + Vite, derzeit Platzhalterseite mit Health-Anzeige (PWA folgt) |

### Server (`apps/server/src`)
- `config.ts` – `loadConfig(env)`: Konfiguration **nur** aus Umgebungsvariablen (D-014): `PORT`, `DATABASE_URL`, `PUBLIC_ORIGIN` (Pflicht), `HOST` (Standard `127.0.0.1`, im Container `0.0.0.0`), `NODE_ENV` (Standard `development`). Abgeleitet: `trustProxy` = `NODE_ENV === 'production'` (Proxy-Header nur in prod vertrauen, D-014).
- `db.ts` – `Database`-Schnittstelle (`ping`, `close`) und `createPgDatabase(url)` mit `pg.Pool`.
- `app.ts` – `buildApp({ db, publicOrigin, trustProxy })` baut die Fastify-App ohne `listen`; Tests nutzen `app.inject()` und können eine Fake-DB übergeben. `GET /api/health` → `200 { status: "ok", db: "ok" }` bzw. `503 { status: "error", db: "error" }`; die Route loggt nur Warnungen (kein Request-Log pro Healthcheck).
- `ws.ts` – `registerWebSocket(app, { publicOrigin })`: **Platzhalter** bis WP-011. `ws`-Server (`noServer`) am `upgrade`-Event des HTTP-Servers, nur Pfad `/ws` (sonst 404). `Origin` muss exakt `PUBLIC_ORIGIN` sein, sonst `403` (D-014). Nach dem Verbinden sendet er `{"type":"hello","placeholder":true}` und echot jede Nachricht (max. 64 KiB). Heartbeat: Ping alle 30 s, Clients ohne Pong bis zum nächsten Ping werden getrennt. Beim Schließen der App werden offene Verbindungen beendet. Integrationstests mit echten Verbindungen in `ws.test.ts`.
- `main.ts` – Einstiegspunkt: Config laden, App bauen, `listen`, sauberes Beenden bei SIGTERM/SIGINT.
- `build.mjs` (neben `src/`) – Prod-Build `npm run build -w @poker/server`: esbuild bündelt `src/main.ts` samt `@poker/engine` zu `dist/server.mjs` (ESM, Node 22, keine Source-Maps); npm-Abhängigkeiten bleiben extern.

### Web (`apps/web`)
- `vite.config.ts` – Dev-Server-Einstellungen nur aus Umgebungsvariablen: `WEB_DEV_HOST`, `WEB_DEV_PORT`, `API_PROXY_TARGET` (Proxy für `/api` und `/ws` mit `ws: true`), `VITE_USE_POLLING`.
- `src/health.ts` – `fetchHealth()` mit relativer URL `/api/health` (eine Origin, D-014); `src/App.tsx` zeigt Titel („Poker – dev“) und Health-Status.

Workspaces importieren sich gegenseitig über den Paketnamen; `@poker/engine` exportiert direkt seine TypeScript-Quellen (`exports: ./src/index.ts`) und hat keinen eigenen Build-Schritt – Server (esbuild) und Web (Vite) bündeln es beim Prod-Build mit ein.

## Tooling
- **TypeScript:** `tsconfig.base.json` (strict, ES2023, `moduleResolution: Bundler`, `noEmit`), je Workspace eine `tsconfig.json`, die sie erweitert. Typecheck per `tsc --noEmit` pro Workspace.
- **Lint:** ESLint Flat Config (`eslint.config.js`) mit `typescript-eslint` (`strictTypeChecked`), Warnungen gelten als Fehler.
- **Format:** Prettier (`.prettierrc.json`); Markdown ist ausgenommen, weil `PROGRESS.md` eine generierte Tabelle enthält.
- **Tests:** Vitest; `vitest.config.ts` im Root fasst alle Workspaces als Projekte zusammen. Die Doku-Check-Tests in `scripts/test/` laufen mit `node --test`.

## npm-Skripte (Root)
| Skript | Wirkung |
|---|---|
| `setup` | aktiviert den Pre-Commit-Hook (`core.hooksPath`) |
| `dev:up` / `dev:down` / `dev:logs` | Docker-Dev-Umgebung starten (mit Build) / stoppen / Logs folgen |
| `prod:up` / `prod:down` / `prod:logs` | Prod-Umgebung ohne Tunnel starten (mit Build, wartet auf healthy) / stoppen / Logs folgen (`scripts/prod.sh`) |
| `prod:tunnel:up` | Prod inkl. `cloudflared` (Profil `tunnel`) |
| `prod:smoke` | Smoke-Test gegen prod (`scripts/smoke-prod.mjs`) |
| `release` | dev → main mergen, pushen, prod neu starten (`scripts/release.sh`) |
| `typecheck` | `tsc --noEmit` in allen Workspaces |
| `lint` | ESLint über das ganze Repo |
| `format` / `format:check` | Prettier schreiben bzw. prüfen |
| `test` | Doku-Check-Tests (`node --test`) + Vitest aller Workspaces |
| `docs:check` / `docs:sync` | Doku-Konsistenz prüfen bzw. PROGRESS-Tabelle generieren |
| `check` | `docs:check` + `format:check` + `typecheck` + `lint` + `test` (läuft im Pre-Commit-Hook) |

In einem Workspace gehen auch `npm run typecheck` und `npm test` einzeln (oder vom Root aus mit `-w @poker/engine`).

## Engine: Karten und Zufall
Quellen in `packages/engine/src/` (`cards.ts`, `deck.ts`, `rng.ts`, `crypto-rng.ts`), öffentliche API über `index.ts`.

- **Karte = String** aus Rang + Farbe: `"As"`, `"Td"`, `"2c"` (TypeScript-Typ ``Card = `${Rank}${Suit}` ``, Ränge `2–9 T J Q K A`, Farben `c d h s`). Begründung: ohne Umwandlung JSON-serialisierbar, kompakt im Protokoll und im Engine-Zustand (WP-006), gut lesbar in Tests und Logs, per `===` vergleichbar. Interne Repräsentationen für schnelle Handbewertung (WP-005) kann die Engine daraus ableiten. `parseCard`/`parseCards` validieren (Fehler: `CardParseError`), `isCard` prüft unbekannte Werte z. B. aus Client-Nachrichten, `formatCards` ist die Umkehrung von `parseCards`.
- **Deck** ist ein einfaches `Card[]` (Index 0 = oberste Karte). `createDeck()` liefert die 52 Karten in fester Reihenfolge, `shuffle(items, rng)` ist ein Fisher-Yates-Shuffle, `shuffledDeck(rng)` kombiniert beides, `deal(deck, n)` gibt `{ cards, deck }` zurück. Alles reine Funktionen ohne versteckten Zustand; Eingaben werden nie verändert.
- **Zufall wird injiziert:** `interface Rng { int(maxExclusive): number }` (gleichverteilt in `[0, maxExclusive)`).
  - `createSeededRng(seed)` – deterministischer PRNG (mulberry32, Rejection Sampling gegen Modulo-Bias) für Tests und Simulationen, **nicht** für echtes Spiel.
  - `cryptoRng` – Produktion, nutzt `crypto.randomInt` (unverzerrt, kryptografisch sicher). Liegt in `crypto-rng.ts`, der **einzigen** Engine-Datei mit Node-Import, und wird nur über den Subpfad `@poker/engine/crypto-rng` exportiert, damit `@poker/engine` selbst browser-tauglich und frei von I/O bleibt. Der Server (D-003) übergibt `cryptoRng` an die Engine.
- **Reinheit:** Ein Test (`purity.test.ts`) prüft, dass nur `crypto-rng.ts` Node-Module importiert und keine Engine-Datei `Math.random`, `Date`, `process` o. Ä. nutzt. Die Engine-`tsconfig.json` lädt `@types/node` (für `crypto-rng.ts` und Tests).

## Docker-Entwicklungsumgebung (dev)
`compose.dev.yml`, Compose-Projekt `poker-dev` (D-002, D-005). Start/Stopp über `npm run dev:up` / `dev:down`, Logs `dev:logs`.

| Dienst | Image | Im Container | Host (nur `127.0.0.1`, D-006) | Healthcheck |
|---|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 | 4312 (`DB_PORT`) | `pg_isready` |
| `server` | `poker-dev-node` (`docker/dev.Dockerfile`) | 4311, `tsx watch src/main.ts` | 4311 (`SERVER_PORT`) | `GET /api/health` |
| `web` | `poker-dev-node` | 4310, `vite` | 4310 (`WEB_PORT`) | `GET /` |

- Daten der DB im Named Volume `poker-dev-db` (bleibt bei `dev:down` erhalten).
- `docker/dev.Dockerfile` (`node:22-alpine`) installiert die Abhängigkeiten per `npm ci` **im Image** (Linux-Binaries). Das Repo wird nach `/app` gebunden (Hot-Reload), ein anonymes Volume über `/app/node_modules` verhindert, dass die macOS-`node_modules` des Hosts im Container landen. `dev:up` nutzt `--renew-anon-volumes`, damit nach Abhängigkeitsänderungen das frische `node_modules` aus dem Image verwendet wird.
- Hot-Reload: Server per `tsx watch` mit Polling (`CHOKIDAR_USEPOLLING=true`, Dateievents kommen über den macOS-Bind-Mount bei tsx nicht an); Web per Vite-HMR über Dateievents, Polling optional (`WEB_WATCH_POLLING=true`).
- Alle Werte mit Defaults in `compose.dev.yml`, überschreibbar per `.env` (Vorlage `.env.example`, `.env` ist gitignored).

## Prod-Umgebung
`compose.prod.yml`, Compose-Projekt `poker-prod` (D-002, D-005, D-014), Werte aus `.env.prod` (gitignored, Vorlage `.env.prod.example`). Bedienung, Release und Tunnel-Einrichtung: [OPERATIONS.md](OPERATIONS.md).

```
Internet ──https──▶ Cloudflare ──Tunnel──▶ cloudflared ──http──▶ web:8080 (nginx)
                                                                  │  /            statische App (Vite-Build)
Host 127.0.0.1:4320 ─────────────────────────────────────────────▶│  /api/, /ws   ──▶ server:4321 (Fastify + ws)
Host 127.0.0.1:4321 (Debug) ─────────────────────────────────────────────────────────▶ server:4321 ──▶ db:5432
        Netz frontend: cloudflared, web, server          Netz backend (internal): server, db
```

| Dienst | Image | Im Container | Host (nur `127.0.0.1`, D-006) | Healthcheck | Abhängig von |
|---|---|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 | – | `pg_isready` | – |
| `server` | `poker-prod-server` (`docker/server.Dockerfile`) | 4321, `node server.mjs` | 4321 (`SERVER_PORT`, Debugging) | `GET /api/health` | `db` healthy |
| `web` | `poker-prod-web` (`docker/web.Dockerfile`) | 8080, nginx | 4320 (`WEB_PORT`) | `GET /` | `server` healthy |
| `cloudflared` | `cloudflare/cloudflared:2026.9.3` | `tunnel --no-autoupdate run` | – | – (Image ohne Shell) | `web` healthy; nur Profil `tunnel` |

- Alle Dienste `restart: unless-stopped`. DB-Daten im Named Volume `poker-prod-db`. Netz `backend` ist `internal` (kein Zugang nach außen), die DB hat keinen Host-Port.
- **Server-Image:** Build-Stage mit allen Abhängigkeiten → `esbuild`-Bundle; eigene Stage installiert nur die Laufzeit-Abhängigkeiten des Servers (`npm ci --omit=dev -w @poker/server`, ohne Source-Maps); Runtime `node:22-alpine` mit `node_modules` + `server.mjs`, User `node`, `NODE_ENV=production`.
- **Web-Image:** Build-Stage `vite build` → Runtime `nginxinc/nginx-unprivileged` (User `nginx`, Port 8080). Konfiguration `docker/nginx/default.conf.template`, Ziel des Proxys per `API_UPSTREAM=server:4321` (envsubst beim Start, Auflösung über Docker-DNS zur Laufzeit). `/api/` und `/ws` gehen an den Server (`/ws` mit Upgrade-Headern, Read-/Send-Timeout 1 h); gzip; `/assets/*` (gehasht) `Cache-Control: public, max-age=31536000, immutable`, `index.html` und SPA-Fallback `no-cache`, `/api/` `no-store`.
- **Proxy-Header:** nginx setzt `X-Forwarded-For` auf `CF-Connecting-IP` (hinter dem Tunnel) bzw. die Peer-Adresse und reicht `X-Forwarded-Proto` von cloudflared durch; der Server vertraut ihnen nur in prod (`trustProxy`).
- **cloudflared:** eigener Tunnel für Poker, unabhängig vom Jarvis-Tunnel (D-014); `TUNNEL_TOKEN` aus `.env.prod`. Public Hostname `poker.arthur-reuss.de` → `http://web:8080`.

## Datenfluss
prod: Browser → `https://poker.arthur-reuss.de` → Cloudflare-Tunnel → `web:8080` (nginx) → statische Dateien bzw. `/api/*`, `/ws` an `server:4321` → `db:5432` (siehe [Prod-Umgebung](#prod-umgebung)). Lokal ohne Tunnel: `http://localhost:4320`.

dev: Browser → `http://localhost:4310` (Vite im `web`-Container). Anfragen an `/api/*` und `/ws` leitet der Vite-Proxy an `http://server:4311` im Compose-Netz weiter; der Server fragt Postgres unter `db:5432`. Der Server-Port 4311 und der DB-Port 4312 sind zusätzlich direkt vom Host erreichbar (Debugging, DB-Integrationstest).

## Verzeichnisstruktur
```
CLAUDE.md               Einstieg, harte Regeln
docs/
  WORKFLOW.md           Arbeitsweise
  PROGRESS.md           Stand (Tabelle generiert)
  DECISIONS.md          Entscheidungen
  ARCHITECTURE.md       diese Datei
  OPERATIONS.md         Betrieb: Start/Stopp, Release, Tunnel
  work-packages/        ein WP pro Datei
packages/
  engine/               @poker/engine – Poker-Logik (src/, Tests als *.test.ts daneben)
apps/
  server/               @poker/server – Game-Server (src/main.ts Einstieg, src/app.ts buildApp, build.mjs Prod-Bundle)
  web/                  @poker/web – Frontend (index.html, vite.config.ts, src/)
docker/
  dev.Dockerfile        Node-Image für server/web in dev
  server.Dockerfile     Prod-Image Server (multi-stage)
  web.Dockerfile        Prod-Image Web (multi-stage, nginx)
  nginx/                nginx-Konfiguration für das Web-Image
compose.dev.yml         Dev-Umgebung (poker-dev)
compose.prod.yml        Prod-Umgebung (poker-prod)
.env.example            alle Umgebungsvariablen mit Defaults (dev)
.env.prod.example       Vorlage für .env.prod (prod, gitignored)
scripts/
  docs.mjs              Doku-Check und -Sync
  prod.sh               prod:up/down/logs/tunnel:up
  smoke-prod.mjs        Smoke-Test prod (Health + WebSocket)
  release.sh            Release dev → main
  test/                 Tests für die Skripte
.githooks/pre-commit    blockiert Commits auf main, führt npm run check aus
package.json            Workspaces und npm-Skripte
tsconfig.base.json      gemeinsame TypeScript-Einstellungen
eslint.config.js        ESLint (Flat Config)
.prettierrc.json        Prettier
vitest.config.ts        Vitest-Projekte aller Workspaces
.nvmrc                  Node 22
```
