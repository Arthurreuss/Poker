# Architektur

_Wird mit den ersten Code-WPs gefüllt. Beschreibt immer den **aktuellen** Stand, nicht Pläne – Pläne stehen in den WPs._

## Komponenten
npm-Workspaces-Monorepo (D-004). Alle Workspaces sind TypeScript (ESM, `strict`).

| Workspace | Paket | Zweck |
|---|---|---|
| `packages/engine` | `@poker/engine` | reine Poker-Logik, keine I/O-Abhängigkeiten |
| `apps/server` | `@poker/server` | Game-Server: Fastify mit `GET /api/health` (prüft die DB per `pg`); `ws` folgt; importiert `@poker/engine` |
| `apps/web` | `@poker/web` | Frontend: React + Vite, derzeit Platzhalterseite mit Health-Anzeige (PWA folgt) |

### Server (`apps/server/src`)
- `config.ts` – `loadConfig(env)`: Konfiguration **nur** aus Umgebungsvariablen (D-014): `PORT`, `DATABASE_URL`, `PUBLIC_ORIGIN` (Pflicht), `HOST` (Standard `127.0.0.1`, im Container `0.0.0.0`), `NODE_ENV` (Standard `development`).
- `db.ts` – `Database`-Schnittstelle (`ping`, `close`) und `createPgDatabase(url)` mit `pg.Pool`.
- `app.ts` – `buildApp({ db })` baut die Fastify-App ohne `listen`; Tests nutzen `app.inject()` und können eine Fake-DB übergeben. `GET /api/health` → `200 { status: "ok", db: "ok" }` bzw. `503 { status: "error", db: "error" }`.
- `main.ts` – Einstiegspunkt: Config laden, App bauen, `listen`, sauberes Beenden bei SIGTERM/SIGINT.

### Web (`apps/web`)
- `vite.config.ts` – Dev-Server-Einstellungen nur aus Umgebungsvariablen: `WEB_DEV_HOST`, `WEB_DEV_PORT`, `API_PROXY_TARGET` (Proxy für `/api` und `/ws` mit `ws: true`), `VITE_USE_POLLING`.
- `src/health.ts` – `fetchHealth()` mit relativer URL `/api/health` (eine Origin, D-014); `src/App.tsx` zeigt Titel („Poker – dev“) und Health-Status.

Workspaces importieren sich gegenseitig über den Paketnamen; `@poker/engine` exportiert direkt seine TypeScript-Quellen (`exports: ./src/index.ts`), es gibt noch keinen Build-Schritt.

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

## Engine: Handbewertung
Quelle: `packages/engine/src/hand-eval.ts` (eigene Implementierung, D-004), öffentliche API über `index.ts`.

- **API:** `evaluateHand(cards)` bewertet 5–7 Karten und liefert `{ category, value, cards, description }`: Kategorie (`'high-card'` … `'straight-flush'`, deutsche Namen in `HAND_CATEGORY_NAMES`), vergleichbarer Wert, die fünf besten Karten (nach Bedeutung sortiert, gleiche Ränge in Farbreihenfolge c-d-h-s, Wheel als 5-4-3-2-A) und eine deutsche Anzeige wie „Full House, Könige über Zehnen“, „Straße bis zur Fünf“, „Zwei Paare, Asse und Achten, Kicker Dame“ (Royal Flush nur als Beschreibung, Kategorie bleibt Straight Flush). `handValue(cards)` liefert nur den Wert (für Simulationen), `compareHands(a, b)` gibt -1/0/1, `determineWinners([{ id, cards }])` liefert `winners` (mehrere = Split, in Eingabereihenfolge), `winningHand` und alle `hands`. Ungültige Anzahl, ungültige oder doppelte Karten → `HandEvaluationError`.
- **Algorithmus:** direkt auf 5–7 Karten, ohne die 21 Fünferkombinationen aufzuzählen. Je Farbe eine 13-Bit-Rangmaske (Bit r = Rang r, 2–14). Flush = Farbe mit ≥ 5 Bits; Straße = fünf aufeinanderfolgende Bits in der Maske (Ass zusätzlich als Bit 1 für das Wheel), zuerst in der Flush-Farbe (Straight Flush). Die Ranghäufigkeiten (Summe der vier Masken je Rang) ergeben Vierling/Drilling/Paar/Einzelkarten, absteigend sortiert; daraus folgen Full House (auch aus zwei Drillingen), Zwei Paare (bei drei Paaren das beste Paar-Paar, Kicker = höchste übrige Karte inkl. drittes Paar) und Kicker. Die besten fünf Karten und die Beschreibung werden aus dem Wert zurückgerechnet.
- **Wertkodierung:** `value = Kategorie << 20 | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5` (Kategorie 0 = High Card … 8 = Straight Flush, Tiebreak-Ränge je 4 Bit, linksbündig, ungenutzt = 0). Tiebreaks je Kategorie: Straße/Straight Flush höchste Karte (Wheel = 5); Vierling Rang, Kicker; Full House Drilling, Paar; Flush/High Card fünf Ränge; Drilling Rang + 2 Kicker; Zwei Paare hohes, niedriges Paar, Kicker; Paar Rang + 3 Kicker. Damit gilt: höherer Wert = bessere Hand, gleicher Wert = Split; die Werte sind JSON-taugliche ganze Zahlen < 2^24.
- **Tests:** Tabellen je Kategorie und Grenzfall (`hand-eval.test.ts`); `hand-eval.exhaustive.test.ts` zählt alle 2.598.960 5-Karten-Hände gegen die bekannten Häufigkeiten (und 7.462 verschiedene Werte, ca. 1–2 s) und misst die 7-Karten-Bewertung über 100.000 seeded Hände (Ziel < 50 µs, gemessen < 1 µs).

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

## Datenmodell
Postgres 16 (D-010). Schema in `apps/server/migrations/*.sql`, Runner und Zeilentypen in `apps/server/src/db/`.

### Tabellen
| Tabelle | Inhalt | Schlüssel / wichtige Constraints |
|---|---|---|
| `users` | Account: `username`, `password_hash` (argon2id, D-011), `is_admin`, `created_at`, `deleted_at` | Unique-Index auf `lower(username)` (case-insensitive), Länge 3–20; `username`/`password_hash` dürfen nur bei gesetztem `deleted_at` `NULL` sein |
| `sessions` | Login-Sessions: `token_hash` (SHA-256 des Tokens, 32 Byte), `user_id`, `created_at`, `expires_at` | PK `token_hash`; Indizes auf `user_id` und `expires_at` (Aufräumen) |
| `tables` | Tisch: `created_by`, `name`, `is_public`, `invite_code` (Link-Code, jeder Tisch hat einen), `max_seats` (2–9, D-007), `starting_stack`, `small_blind`, `big_blind`, `blind_structure` (JSONB, Form legt der Game-Server fest), `turn_time_seconds` (Standard 20) und `time_bank_seconds` (Standard 60, D-013), `status` (`open`/`running`/`closed`), `created_at`, `closed_at` | `invite_code` eindeutig; Partial-Index für die Lobby (öffentlich, nicht geschlossen) |
| `rounds` | Freezeout-Runde (D-012): `table_id`, `started_at`, `finished_at`, `status` (`running`/`finished`/`aborted`) | `finished_at` gesetzt ⇔ Status ≠ `running` |
| `round_players` | Teilnahme: `round_id`, `user_id`, `seat` (0–8), `placement` (1 = Sieger), `points` | PK (`round_id`, `user_id`), Sitz und Platzierung je Runde eindeutig; `placement`/`points` sind `NULL`, solange die Runde läuft oder bei Abbruch |
| `hands` | Hand einer Runde: `hand_number`, `button_seat`, Blinds, `board` (`text[]` mit Karten-Strings der Engine), `players` (JSONB: Sitz, User, Stack, Hole Cards zu Handbeginn), `result` (JSONB: Pots, Gewinner, gezeigte Karten), `started_at`, `finished_at` | Unique (`round_id`, `hand_number`) |
| `hand_actions` | Aktion in einer Hand: `seq` (Reihenfolge ab 1), `user_id`, `street` (`preflop`…`river`), `action` (`small_blind`, `big_blind`, `fold`, `check`, `call`, `bet`, `raise`), `amount`, `is_all_in`, `created_at` | PK (`hand_id`, `seq`) |
| `schema_migrations` | vom Migrations-Runner verwaltet: `version`, `checksum`, `applied_at` | PK `version` |

Beziehungen:
```
users 1─n sessions
users 1─n tables (created_by) 1─n rounds 1─n round_players n─1 users
                                     rounds 1─n hands 1─n hand_actions n─1 users
```

- **Löschverhalten:** Alle Verweise auf `users` (außer `sessions`) sind `ON DELETE RESTRICT`. Accounts werden nie hart gelöscht, sondern anonymisiert (`username`/`password_hash` → `NULL`, `deleted_at` setzen, WP-022) – so bleibt die Hand-Historie der anderen Spieler vollständig, und der Name wird wieder frei. `sessions` kaskadieren mit dem User. Innerhalb eines Aggregats wird kaskadiert: Runde → `round_players`, `hands`; Hand → `hand_actions`. Tische werden nicht gelöscht, sondern auf `closed` gesetzt (`rounds.table_id` ist `RESTRICT`).
- **Indizes für spätere Abfragen:** Rangliste `SUM(points) GROUP BY user_id` über `round_players (user_id, points)` (Index-Only-Scan); Runden und Hand-Historie eines Users über `round_players (user_id, round_id)` → `hands (round_id, hand_number)`; Statistiken pro User (VPIP, PFR) über `hand_actions (user_id, hand_id)`.
- **Zahlentypen:** IDs, Chips und Punkte sind `integer`. Grund: `pg` liefert `integer` als JS-`number`, `bigint` dagegen als String (eigene Parser nötig). Die Größenordnung passt: `starting_stack` ist per Constraint auf 10⁸ begrenzt, damit die Summe aller Stacks (max. 9 Spieler) unter 2³¹ bleibt; Punkte pro Runde sind ≤ 9; 2³¹ Zeilen pro Tabelle erreicht eine Freundesrunde nicht. Achtung: `sum()`/`count()` liefern in Postgres `bigint` → in Queries `::int` casten.
- **Typen:** `src/db/types.ts` enthält handgeschriebene Zeilentypen (`UserRow`, `TableRow`, `HandRow` …, Spalten 1:1 in snake_case) für `pool.query<T>()` – kein ORM. Ändert eine Migration eine Tabelle, wird der Typ im selben Commit angepasst.

### Migrationen
- **Werkzeug:** eigener kleiner Runner (`src/db/migrate.ts`, `runMigrations(connection)`) statt `node-pg-migrate`: ein kleines Modul ohne neue Abhängigkeit, reine SQL-Dateien, und Lock-, Transaktions- und Prüfverhalten sind vollständig sichtbar und getestet. Ein Down-Pfad fehlt bewusst – Korrekturen sind neue Vorwärts-Migrationen.
- **Dateien:** `apps/server/migrations/NNNN_name.sql` (vierstellige Nummer, Kleinbuchstaben), angewendet in Nummernreihenfolge. SQL ohne Schema-Präfix (Tests nutzen eigene Schemas über `search_path`). Eine angewendete Migration wird nie geändert – der Runner vergleicht die SHA-256-Checksumme und bricht ab, wenn eine Datei geändert wurde oder fehlt.
- **Ablauf beim Serverstart** (`main.ts`, vor `listen`): eigene Verbindung → `pg_advisory_lock` (fester Schlüssel, serialisiert parallel startende Instanzen) → `schema_migrations` anlegen, falls nötig → Checksummen der angewendeten Migrationen prüfen → jede fehlende Migration in **einer eigenen Transaktion** zusammen mit ihrem `schema_migrations`-Eintrag ausführen → Lock freigeben. Schlägt eine Migration fehl, wird sie vollständig zurückgerollt und der Server startet nicht. Ein zweiter Lauf ist ein No-Op. Befehle, die keine Transaktion vertragen (z. B. `CREATE INDEX CONCURRENTLY`), werden nicht unterstützt.
- **Tests:** `src/db/migrate.test.ts` (frische DB, zweiter Lauf No-Op, parallele Läufe, Rollback, geänderte/fehlende Dateien) und `src/db/schema.test.ts` (Constraints, Fremdschlüssel, Löschverhalten, Beispiel-Queries). Sie laufen nur mit gesetztem `TEST_DATABASE_URL` (sonst `skipIf`, damit `npm run check` ohne Docker grün bleibt). `npm run test:db -w @poker/server` nutzt standardmäßig die Datenbank `poker_test` im dev-Postgres (`localhost:4312`), legt sie bei Bedarf an (`src/db/test-db.ts`), gibt jedem Testlauf ein eigenes Schema `test_<zeit>_<zufall>` und löscht es danach.

## Datenfluss
dev: Browser → `http://localhost:4310` (Vite im `web`-Container). Anfragen an `/api/*` und `/ws` leitet der Vite-Proxy an `http://server:4311` im Compose-Netz weiter; der Server fragt Postgres unter `db:5432`. Der Server-Port 4311 und der DB-Port 4312 sind zusätzlich direkt vom Host erreichbar (Debugging, DB-Integrationstest).

## Verzeichnisstruktur
```
CLAUDE.md               Einstieg, harte Regeln
docs/
  WORKFLOW.md           Arbeitsweise
  PROGRESS.md           Stand (Tabelle generiert)
  DECISIONS.md          Entscheidungen
  ARCHITECTURE.md       diese Datei
  work-packages/        ein WP pro Datei
packages/
  engine/               @poker/engine – Poker-Logik (src/, Tests als *.test.ts daneben)
apps/
  server/               @poker/server – Game-Server (src/main.ts Einstieg, src/app.ts buildApp)
  web/                  @poker/web – Frontend (index.html, vite.config.ts, src/)
docker/
  dev.Dockerfile        Node-Image für server/web in dev
compose.dev.yml         Dev-Umgebung (poker-dev)
.env.example            alle Umgebungsvariablen mit Defaults
scripts/
  docs.mjs              Doku-Check und -Sync
  test/                 Tests für die Skripte
.githooks/pre-commit    blockiert Commits auf main, führt npm run check aus
package.json            Workspaces und npm-Skripte
tsconfig.base.json      gemeinsame TypeScript-Einstellungen
eslint.config.js        ESLint (Flat Config)
.prettierrc.json        Prettier
vitest.config.ts        Vitest-Projekte aller Workspaces
.nvmrc                  Node 22
```
