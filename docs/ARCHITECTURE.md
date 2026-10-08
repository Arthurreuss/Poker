# Architektur

_Wird mit den ersten Code-WPs gefüllt. Beschreibt immer den **aktuellen** Stand, nicht Pläne – Pläne stehen in den WPs._

## Komponenten
npm-Workspaces-Monorepo (D-004). Alle Workspaces sind TypeScript (ESM, `strict`).

| Workspace | Paket | Zweck |
|---|---|---|
| `packages/engine` | `@poker/engine` | reine Poker-Logik, keine I/O-Abhängigkeiten |
| `apps/server` | `@poker/server` | Game-Server: Fastify mit `GET /api/health` (prüft die DB per `pg`) und Auth-Endpunkten (`/api/register`, `/login`, `/logout`, `/me`); `ws` folgt; importiert `@poker/engine` |
| `apps/web` | `@poker/web` | Frontend: React + Vite, derzeit Platzhalterseite mit Health-Anzeige (PWA folgt) |

### Server (`apps/server/src`)
- `config.ts` – `loadConfig(env)`: Konfiguration **nur** aus Umgebungsvariablen (D-014): `PORT`, `DATABASE_URL`, `PUBLIC_ORIGIN` (Pflicht), `HOST` (Standard `127.0.0.1`, im Container `0.0.0.0`), `NODE_ENV` (Standard `development`).
- `db.ts` – `Database`-Schnittstelle (`ping`, `query`, `close`; `Queryable` = nur `query`, passt auch auf `pg.Pool`) und `createPgDatabase(url | poolConfig)` mit `pg.Pool`.
- `app.ts` – `buildApp({ db })` baut die Fastify-App ohne `listen`; Tests nutzen `app.inject()` und können eine Fake-DB übergeben. `GET /api/health` → `200 { status: "ok", db: "ok" }` bzw. `503 { status: "error", db: "error" }`. Registriert außerdem das Auth-Plugin (`auth/routes.ts`, siehe „Auth“); `buildApp({ db, auth })` nimmt optional eine `AuthConfig` (Standard: aus `process.env`).
- `auth/` – Registrierung, Login, Sessions, Rate-Limit (Abschnitt „Auth“); `cli/` – Admin-Skripte.
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

## Engine: Zustandsmodell einer Hand
Quellen: `packages/engine/src/hand-state.ts` (Typen) und `betting.ts` (Logik), öffentlich über `index.ts`. Eine Hand ist eine reine Zustandsmaschine:

```
startHand(options) → ActionResult        // { ok: true, state } | { ok: false, error: { code, message } }
legalActions(state) → LegalActions | null
applyAction(state, playerId, action) → ActionResult
potTotal(state) → number
```

- **Ergebnistyp statt Exceptions:** Fehler kommen als `{ ok: false, error }` mit `code` (`INVALID_SETUP`, `HAND_NOT_IN_BETTING`, `UNKNOWN_PLAYER`, `NOT_YOUR_TURN`, `INVALID_ACTION` (unbekannt oder kein ganzzahliger Betrag), `ILLEGAL_ACTION` (Aktion hier nicht erlaubt), `AMOUNT_TOO_SMALL`, `AMOUNT_TOO_LARGE`) und deutscher Klartext-`message`. Der Eingabezustand wird nie verändert, auch nicht bei Erfolg. Aktionen werden zur Laufzeit geprüft (kommen später als JSON vom Client).
- **Serialisierbar:** Der Zustand besteht nur aus Strings, Zahlen, Booleans, `null`, Arrays und Objekten (keine `undefined`-Felder). `JSON.parse(JSON.stringify(state))` funktioniert mit allen Funktionen identisch weiter (getestet). Er enthält Deck und alle Hole Cards – er ist **serverseitig** (D-003); eine gefilterte Spieleransicht ist Sache von Server/Protokoll.
- **Start:** `startHand({ players: [{ id, seat, stack }], buttonSeat, smallBlind, bigBlind, ante?, blinds?, rng? | deck? })`. 2–9 Spieler (D-007), positive ganzzahlige Stacks. Mischen per `rng` (Betrieb: `cryptoRng`); `deck` (Index 0 = oben) nur für Tests/Simulationen. Hole Cards reihum, je eine Karte, beginnend links vom Button. Dann Antes (alle, links vom Button beginnend), dann Small und Big Blind; wer zu wenig hat, postet All-in.
- **Blind-Sitze:** Standard: Heads-up ist der Button Small Blind, sonst die beiden nächsten besetzten Sitze links vom Button. `blinds: { smallBlindSeat | null, bigBlindSeat }` überschreibt das (Dead Button/Dead Small Blind, WP-008); `buttonSeat` darf ein leerer Sitz sein.

### Zustandsfelder (`HandState`)
| Feld | Bedeutung |
|---|---|
| `smallBlind`, `bigBlind`, `ante` | Beträge dieser Hand |
| `buttonSeat`, `smallBlindSeat` (`null` = keiner), `bigBlindSeat` | Positionen |
| `players[]` | nach Sitz sortiert; „links“ = nächsthöherer Sitz, zyklisch |
| `players[].stack` / `startStack` | Chips vor sich / vor der Hand |
| `players[].streetBet` | Einsatz in der aktuellen Straße (Blinds zählen, Antes nicht) |
| `players[].totalBet` | Gesamteinsatz der Hand inkl. Ante und Blinds – Grundlage für Side Pots (WP-007) |
| `players[].status` | `active`, `folded`, `allIn` (Stack 0, noch in der Hand) |
| `players[].hasActed` | hat in dieser Straße freiwillig gehandelt (Blinds zählen nicht → BB-Option) |
| `players[].holeCards` | zwei Karten |
| `deck`, `burned`, `board` | Restdeck (oben = Index 0), verbrannte Karten, Gemeinschaftskarten |
| `street` | `preflop` → `flop` (3) → `turn` (1) → `river` (1); vor jeder Straße wird eine Karte verbrannt |
| `phase` | `betting` → `showdown` oder `complete` |
| `toActId` | wer am Zug ist (`null` außerhalb von `betting`) |
| `currentBet` | zu bringender Straßeneinsatz (preflop mindestens der Big Blind, auch wenn der BB All-in für weniger ist) |
| `minRaise` | Größe des letzten vollständigen Bets/Raises der Straße, mindestens Big Blind |
| `log[]` | Protokoll: `{ street, playerId, type, amount, to, allIn }`, `type` ∈ ante, smallBlind, bigBlind, fold, check, call, bet, raise (All-in wird als call/bet/raise mit `allIn: true` protokolliert) |
| `payouts` | Auszahlungen bei `complete`, sonst `null` |

Chip-Erhaltung: Solange `phase !== 'complete'`, gilt Σ`stack` + Σ`totalBet` = Σ`startStack`; bei `complete` ist alles ausgezahlt (Σ`stack` = Σ`startStack`).

### Phasen
- `betting`: Setzrunde läuft. Preflop beginnt der Spieler links vom Big Blind, postflop der erste aktive links vom Button (Heads-up damit: Button/SB preflop zuerst, postflop zuletzt). Gefoldete und All-in-Spieler werden übersprungen.
- Eine Setzrunde endet, wenn jeder aktive Spieler gehandelt und den `currentBet` gebracht hat – oder wenn nur noch ein aktiver Spieler übrig ist, der keinen tatsächlichen Einsatz mehr callen muss. Kann danach höchstens ein Spieler handeln, läuft das Board automatisch bis zum River durch.
- `complete`: alle bis auf einen haben gefoldet; der bekommt `potTotal` (inkl. eigenem nicht gecallten Einsatz), `payouts` ist gesetzt.
- `showdown`: River-Setzrunde beendet bzw. Board durchgelaufen, mindestens zwei Spieler übrig. **Übergabe an WP-007:** Pots aus `totalBet` bilden (inkl. Rückgabe nicht gecallter Beträge), Hände vergleichen, `payouts` setzen.

### Aktionssemantik (`Action`)
- `fold` – immer erlaubt (auch wenn Check möglich wäre). `check` – nur ohne offenen Einsatz. `call` – bringt `min(currentBet − streetBet, stack)`; mit zu kleinem Stack ein All-in-Call.
- `bet { amount }` – nur ohne Einsatz in der Straße; `raise { amount }` – nur bei bestehendem Einsatz. **`amount` ist der Gesamteinsatz dieser Straße danach („raise to“)**, nicht der Zuwachs.
- `allIn` – setzt den ganzen Stack; je nach Betrag Call, Bet oder Raise.
- No-Limit: Mindest-Bet = Big Blind; Mindest-Raise auf `currentBet + minRaise`; Maximum = `streetBet + stack`. Weniger als das Minimum geht nur per `allIn`. Ein All-in, das um mindestens `minRaise` erhöht, ist ein voller Raise und setzt `minRaise` neu; sonst ist es unvollständig (`currentBet` steigt, `minRaise` bleibt).
- Wiedereröffnung (TDA): Ein Spieler darf erhöhen, wenn er in dieser Straße noch nicht gehandelt hat oder seit seiner letzten Aktion insgesamt um mindestens `minRaise` erhöht wurde. Wer nur einem unvollständigen All-in-Raise gegenübersteht, darf nur callen oder folden. Erhöhen ist außerdem nicht erlaubt, wenn kein Gegner mehr handeln kann.
- `legalActions(state)` liefert `{ playerId, toCall, actions }` mit `fold`, `check` oder `call { amount }`, ggf. `bet`/`raise { min, max }` (als „to“-Beträge) und `allIn { amount, to }`. Jede angebotene Aktion wird von `applyAction` akzeptiert (Property-Test).

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

## Auth
Accounts mit Benutzername + Passwort, offene Registrierung (D-011). Code in `apps/server/src/auth/`, eingebunden als gekapseltes Fastify-Plugin `authRoutes` (`routes.ts`).

### Endpunkte
| Methode und Pfad | Body | Erfolg | Fehler |
|---|---|---|---|
| `POST /api/register` | `{ username, password }` | `201 { user }` + Session-Cookie (direkt eingeloggt) | `400` ungültige Eingabe, `409 username_taken`, `429` |
| `POST /api/login` | `{ username, password }` | `200 { user }` + Session-Cookie | `400` Felder fehlen/zu lang, `401 invalid_credentials`, `429` |
| `POST /api/logout` | – | `204`, Session gelöscht, Cookie geleert (auch ohne Session) | – |
| `GET /api/me` | – | `200 { user }` | `401 unauthorized` (Cookie fehlt, unbekannt oder abgelaufen; ein ungültiges Cookie wird geleert) |

`user` = `{ id, username, isAdmin }`. Fehler haben immer die Form `{ error, message }` (`error` ist ein fester Code, `message` deutscher Text für die UI).

### Ablauf
- **Validierung** (`validation.ts`, ohne I/O): Benutzername 3–20 Zeichen aus `[A-Za-z0-9_-]`, eindeutig ohne Rücksicht auf Groß-/Kleinschreibung (Unique-Index auf `lower(username)`; Kollision → `409`). Die Schreibweise der Registrierung bleibt erhalten, Login ist case-insensitive. Passwort 8–128 Zeichen.
- **Passwörter** (`password.ts`): argon2id über `@node-rs/argon2` (Prebuilds inkl. musl für `node:22-alpine`, keine Install-Skripte), Parameter nach OWASP: 19 MiB, `t=2`, `p=1`. In der DB steht nur der PHC-String (`$argon2id$v=19$m=19456,t=2,p=1$…`).
- **Login ohne Hinweis auf existierende Namen:** falsches Passwort, unbekannter Name und ein Name, der die Regeln verletzt, ergeben dieselbe Antwort (`401 invalid_credentials`). Bei unbekanntem Namen wird gegen einen Dummy-Hash mit denselben Parametern geprüft, damit die Laufzeit ähnlich ist.
- **Sessions** (`session.ts`): Token = 32 Zufallsbytes, base64url (43 Zeichen). Die DB speichert nur `sha256(token)` in `sessions.token_hash`; wer die DB liest, kann keine Session übernehmen. Ablauf nach `SESSION_TTL_DAYS` (Standard 30) ab Login, ohne gleitende Verlängerung. Beim Login werden abgelaufene Sessions des Users gelöscht; Logout löscht die Session. Eine Session gilt nur, solange `expires_at > now()` und der Account nicht gelöscht ist (`deleted_at`).
- **Cookie** `poker_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Expires` = Session-Ablauf, `Secure` nur bei `NODE_ENV=production` (D-014; in dev läuft alles über `http://localhost`). `SameSite=Lax` verhindert, dass fremde Seiten POSTs mit dem Cookie auslösen.
- **Logging:** Request-Bodies und Header (inkl. `Cookie`) werden nicht geloggt (Fastify-Standard-Serializer loggen nur Methode, URL, Host, IP); das Auth-Plugin hat einen eigenen Fehler-Handler, der nur Fehlerobjekte loggt. Ein Test fängt die Logs ab und prüft, dass weder Passwort noch Token vorkommen.

### Rate-Limit
`@fastify/rate-limit`, nur für `POST /api/login` und `POST /api/register` (je Route ein eigener Zähler, im Speicher des Prozesses). Standard: 10 Anfragen pro 60 s und Client-IP, danach `429 rate_limited`. Gezählt werden alle Anfragen, nicht nur Fehlversuche. Schlüssel: in prod (`NODE_ENV=production`) `CF-Connecting-IP` (Cloudflare, D-014), sonst/fallback `request.ip` – in dev wird der Header ignoriert, sonst ließe sich das Limit per Header umgehen.

### Konfiguration (`auth/config.ts`, `loadAuthConfig(env)`)
| Variable | Standard | Wirkung |
|---|---|---|
| `NODE_ENV` | `development` | `production` → Cookie `Secure`, Client-IP aus `CF-Connecting-IP` |
| `SESSION_TTL_DAYS` | `30` | Lebensdauer einer Session |
| `AUTH_RATE_LIMIT_MAX` | `10` | Anfragen pro Fenster und IP; `0` schaltet das Limit ab |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | `60` | Fensterlänge |

Tests übergeben `buildApp({ db, auth })` eine eigene `AuthConfig` (z. B. Limit aus, `max: 3`, prod-Flags).

### Session im WebSocket-Handshake
`getUserFromCookieHeader(db, request.headers.cookie)` (exportiert aus `session.ts` und dem Paket-Index) liest das Token aus einem rohen `Cookie`-Header (eigener kleiner Parser, unabhängig vom Fastify-Cookie-Plugin) und liefert `AuthUser | null` – gedacht für das WebSocket-Upgrade (WP-011), wo der Browser das Cookie automatisch mitschickt (gleiche Origin, D-014). `getUserFromSessionToken(db, token)` ist die Variante mit bereits extrahiertem Token.

### Admin
Admin-Flag `users.is_admin` (in `/api/me` als `isAdmin`). CLI-Skripte in `src/cli/` mit Kernlogik in `auth/admin.ts` (getestet): `admin:reset-password` setzt ein neues Passwort und löscht in derselben SQL-Anweisung alle Sessions des Users, `admin:make-admin` setzt/entzieht das Flag. Aufrufe: README, Abschnitt „Admin“.

### Tests
`auth/auth.unit.test.ts` (ohne DB: Validierung, Token/Hashing, argon2id-Parameter, Config, Client-IP) und `auth/auth.db.test.ts` (Integration gegen die Test-DB über `app.inject()`: alle Endpunkte inkl. Fehlerfälle, Cookie-Flags dev/prod, Ablauf, Rate-Limit, Logs, `getUserFromCookieHeader`, Admin-Funktionen). `npm run test:db -w @poker/server` führt alle Server-Tests mit Test-DB aus.

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
