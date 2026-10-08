# Architektur

_Wird mit den ersten Code-WPs gefüllt. Beschreibt immer den **aktuellen** Stand, nicht Pläne – Pläne stehen in den WPs._

## Komponenten
npm-Workspaces-Monorepo (D-004). Alle Workspaces sind TypeScript (ESM, `strict`).

| Workspace | Paket | Zweck |
|---|---|---|
| `packages/engine` | `@poker/engine` | reine Poker-Logik, keine I/O-Abhängigkeiten; Subpfad `@poker/engine/protocol` = WebSocket-Protokoll (Typen, Validatoren, gefilterte Sichten) für Server und Web |
| `apps/server` | `@poker/server` | Game-Server: Fastify mit `GET /api/health` (prüft die DB per `pg`), Auth-Endpunkten (`/api/register`, `/login`, `/logout`, `/me`), Rangliste/Statistik/Hand-Historie (`/api/leaderboard`, `/api/players/:name/stats`, `/api/rounds/…`, `/api/hands/:id`) und Game-Server über WebSocket `/ws` (`ws`, Tische im Speicher); importiert `@poker/engine` |
| `apps/web` | `@poker/web` | Frontend: React + Vite als installierbare PWA mit Routing, Login/Registrierung und App-Shell (Abschnitt „Frontend“) |

### Server (`apps/server/src`)
- `config.ts` – `loadConfig(env)`: Konfiguration **nur** aus Umgebungsvariablen (D-014): `PORT`, `DATABASE_URL`, `PUBLIC_ORIGIN` (Pflicht), `HOST` (Standard `127.0.0.1`, im Container `0.0.0.0`), `NODE_ENV` (Standard `development`). Abgeleitet: `trustProxy` = `NODE_ENV === 'production'` (Proxy-Header nur in prod vertrauen, D-014).
- `db.ts` – `Database`-Schnittstelle (`ping`, `query`, `close`; `Queryable` = nur `query`, passt auch auf `pg.Pool`) und `createPgDatabase(url | poolConfig)` mit `pg.Pool`.
- `app.ts` – `buildApp({ db, publicOrigin, trustProxy, auth?, game? })` baut die Fastify-App ohne `listen`; Tests nutzen `app.inject()` und können eine Fake-DB übergeben. `game` überschreibt Teile des Game-Servers (Repository, `authenticate`, Uhr, Rng, Pause nach der Hand, Hooks); der Game-Server hängt als `app.game` an der Instanz. `GET /api/health` → `200 { status: "ok", db: "ok" }` bzw. `503 { status: "error", db: "error" }`; die Route loggt nur Warnungen. Registriert das Auth-Plugin (`auth/routes.ts`, siehe „Auth“); `auth` ist optional eine `AuthConfig` (Standard: aus `process.env`).
- `auth/` – Registrierung, Login, Sessions, Rate-Limit (Abschnitt „Auth“); `cli/` – Admin-Skripte.
- `admin/` – Admin-Rolle (WP-028, D-029): allgemeiner Guard für `/api/admin/*`, Admin-API (Spieler, Tische) und Admin-Protokoll (Abschnitt „Auth“ → „Admin (WP-028)“). `periodic-job.ts` – gemeinsamer Helfer für tägliche Löschjobs.
- `feedback/` – Feedback-API, Speicherung und Kernlogik der CLI `admin:feedback` (Abschnitt „Datenmodell“ → „Feedback“).
- `stats/` – Rangliste, Statistiken und Hand-Historie für Clients (Abschnitt „Datenmodell“ → „Statistiken“).
- `ws.ts` – `registerWebSocket(app, { publicOrigin, authenticate, game })`: `ws`-Server (`noServer`) am `upgrade`-Event des HTTP-Servers, nur Pfad `/ws` (sonst `404`). `Origin` muss exakt einer der Origins aus `PUBLIC_ORIGIN` sein (kommagetrennt, D-023), sonst `403` (D-014); dann Session aus dem `Cookie`-Header (`getUserFromCookieHeader`), ohne gültige Session `401`, Fehler der Prüfung `500`. Nachrichten (max. 64 KiB, sonst Trennung mit 1009) gehen pro Verbindung strikt nacheinander an den `GameServer`. Heartbeat: Ping alle 30 s, Clients ohne Pong bis zum nächsten Ping werden getrennt. Beim Schließen der App werden Tisch-Timer beendet und offene Verbindungen getrennt. Tests: `ws.test.ts` (Transport), `game/*.test.ts` (Spielablauf).
- `game/` – Game-Server, siehe „Game-Server: Protokoll und Tische“.
- `main.ts` – Einstiegspunkt: Config laden (`LOG_FILE` gesetzt → Logs in diese Datei statt stdout, siehe „Prod-Umgebung“ → Logs), App bauen, Migrationen, verwaiste Tische/Runden schließen (`closeOrphanedTables`), Löschjobs für Feedback und Admin-Protokoll starten (`startFeedbackPurgeJob`, `startAuditPurgeJob`, D-025), `listen`, sauberes Beenden bei SIGTERM/SIGINT.
- `build.mjs` (neben `src/`) – Prod-Build `npm run build -w @poker/server`: esbuild bündelt `src/main.ts` samt `@poker/engine` zu `dist/server.mjs` (ESM, Node 22, keine Source-Maps); npm-Abhängigkeiten bleiben extern.

### Web (`apps/web`)
- `vite.config.ts` – Dev-Server-Einstellungen nur aus Umgebungsvariablen: `WEB_DEV_HOST`, `WEB_DEV_PORT`, `API_PROXY_TARGET` (Proxy für `/api` und `/ws` mit `ws: true`), `VITE_USE_POLLING`, optional `API_PROXY_ORIGIN` (überschreibt den `Origin`-Header für `/api` und `/ws` – nur für einen zweiten Dev-Server gegen einen Game-Server mit anderer `PUBLIC_ORIGIN`, z. B. den Playwright-Spieltest aus WP-018).
  Dazu das PWA-Plugin (siehe „Frontend“) und ein kleines Plugin, das `%THEME_COLOR%` in `index.html` durch `--color-bg` aus `tokens.css` ersetzt.
  `define: __APP_VERSION__` = `APP_VERSION` (Docker-Build-Argument, `scripts/prod.sh` setzt den Commit des Prod-Worktrees) oder `git rev-parse --short HEAD`, sonst „unbekannt“ (Typ in `src/vite-env.d.ts`; `vitest.config.ts` setzt `test`).
- `vitest.config.ts` – eigene Test-Konfiguration (jsdom, `src/test/setup.ts`), damit das PWA-Plugin in Tests nicht läuft.
- `src/health.ts` – `fetchHealth()` mit relativer URL `/api/health` (eine Origin, D-014) und `appTitle(mode)` („Poker – dev“ außerhalb von prod); die Lobby zeigt den Health-Status.
- Aufbau von `src/`, Routing, API-Client, Styling und PWA: Abschnitt „Frontend“.

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
| `prod:smoke` | Smoke-Test gegen prod (`scripts/smoke-prod.mjs`, über `scripts/prod.sh smoke`) |
| `prod:setup` | Prod-Worktree auf `main` einmalig anlegen (`scripts/prod-worktree-setup.sh`, D-017) |
| `prod:backup` / `prod:restore` | sofortiges Backup / Restore aus einem Dump (`scripts/backup-now.sh`, `scripts/restore.sh`) |
| `prod:status` | Zustandsbericht: Container, letztes Backup, Speicherplatz, Health (`scripts/status.sh`) |
| `prod:test-restore` | Restore-Test in isolierter prod-Kopie (`scripts/test-restore.sh`) |
| `release` | dev → main im Prod-Worktree mergen, pushen, prod neu starten (`scripts/release.sh`) |
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
- **Reinheit:** Doppelt abgesichert: ESLint-Block „Engine-Reinheit“ in `eslint.config.js` für `packages/engine/src/**/*.ts` (außer `crypto-rng.ts` und Tests) verbietet Node-Importe (`node:*`, `fs`, `crypto` …), dynamische Imports, die Globals `Date`, `process`, `performance`, Timer, `fetch`, `crypto`, `console` u. a., `Math.random` und `globalThis.*`. Zusätzlich prüft `purity.test.ts` alle Quelldateien inkl. Unterordnern per Textsuche. Die Engine-`tsconfig.json` lädt `@types/node` (für `crypto-rng.ts` und Tests).

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
| `phase` | `betting` → `complete` |
| `toActId` | wer am Zug ist (`null` außerhalb von `betting`) |
| `currentBet` | zu bringender Straßeneinsatz (preflop mindestens der Big Blind, auch wenn der BB All-in für weniger ist) |
| `minRaise` | Größe des letzten vollständigen Bets/Raises der Straße, mindestens Big Blind |
| `log[]` | Protokoll: `{ street, playerId, type, amount, to, allIn }`, `type` ∈ ante, smallBlind, bigBlind, fold, check, call, bet, raise (All-in wird als call/bet/raise mit `allIn: true` protokolliert) |
| `payouts` | Auszahlungen bei `complete` (je Spieler, nach Sitz, nur > 0, inkl. zurückgegebener eigener Einsätze), sonst `null` |
| `showdown` | Showdown-Ergebnis (Pots, Gewinner, gezeigte Karten), nur bei `complete` nach Showdown, sonst `null` – siehe „Engine: Pots und Showdown“ |

Chip-Erhaltung: Solange `phase !== 'complete'`, gilt Σ`stack` + Σ`totalBet` = Σ`startStack`; bei `complete` ist alles ausgezahlt (Σ`stack` = Σ`startStack`, `totalBet` bleibt als Protokoll stehen, Σ`payouts` = Σ`totalBet`). `status` beschreibt bei `complete` nur den Verlauf der Hand (ein `allIn`-Gewinner hat danach wieder Chips).

### Phasen
- `betting`: Setzrunde läuft. Preflop beginnt der Spieler links vom Big Blind, postflop der erste aktive links vom Button (Heads-up damit: Button/SB preflop zuerst, postflop zuletzt). Gefoldete und All-in-Spieler werden übersprungen.
- Eine Setzrunde endet, wenn jeder aktive Spieler gehandelt und den `currentBet` gebracht hat – oder wenn nur noch ein aktiver Spieler übrig ist, der keinen tatsächlichen Einsatz mehr callen muss. Kann danach höchstens ein Spieler handeln, läuft das Board automatisch bis zum River durch.
- `complete` (Fold-out): alle bis auf einen haben gefoldet; der bekommt `potTotal` (inkl. eigenem nicht gecallten Einsatz), `payouts` ist gesetzt, `showdown` ist `null`.
- `complete` (Showdown): River-Setzrunde beendet bzw. Board durchgelaufen, mindestens zwei Spieler übrig. Der Showdown wird im selben `applyAction`- (bzw. `startHand`-)Aufruf aufgelöst; es gibt keinen Zwischenzustand. Details: „Engine: Pots und Showdown“.

### Aktionssemantik (`Action`)
- `fold` – immer erlaubt (auch wenn Check möglich wäre). `check` – nur ohne offenen Einsatz. `call` – bringt `min(currentBet − streetBet, stack)`; mit zu kleinem Stack ein All-in-Call.
- `bet { amount }` – nur ohne Einsatz in der Straße; `raise { amount }` – nur bei bestehendem Einsatz. **`amount` ist der Gesamteinsatz dieser Straße danach („raise to“)**, nicht der Zuwachs.
- `allIn` – setzt den ganzen Stack; je nach Betrag Call, Bet oder Raise.
- No-Limit: Mindest-Bet = Big Blind; Mindest-Raise auf `currentBet + minRaise`; Maximum = `streetBet + stack`. Weniger als das Minimum geht nur per `allIn`. Ein All-in, das um mindestens `minRaise` erhöht, ist ein voller Raise und setzt `minRaise` neu; sonst ist es unvollständig (`currentBet` steigt, `minRaise` bleibt).
- Wiedereröffnung (TDA): Ein Spieler darf erhöhen, wenn er in dieser Straße noch nicht gehandelt hat oder seit seiner letzten Aktion insgesamt um mindestens `minRaise` erhöht wurde. Wer nur einem unvollständigen All-in-Raise gegenübersteht, darf nur callen oder folden. Erhöhen ist außerdem nicht erlaubt, wenn kein Gegner mehr handeln kann.
- `legalActions(state)` liefert `{ playerId, toCall, actions }` mit `fold`, `check` oder `call { amount }`, ggf. `bet`/`raise { min, max }` (als „to“-Beträge) und `allIn { amount, to }`. Jede angebotene Aktion wird von `applyAction` akzeptiert (Property-Test).

## Engine: Pots und Showdown
Quelle: `packages/engine/src/showdown.ts` (Typen in `hand-state.ts`), öffentlich über `index.ts`.

```
calculatePots(players: { id, totalBet, status }[]) → { pots: { amount, eligibleIds }[], uncalled: { playerId, amount } | null }
```

- **Integration:** Endet eine Setzrunde nach dem River (oder läuft das Board bei All-in automatisch durch) mit mindestens zwei Spielern, löst `applyAction`/`startHand` den Showdown sofort auf. Aufrufer bekommen also nur `betting` oder `complete` (mit `payouts`) zurück und müssen keine zweite Funktion aufrufen. Begründung: Server und Rundenlogik (WP-008) haben genau einen Übergang „Aktion → nächster Zustand“, Fehlerfälle wie „Showdown vergessen“ sind ausgeschlossen. Ein verzögertes Aufdecken in der Anzeige ist Sache von Server/Client und braucht nur `showdown`.
- **Pots (`calculatePots`)** aus `totalBet` **aller** Spieler (inkl. Ante und gefoldeter Einsätze):
  1. *Nicht gecallter Überschuss:* Der höchste Gesamteinsatz minus den zweithöchsten (über alle Spieler) geht an den Einzahler zurück (`uncalled`). WP-006 erstattet nichts; beim Fold-out bekommt der Übriggebliebene ohnehin alles, dort gibt es keine separate Rückgabe.
  2. *Pot-Grenzen* sind die (verschiedenen) Gesamteinsätze der nicht gefoldeten Spieler, aufsteigend. Pot i enthält von jedem Spieler den Anteil seines Einsatzes zwischen Grenze i−1 und i. Berechtigt sind die nicht gefoldeten Spieler, deren Einsatz mindestens Grenze i erreicht. Erster Pot = Main Pot, danach Side Pots.
  3. Gefoldete Einsätze bleiben als tote Chips in den Pots. Ein Pot mit nur einem Berechtigten (z. B. Einsatz eines Gefoldeten über dem kürzeren All-in) geht ohne Handvergleich an diesen.
  - Während der Hand liefert `calculatePots(state.players)` den aktuellen Stand für die Anzeige (`uncalled` ist dann ein noch offener Einsatz).
- **Vergabe je Pot:** Hände (Hole Cards + Board, `determineWinners`) der Berechtigten in Sitzreihenfolge ab dem ersten Sitz links vom Button vergleichen. Split gleichmäßig; ungerade Chips gehen einzeln nacheinander an die Gewinner in dieser Reihenfolge (TDA). `payouts` = Summe aus Rückgabe und Pot-Anteilen je Spieler, Stacks werden gutgeschrieben, `phase = 'complete'`.
- **`showdown` (`ShowdownSummary`):**

| Feld | Bedeutung |
|---|---|
| `uncalled` | zurückgegebener, nicht gecallter Betrag oder `null` (in `payouts` enthalten) |
| `pots[]` | `{ amount, eligibleIds, winnerIds, winningHand, shares }`; `winnerIds`/`shares` in Vergabereihenfolge ab links vom Button, `winningHand` = `{ category, value, cards, description }` oder `null` (nur ein Berechtigter) |
| `reveals[]` | alle nicht gefoldeten Spieler in Zeigereihenfolge: `{ playerId, shownCards, hand }`; `shownCards` = Hole Cards oder `null` (darf mucken) |
| `allHandsShown` | All-in-Situation – alle Hände werden aufgedeckt |

- **Zeigen und Mucken (TDA):** Gab es auf dem River einen Bet/Raise, zeigt der letzte Aggressor zuerst, sonst der erste nicht gefoldete Spieler links vom Button; danach im Uhrzeigersinn. Ist ein nicht gefoldeter Spieler All-in, werden alle Hände aufgedeckt. Sonst muss zeigen, wer in einem umkämpften Pot mindestens so gut ist wie die bisher gezeigten Hände dieses Pots (der Erste immer, Gewinner damit immer); alle anderen mucken automatisch (`shownCards: null`). `hand` ist für alle bewertet – der Server darf für Mucker weder `hand` noch Hole Cards an Clients senden (D-003).
- **Tests:** `showdown.test.ts` (Tabellen: `calculatePots`; ganze Hände Stacks + Aktionen → Pots, Gewinner, Auszahlungen, Stacks; Zeigereihenfolge), `showdown.property.test.ts` (1.500 seeded Hände, 2–9 Spieler: Chip-Erhaltung, keine negativen Stacks, Σ Pots + Rückgabe = Σ `totalBet`, Pots nur an Berechtigte, Gewinner zeigen).

## Engine: Rundenmodell (Freezeout)
Quellen in `packages/engine/src/`: `round.ts` (Zustandsmaschine), `blind-structure.ts` (Blind-Level), `button.ts` (Button-/Blind-Wanderung), `points.ts` (Punkteformel), öffentlich über `index.ts`. Eine Runde (D-012) ist eine reine, JSON-serialisierbare Zustandsmaschine über vielen Händen; sie nutzt `startHand`/`applyAction` und hält zwischen den Händen nur Stacks, Positionen und Platzierungen.

```
startRound(config, players[{ id, seat }], rng, { buttonSeat? }) → RoundUpdate   // { ok: true, round } | { ok: false, error }
startNextHand(round, nowMs, rng) → RoundUpdate
applyRoundAction(round, playerId, action) → RoundUpdate
roundBlindLevel(round, nowMs) → { smallBlind, bigBlind, levelIndex, nextLevelAtMs }
validateRoundConfig(config) → string | null
placementPoints(placement, playerCount, tiedCount = 1) → number
```

- **Konfiguration (`RoundConfig`):** `startingStack` (ganze Zahl 1 … 10⁸, D-015), `blindStructure`, `turnTimeSeconds` und `timeBankSeconds` (nur durchgereicht, Standard `DEFAULT_TURN_TIME_SECONDS` = 20 / `DEFAULT_TIME_BANK_SECONDS` = 60 laut D-013; Timer führt der Server). `blindStructure` ist `{ type: 'fixed', level: { smallBlind, bigBlind } }` oder `{ type: 'increasing', levels: [...], levelMinutes }`. Keine Antes (D-016): ein `ante`-Feld wird abgelehnt, Hände starten immer mit `ante = 0`. Validierung: Blinds positive ganze Zahlen, `smallBlind < bigBlind`, 1–100 Level, `levelMinutes` positive ganze Zahl. Spieler: 2–9 (D-007), eindeutige nicht-leere IDs, eindeutige Sitze 0–8. Fehlercodes: `INVALID_CONFIG`, `INVALID_PLAYERS`, `INVALID_TIME`, `HAND_IN_PROGRESS`, `NO_HAND_IN_PROGRESS`, `ROUND_FINISHED` sowie unverändert durchgereichte Fehler der Hand (`NOT_YOUR_TURN` …).
- **Standard-Blind-Struktur** `DEFAULT_BLIND_STRUCTURE` (Level `DEFAULT_BLIND_LEVELS`, steigend alle `DEFAULT_LEVEL_MINUTES` = 10 Minuten), Faktor 1,5–1,67 je Level, gedacht für Startstacks 1.500 (75 BB) bis 10.000 (500 BB); die letzten Level liegen über allen Chips von 9 × 10.000, damit jede Runde endet:

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SB/BB | 10/20 | 15/30 | 25/50 | 40/80 | 60/120 | 100/200 | 150/300 | 250/500 | 400/800 | 600/1.200 | 1.000/2.000 |

| Level | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 |
|---|---|---|---|---|---|---|---|---|---|---|
| SB/BB | 1.500/3.000 | 2.500/5.000 | 4.000/8.000 | 6.000/12.000 | 10.000/20.000 | 15.000/30.000 | 25.000/50.000 | 40.000/80.000 | 60.000/120.000 | 100.000/200.000 |

- **Ablauf:** `startRound` setzt alle Stacks auf den Startstack und legt den Button der ersten Hand fest (`buttonSeat` oder zufälliger besetzter Sitz per `rng`), Phase `waiting`. Der Server ruft `startNextHand(round, nowMs, rng)` (Phase `hand`) und reicht Aktionen per `applyRoundAction` durch. Ist die Hand `complete`, übernimmt die Runde die Stacks, platziert Ausgeschiedene (Stack 0) und geht zurück auf `waiting` – die beendete Hand bleibt in `round.hand` (für Anzeige und Speicherung, WP-013), bis die nächste startet. Die nächste Hand startet nie automatisch (Pause für die Showdown-Anzeige ist Sache des Servers). Hat ein Spieler alle Chips, ist die Runde `finished` und `standings` gesetzt. Endet eine Hand schon in `startHand` (alle durch die Blinds All-in), ist sie im Ergebnis von `startNextHand` bereits abgerechnet.
- **Zeit und Blind-Level:** Die Engine liest nie die Uhr; `nowMs` kommt vom Server. Die erste Hand setzt `startedAtMs`. Jede Hand bekommt beim Start das Level `floor((nowMs − startedAtMs) / levelMinutes)` (gekappt auf das letzte Level, nie kleiner als das vorige) – ein abgelaufenes Level wirkt also erst ab der nächsten Hand, nie mitten in einer Hand. `roundBlindLevel(round, nowMs)` liefert das Level, mit dem eine jetzt gestartete Hand liefe, und `nextLevelAtMs` für die Anzeige.
- **Button und Blinds (`button.ts`, TDA „Dead Button“):** Erste Hand: Blinds sind die nächsten beiden Spieler links vom Button (Heads-up: Button = Small Blind). Danach rückt der **Big Blind immer genau einen Spieler weiter** (nächster noch spielender Spieler links vom vorigen Big Blind). Der Small Blind ist fällig auf dem Sitz des vorigen Big Blinds, der Button wandert auf die vorige Small-Blind-Position. Ist der Small-Blind-Sitz leer (voriger Big Blind ausgeschieden), gibt es **keinen Small Blind**; ist die Button-Position leer (voriger Small Blind ausgeschieden), steht der **Button auf dem leeren Sitz**. Niemand überspringt so den Big Blind. **Heads-up** (nur noch zwei Spieler, auch beim Übergang von drei oder mehr): Big Blind wie oben, der andere ist Button und Small Blind und handelt preflop zuerst – wer eben Big Blind war, zahlt ihn nicht direkt noch einmal. `round.positions` = `{ buttonSeat, smallBlindPositionSeat, smallBlindSeat | null, bigBlindSeat }` der aktuellen bzw. letzten Hand.
- **Platzierung:** Wer nach einer Hand Stack 0 hat, scheidet aus und bekommt die Plätze direkt hinter den noch Spielenden. Scheiden mehrere in derselben Hand aus, ist der mit dem größeren Stack zu Handbeginn besser platziert; bei gleichem Stack teilen sie sich den besseren Platz (`sharedPlacement: true`, der nächste Platz wird übersprungen, z. B. 1, 2, 3, 3). Der letzte Spieler mit Chips ist Platz 1. `RoundPlayer` hält `stack`, `placement`, `sharedPlacement`, `eliminatedInHand`.
- **Punkte (`points.ts`, einzige Stelle der Formel, D-012):** Platz k von n Spielern → (n − k), Sieger zusätzlich `WINNER_BONUS_POINTS` = 1. Bei geteiltem Platz bekommt jeder den abgerundeten Durchschnitt der belegten Plätze (TDA: geteilte Plätze teilen den Preis), z. B. zwei Spieler auf Platz 3 von 4 → (1 + 0) / 2 → je 0. Ohne geteilte Plätze ist die Summe n(n − 1)/2 + 1, mit geteilten höchstens das. `standings` = `{ playerId, seat, placement, sharedPlacement, points }[]`, nach Platz (bei Gleichstand nach Sitz) sortiert.
- **Geteilte Plätze in der DB:** Migration `0002_shared_placements` hat `UNIQUE (round_id, placement)` durch einen normalen Index ersetzt, damit das Rundenergebnis auch mit geteilten Plätzen gespeichert werden kann (WP-011). Entschieden in D-018.
- **Nicht verbundene Spieler** behandelt die Engine nicht anders: Der Server (WP-012) schickt für sie automatische Aktionen (Check, sonst Fold) über `applyRoundAction`; Blinds zahlen sie wie alle anderen (D-012).
- **Serialisierbar:** `RoundState` enthält nur JSON-Werte (inkl. `config` als Kopie und der vollständigen `HandState` – serverseitig, D-003). Eingabezustände werden nie verändert.
- **Tests:** `points.test.ts` (Tabellen inkl. geteilter Plätze), `button.test.ts` (Dead-Button- und Heads-up-Tabellen), `round.test.ts` (Validierung, Ablauf, Level-Wechsel erst ab der nächsten Hand, gleichzeitiges Ausscheiden mit gezielt gemischten Decks, Dead Button und Heads-up-Übergang über die Rundenlogik, JSON-Roundtrip an jeder Stelle), `round.simulation.test.ts` (500 Runden mit 2, 200 mit 9 und 60 mit 3–8 seeded Zufalls-Bots: genau ein Sieger, Chip-Erhaltung über alle Hände, Platzierungen 1..n bzw. korrekt geteilt, Punktesumme, Big Blind rückt genau einen Spieler weiter).

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
| `POST /api/login` | `{ username, password }` | `200 { user }` + Session-Cookie | `400` Felder fehlen/zu lang, `401 invalid_credentials`, `403 account_banned` (gesperrt, nur bei richtigem Passwort, WP-028), `429` |
| `POST /api/logout` | – | `204`, Session gelöscht, Cookie geleert (auch ohne Session) | – |
| `GET /api/me` | – | `200 { user }` | `401 unauthorized` (Cookie fehlt, unbekannt oder abgelaufen; ein ungültiges Cookie wird geleert) |
| `DELETE /api/me` | `{ password }` | `204`, Konto anonymisiert, alle Sessions gelöscht, Cookie geleert (WP-022) | `400` Passwort fehlt, `401 unauthorized`, `403 invalid_credentials` (falsches Passwort, Session bleibt), `429` |

`user` = `{ id, username, isAdmin }`. Fehler haben immer die Form `{ error, message }` (`error` ist ein fester Code, `message` deutscher Text für die UI).

### Ablauf
- **Validierung** (`validation.ts`, ohne I/O): Benutzername 3–20 Zeichen aus `[A-Za-z0-9_-]`, eindeutig ohne Rücksicht auf Groß-/Kleinschreibung (Unique-Index auf `lower(username)`; Kollision → `409`). Die Schreibweise der Registrierung bleibt erhalten, Login ist case-insensitive. Passwort 8–128 Zeichen.
- **Passwörter** (`password.ts`): argon2id über `@node-rs/argon2` (Prebuilds inkl. musl für `node:22-alpine`, keine Install-Skripte), Parameter nach OWASP: 19 MiB, `t=2`, `p=1`. In der DB steht nur der PHC-String (`$argon2id$v=19$m=19456,t=2,p=1$…`).
- **Login ohne Hinweis auf existierende Namen:** falsches Passwort, unbekannter Name und ein Name, der die Regeln verletzt, ergeben dieselbe Antwort (`401 invalid_credentials`). Bei unbekanntem Namen wird gegen einen Dummy-Hash mit denselben Parametern geprüft, damit die Laufzeit ähnlich ist.
- **Sessions** (`session.ts`): Token = 32 Zufallsbytes, base64url (43 Zeichen). Die DB speichert nur `sha256(token)` in `sessions.token_hash`; wer die DB liest, kann keine Session übernehmen. Ablauf nach `SESSION_TTL_DAYS` (Standard 30) ab Login, ohne gleitende Verlängerung. Beim Login werden abgelaufene Sessions des Users gelöscht; Logout löscht die Session. Eine Session gilt nur, solange `expires_at > now()` und der Account weder gelöscht (`deleted_at`) noch gesperrt (`banned_at`, WP-028) ist.
- **Cookie** `poker_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Expires` = Session-Ablauf, `Secure` nur bei `NODE_ENV=production` (D-014; in dev läuft alles über `http://localhost`). `SameSite=Lax` verhindert, dass fremde Seiten POSTs mit dem Cookie auslösen.
- **Logging:** Request-Bodies und Header (inkl. `Cookie`) werden nicht geloggt (Fastify-Standard-Serializer loggen nur Methode, URL, Host, IP; in prod in eine täglich rotierte Datei, nach spätestens 14 Tagen gelöscht, D-025); das Auth-Plugin hat einen eigenen Fehler-Handler, der nur Fehlerobjekte loggt. Ein Test fängt die Logs ab und prüft, dass weder Passwort noch Token vorkommen.

### Rate-Limit
`@fastify/rate-limit`, nur für `POST /api/login`, `POST /api/register` und `DELETE /api/me` (je Route ein eigener Zähler, im Speicher des Prozesses). Standard: 10 Anfragen pro 60 s und Client-IP, danach `429 rate_limited`. Gezählt werden alle Anfragen, nicht nur Fehlversuche. Schlüssel: in prod (`NODE_ENV=production`) `CF-Connecting-IP` (Cloudflare, D-014), sonst/fallback `request.ip` – in dev wird der Header ignoriert, sonst ließe sich das Limit per Header umgehen.

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

### Konto löschen (WP-022, DSGVO)
`DELETE /api/me` (in `routes.ts`, Rate-Limit wie Login) prüft das Passwort und ruft `anonymizeAccount(db, userId)` (`account.ts`): **eine** SQL-Anweisung setzt `username`, `password_hash` → `NULL`, `is_admin` → `false`, `deleted_at` → `now()`, löscht alle Sessions des Users und löst Zeilen in `DETACHED_USER_TABLES` vom Account (`user_id → NULL`; derzeit `feedback` aus WP-024, übersprungen, solange die Tabelle fehlt). Die User-Zeile bleibt als Platzhalter, damit Runden, Hände und Aktionen der anderen Spieler vollständig bleiben (siehe „Datenmodell“ → Löschverhalten). Migration `0005` erzwingt per Check-Constraint, dass ein gelöschter Account keinen Namen, Hash und keine Adminrechte hat.
- **Anzeige:** Wer Namen aus `users` liest (Historie, Rangliste, Statistik), nutzt `displayNameSql('u.username')` → `coalesce(u.username, 'Gelöschter Spieler')` bzw. die Konstante `DELETED_USER_NAME`.
- **Laufende Verbindungen:** `buildApp` übergibt `onAccountDeleted`; `registerWebSocket` schließt alle offenen WebSockets des Users (Code `1008`, `CLOSE_ACCOUNT_DELETED`). Sitzt er an einem laufenden Tisch, gilt er als getrennt und wird automatisch gecheckt/gefoldet (D-022); die Runde läuft für die anderen weiter und wird mit seiner (anonymisierten) ID gespeichert. Bis Rundenende steht im Speicher des Tisches noch der alte Name.
- **Neue Tabellen mit `user_id`:** personenbezogene Inhalte entweder in `DETACHED_USER_TABLES` aufnehmen (Zeile bleibt, Bezug weg) oder im selben Statement löschen – ein `ON DELETE`-Verhalten greift nicht, weil die User-Zeile nicht gelöscht wird.
- **Tests:** `auth/account.db.test.ts` (Fehlerfälle, Anonymisierung, Sessions, Name wieder frei, Feedback-Stellvertretertabelle, Constraint, Löschen mitten in einer laufenden Runde mit WebSocket-Trennung und konsistenter Historie).

### Admin
Admin-Flag `users.is_admin` (in `/api/me` als `isAdmin`). CLI-Skripte in `src/cli/` mit Kernlogik in `auth/admin.ts` (getestet): `admin:reset-password` setzt ein neues Passwort und löscht in derselben SQL-Anweisung alle Sessions des Users, `admin:make-admin` setzt/entzieht das Flag. Beide schreiben ins Admin-Protokoll (`source = 'cli'`, ohne Admin). Das Admin-Flag gibt es nur per CLI, nicht über die API (D-029). Aufrufe: README, Abschnitt „Admin“.

### Admin (WP-028)
Rollenmodell und Begründung: D-029. Code in `apps/server/src/admin/`, Migration `0007_admin.sql`.

- **Guard** (`admin/guard.ts`, `registerAdminGuard(app, db)` in `buildApp` vor allen Plugins): ein `onRequest`-Hook an der Wurzel-Instanz prüft **jede** Anfrage auf `/api/admin` oder `/api/admin/*` (roher Pfad oder Routenmuster – auch prozentkodierte Varianten und unbekannte Pfade): ohne gültige Session `401 unauthorized`, ohne Admin-Flag `403 forbidden`, sonst `request.adminUser`. Neue Admin-Routen brauchen keine eigene Prüfung; die Feedback-Admin-Routen (WP-024) nutzen ebenfalls nur den Guard. Ein Test sammelt per `onRoute` alle `/api/admin`-Routen und prüft 401/403 für jede.
- **Sperre:** `users.banned_at` (`NULL` = nicht gesperrt). Sperren löscht alle Sessions in derselben SQL-Anweisung, `getUserFromSessionToken` lässt gesperrte Accounts zusätzlich nie durch (damit auch kein WebSocket-Upgrade, 401). Offene WebSockets schließt `closeUserConnections` mit Close-Code **4002** (`CLOSE_ACCOUNT_BANNED`, Protokoll). Am Tisch gilt der Spieler danach als getrennt (Auto-Check/Fold, D-022). Login mit richtigem Passwort → `403 account_banned` („Dein Konto ist gesperrt …“, die Login-Seite zeigt die Server-Meldung); mit falschem Passwort wie immer `401`. Admins und man selbst können nicht gesperrt werden (`409`).
- **Admin-Protokoll** (`admin_audit_log`, `admin/audit.ts`): `admin_id` (`NULL` = CLI oder Admin-Account gelöscht), `action` (`bereich.aktion`, Check-Constraint auf das Format, erlaubte Codes als TS-Typ `AuditAction`: `user.ban`, `user.unban`, `user.sessions_revoke`, `user.password_reset`, `user.admin_grant`, `user.admin_revoke`, `table.close`, `table.reveal_cards` (WP-033, `source = 'ws'`)), `target_user_id`, `target_table_id`, `details` (JSON-Objekt, **keine Namen oder Passwörter**, Freitext nur unter `reason`), `source` (`api`/`cli`/`ws`), `created_at`. Nutzeraktionen schreiben ihren Eintrag in derselben SQL-Anweisung (CTE) wie die Änderung; `table.close` schreibt den Eintrag vor dem Schließen. Ohne Änderung (z. B. Flag schon gesetzt) kein Eintrag. `writeAudit(db, input)` für weitere Aktionen.
- **Konto-Löschung:** Trigger auf `users` (`BEFORE DELETE` und `AFTER UPDATE OF deleted_at`) setzen `admin_id` bzw. `target_user_id` des gelöschten Accounts auf `NULL` und entfernen als Ziel zusätzlich `details.reason`. `anonymizeAccount` leert `banned_at`; der Check `users_deleted_is_anonymized` verlangt das.
- **Speicherdauer (D-025):** Einträge werden 1 Jahr nach `created_at` gelöscht (`purgeExpiredAudit`, `startAuditPurgeJob` beim Start und täglich, `main.ts`).

| Methode und Pfad | Body / Query | Erfolg | Fehler |
|---|---|---|---|
| `GET /api/admin/users` | `?search=` (Teil des Namens), `?limit=` (1–200, Standard 50) | `200 { users: AdminUser[] }` alphabetisch, ohne gelöschte | `400` |
| `GET /api/admin/users/:id` | – | `200 { user }` | `404` |
| `POST /api/admin/users/:id/ban` | `{ reason? }` (≤ 500 Zeichen) | `200 { user }`; Sessions gelöscht, WS mit 4002 geschlossen | `400`, `404`, `409 conflict` (selbst, Admin, schon gesperrt) |
| `POST /api/admin/users/:id/unban` | – | `200 { user }` | `404`, `409` (nicht gesperrt) |
| `POST /api/admin/users/:id/sessions/revoke` | – | `200 { revoked }`; WS mit 1008 geschlossen | `404` |
| `POST /api/admin/users/:id/password` | – | `200 { password }` (16 Zeichen, einmalig, `Cache-Control: no-store`); Sessions gelöscht, WS mit 1008 geschlossen | `404` |
| `POST /api/admin/tables/:id/close` | – | `200 { table: { tableId, status, roundId, seated, roundAborted } }` | `404` (nicht im Speicher) |
| `GET /api/admin/audit` | `?limit=` (1–500, Standard 100), `?before=<id>` (Blättern), `?action=`, `?userId=` (Admin oder Ziel), `?tableId=` | `200 { entries: AuditEntry[] }` neueste zuerst | `400` |

`AdminUser` = `{ id, username, isAdmin, createdAt, bannedAt, sessions }` (`sessions` = gültige Sessions). `AuditEntry` = `{ id, createdAt, action, source, admin: { id, username } | null, targetUser: { id, username } | null, targetTableId, details }`. Fehler: `{ error, message }` mit `unauthorized`/`forbidden` (Guard), `invalid_request`, `not_found`, `conflict`, `internal`.

**Tisch schließen:** `GameServer.closeTableByAdmin(id)` → `Table.terminate()` (Timer aus; laufende Runde `abortRound` = `aborted` ohne Punkte wie D-019, sonst `closeTable`), `table.closed { reason: 'admin' }` an alle Beobachter, Tisch aus Speicher und Lobby. Gespeicherte Hände bleiben.

**Karten aufdecken (WP-033, D-027):** `admin.revealCards { tableId, seat }` → `CardRevealer` (`game/admin-reveal.ts`) prüft: Admin-Flag der Verbindung (aus der Session beim Upgrade, `GameServer.connect(user, conn, { isAdmin })` – nie vom Client), Admin sitzt am Tisch, Hand läuft (`phase: betting`), Zielplatz ist ein anderer Spieler mit Karten (nicht gefoldet). Dann schreibt `recordCardReveal` (`admin/reveal.ts`, als `revealAudit` an den `GameServer` übergeben) den Eintrag `table.reveal_cards` (`admin_id`, `target_user_id`, `target_table_id`, `details { roundId, handNumber, seat }`, `source = 'ws'`) – in **einer** Anweisung zusammen mit der Prüfung, dass der Account jetzt noch Admin, nicht gesperrt und nicht gelöscht ist (ein per CLI entzogenes Flag greift sofort, auch bei offener Verbindung). Erst danach gehen die Karten als `admin.cards` an genau diese Verbindung; andere Verbindungen bekommen keine Nachricht. Verneint die DB das Recht → `FORBIDDEN`, schlägt das Schreiben fehl → `INTERNAL`, jeweils ohne Karten. Endet die Hand während des Schreibens, gibt es keine Karten (`NO_HAND_IN_PROGRESS`). Pro Tisch, Hand, Admin und Platz wird nur einmal protokolliert (Cache im `CardRevealer`, verfällt mit der Hand; erneutes Anfordern – z. B. nach Reload – liefert die Karten ohne neuen Eintrag). Ohne `revealAudit` ist Aufdecken abgeschaltet. Keine Migration nötig.

**Tests:** `admin/admin.db.test.ts` (Guard für alle Routen, Sperre mit Sessions/WebSocket/Login, Sperre am laufenden Tisch, Regeln, Sessions beenden, Passwort-Reset, Tisch schließen offen/laufend, Protokoll mit Filtern/Blättern/CLI, Anonymisierung, Constraints, Löschfrist).

### Tests
`auth/auth.unit.test.ts` (ohne DB: Validierung, Token/Hashing, argon2id-Parameter, Config, Client-IP) und `auth/auth.db.test.ts` (Integration gegen die Test-DB über `app.inject()`: alle Endpunkte inkl. Fehlerfälle, Cookie-Flags dev/prod, Ablauf, Rate-Limit, Logs, `getUserFromCookieHeader`, Admin-Funktionen). `npm run test:db -w @poker/server` führt alle Server-Tests mit Test-DB aus.

## Game-Server: Protokoll und Tische
Quellen: Protokoll in `packages/engine/src/protocol/` (Subpfad `@poker/engine/protocol`), Server in `apps/server/src/game/` und `ws.ts`. Der Server ist autoritativ (D-003): nur er mischt (`cryptoRng`), hält den Spielzustand und prüft jede Aktion über die Engine (`startRound`, `startNextHand`, `applyRoundAction`).

### Protokoll (`@poker/engine/protocol`)
- **Ort:** im Engine-Paket statt in einem eigenen Workspace – kein neues Paket in Root-Workspaces, Lockfile und Build; die Typen hängen ohnehin an Engine-Typen (`Action`, `LegalActions`, `ShowdownHand`, `RoundStanding`). Das Modul ist rein (fällt unter die Engine-Reinheitsregeln) und browser-tauglich, Web und Server importieren es gleich. `index.ts` der Engine bleibt unverändert.
- **Validierung:** handgeschrieben (`validate.ts`) statt `zod`: keine neue Abhängigkeit, im Browser nutzbar, und die Regeln (ganze Zahlen, Bereiche, Blind-Struktur über `validateRoundConfig`) sind Engine-Wissen. `parseClientMessage(text)` parst JSON, prüft `type` und alle Felder und kopiert nur bekannte Felder in ein neues Objekt; `validateTableSettings(input)` ergänzt Defaults.
- **Format:** JSON-Textframes, max. `MAX_MESSAGE_BYTES` = 64 KiB. Jede Nachricht hat `type` (diskriminierte Unions `ClientMessage`/`ServerMessage`). Client-Nachrichten dürfen eine `requestId` (≤ 64 Zeichen) tragen; sie kommt in `error` bzw. `table.created` zurück. Engine-Spieler-ID = `String(userId)`.

| Client → Server | Felder | Wirkung |
|---|---|---|
| `hello` | `protocolVersion` | Handshake, muss zuerst kommen; andere Version → `error UNSUPPORTED_VERSION` und Schließen mit Code 4000. Eine ältere Verbindung desselben Users wird dabei mit 4001 geschlossen (WP-012) |
| `ping` | – | Anwendungs-Heartbeat (WP-012), auch vor `hello` erlaubt → `pong` |
| `lobby.subscribe` / `lobby.unsubscribe` | – | Lobby-Liste abonnieren (`lobby.snapshot`, danach Updates) bzw. abbestellen |
| `table.create` | `settings` (`name` Pflicht; `isPublic`, `maxSeats`, `startingStack`, `blindStructure`, `turnTimeSeconds`, `timeBankSeconds` optional) | Tisch anlegen (DB `tables`), Ersteller beobachtet ihn automatisch |
| `table.join` | `tableId` **oder** `inviteCode` | Tisch beobachten (Zuschauen). Private Tische nur per Code (außer Ersteller und Spieler am Tisch), sonst `TABLE_NOT_FOUND` |
| `table.leave` | `tableId` | nicht mehr beobachten; vor dem Start steht man dabei auch auf |
| `table.sit` / `table.stand` | `tableId`, `seat` (0 … `maxSeats` − 1) | Platz nehmen/aufstehen, nur vor dem Start |
| `table.start` | `tableId` | nur Ersteller, ≥ 2 Spieler; danach kein Einstieg mehr (D-012) |
| `table.rematch` | `tableId` | „Nochmal“ (D-020, D-024): nur Ersteller, nur im Status `finished`; neue Runde mit den verbundenen Spielern, getrennte stehen vorher auf. Sonst `ROUND_NOT_FINISHED`, `NOT_CREATOR` bzw. `NOT_ENOUGH_PLAYERS` (< 2 verbunden) |
| `table.action` | `tableId`, `handNumber`, `seq`, `action` (`fold`, `check`, `call`, `bet`/`raise` mit `amount` = „to“, `allIn`) | Aktion des Spielers am Zug |
| `admin.revealCards` | `tableId`, `seat` | Nur Admins (WP-033, D-027): verdeckte Karten des Mitspielers auf `seat` anfordern → `admin.cards` nur an diese Verbindung. Fehler: `FORBIDDEN` (kein Admin laut Session oder DB), `NOT_AT_TABLE`, `NOT_SEATED` (Admin sitzt nicht), `NO_HAND_IN_PROGRESS`, `INVALID_SEAT` (eigener/leerer Platz, gefoldet). Details: „Karten aufdecken (WP-033)“ |

| Server → Client | Inhalt |
|---|---|
| `welcome` | `protocolVersion`, `user { id, username }`, `isAdmin` (Admin-Flag der Session, WP-033; optional, fehlt = `false`) |
| `pong` | `requestId`, `serverNowMs` (Antwort auf `ping`) |
| `error` | `code`, `message` (deutsch), `requestId`, `tableId` – nur an den Absender |
| `lobby.snapshot` / `lobby.update` / `lobby.remove` | alle öffentlichen offenen/laufenden Tische bzw. ein geänderter Eintrag (`LobbyTable`: Name, Ersteller, Status, Spieler/Plätze, Startstack, Blinds des ersten Levels, Blind-Typ, Zeitlimit, Zeitbank) bzw. Tisch weg (privat nie) |
| `table.created` | `requestId`, `tableId`, `inviteCode` |
| `table.state` | `TableView` – vollständige, für den Empfänger gefilterte Sicht, nach **jeder** Änderung neu |
| `table.left` | Bestätigung von `table.leave` |
| `table.roundFinished` | `standings` mit `user`, Platz, `sharedPlacement`, Punkten |
| `admin.cards` | `requestId`, `tableId`, `handNumber`, `seat`, `cards` – Antwort auf `admin.revealCards`, **nur** an die anfragende Admin-Verbindung (WP-033) |
| `table.closed` | `tableId`, `reason: 'abandoned' \| 'admin'` – verwaiste Runde abgebrochen (D-022) bzw. von einem Admin geschlossen (WP-028, laufende Runde ohne Punkte), an alle verbliebenen Beobachter; der Tisch existiert danach nicht mehr |

Fehlercodes (`ErrorCode`): `BAD_MESSAGE`, `UNSUPPORTED_VERSION`, `HELLO_REQUIRED`, `INVALID_SETTINGS`, `TABLE_NOT_FOUND`, `NOT_AT_TABLE`, `INVALID_SEAT`, `SEAT_TAKEN`, `TABLE_FULL`, `ALREADY_SEATED`, `NOT_SEATED`, `ROUND_STARTED`, `NOT_CREATOR`, `NOT_ENOUGH_PLAYERS`, `ROUND_NOT_FINISHED`, `NO_HAND_IN_PROGRESS`, `STALE_ACTION`, `NOT_YOUR_TURN`, `INVALID_ACTION`, `ILLEGAL_ACTION`, `AMOUNT_TOO_SMALL`, `AMOUNT_TOO_LARGE` (die letzten fünf aus der Engine), `FORBIDDEN` (nur Admins, WP-033), `INTERNAL`.

- **Tisch-Einstellungen:** Defaults `DEFAULT_TABLE_SETTINGS`: öffentlich, 9 Plätze, Startstack `DEFAULT_STARTING_STACK` = 1.500, Standard-Blind-Struktur der Engine (steigend, D-012), 20 s Zug, 60 s Zeitbank (D-013); keine Antes (D-016). Grenzen (Konstanten im Protokoll, auch vom Web-Formular genutzt): Name 1–50 Zeichen (`TABLE_NAME_MAX_LENGTH`), 2–9 Plätze (`MIN_SEATS`/`MAX_SEATS`, D-007), Startstack 1 … 10⁸ (`MAX_STARTING_STACK`, D-015), Zug 10–120 s (`MIN_/MAX_TURN_TIME_SECONDS`, D-020), Zeitbank 0–300 s (`MIN_/MAX_TIME_BANK_SECONDS`, D-020), Level-Dauer 1–1.440 min (`MIN_/MAX_LEVEL_MINUTES`), Big Blind des ersten Levels ≤ Startstack (DB-Constraint). Das Protokoll bleibt Version 1 (WP-015 ergänzt nur Nachrichten). In der DB: `small_blind`/`big_blind` = erstes Level, `blind_structure` = die `BlindStructure` der Engine als JSON.
- **`TableView`:** `id`, `inviteCode`, `createdBy`, `settings`, `status` (`open` → `running` → `finished`, per `table.rematch` wieder `running`), `seats[]` (`seat`, `user`, `connected`, `timeBankMs`), `spectators` (Anzahl), `round` (`RoundView` oder `null`), `turnClock` (`TurnClockView` oder `null`), `serverNowMs`, `you { userId, seat, isCreator }` – Zeitfelder siehe „Timer und Verbindungsmodell“. `RoundView` = `toClientView(round, viewerId, nowMs)`: Phase, Handnummer, `blindLevel` (aktuelles Level, `nextLevelAtMs`), Stacks/Platzierungen, `hand` (`HandView`), `standings`.

### Filterung pro Empfänger (D-003)
`toClientView(round, viewerId, nowMs)` bzw. `toHandView(hand, handNumber, viewerId)` (rein, `view.ts`): eigene Hole Cards immer; fremde nie vor dem Showdown und im Showdown nur `shownCards` (gemuckte nie); Deck und verbrannte Karten nie (die Felder fehlen); Handbewertungen (`reveals[].hand`) nur für gezeigte und die eigene Hand; `legalActions` nur für den Empfänger, wenn er am Zug ist; Zuschauer (`viewerId = null`) sehen keine Hole Cards. Das gilt auch für Admins – deren aufgedeckte Karten kommen ausschließlich über `admin.cards` (WP-033), nie über `table.state`. Zusätzlich: `actionSeq` (= Länge des Hand-Protokolls), `pot`, öffentliches `log`, `payouts`, Pots mit Gewinnern. Der Server berechnet die Sicht für jede Verbindung einzeln.

### Ablauf
1. **Upgrade** auf `/ws`: Origin-Prüfung (`403`), Session aus dem Cookie (`401`), sonst Verbindung. Der Browser schickt das Cookie automatisch mit (gleiche Origin über Vite-Proxy in dev bzw. nginx in prod, D-014); geprüft in dev über den Vite-Proxy und im Prod-Smoke-Test (`401` ohne Session, mit `SMOKE_COOKIE` voller Handshake).
2. `hello` → `welcome`; danach Lobby abonnieren, Tisch erstellen oder beitreten.
3. **Vor dem Start:** Sitzen/Aufstehen; jede Änderung → `table.state` an alle Beobachter und (bei öffentlichen Tischen) `lobby.update`.
4. **Start** (Ersteller, ≥ 2 Spieler): Status sofort `running` (kein Hinsetzen mehr), DB: `tables.status = running`, `rounds` + `round_players` (ohne Platz/Punkte) in einer SQL-Anweisung; Button zufällig per Rng; erste Hand.
5. **Hand:** Aktionen nur vom Spieler am Zug; `handNumber`/`seq` müssen zur aktuellen Hand passen, sonst `STALE_ACTION` (veralteter Klick, Doppelklick). Engine-Fehler gehen als `error` an den Absender, der Tisch läuft unverändert weiter.
6. **Hand beendet:** `table.state` mit Showdown/Auszahlungen; nach `handPauseMs` (Standard `DEFAULT_HAND_PAUSE_MS` = 4 s, Tests 0) startet die nächste Hand automatisch. Zeit kommt aus der injizierten `Clock` (`systemClock`, Tests `ManualClock`).
7. **Rundenende:** Status `finished` („Runde beendet“), `table.roundFinished` an alle Beobachter, Lobby `lobby.remove`; DB: `rounds` → `finished`, `round_players.placement`/`points`, `tables` → `closed` (eine SQL-Anweisung). Im Speicher bleibt der Tisch mit Sitzen und Ergebnis bestehen.
8. **„Nochmal“** (D-020, WP-015): Der Ersteller sendet `table.rematch`. Der Tisch wartet erst auf ausstehende Schreibvorgänge der vorigen Runde (Hook-Warteschlange), dann `startRound` wie beim ersten Start (DB: neue `rounds`-Zeile mit allen Sitzen, `tables` → `running` und `closed_at = NULL`). Stacks, Zeitbanken und Blind-Level beginnen von vorn. Es spielen nur Spieler mit, die den Tisch gerade beobachten (`connected`, D-024, WP-026): getrennte stehen vor `startRound` automatisch auf (ihr Sitz wird frei, die neue `rounds`-Zeile kennt sie nicht). Sind weniger als 2 verbunden, `NOT_ENOUGH_PLAYERS` und niemand steht auf.
9. **Verwaiste Runde** (D-022, WP-015): Ist in einer laufenden Runde kein Spieler mit Sitz verbunden (Zuschauer zählen nicht), plant `Table.checkOrphaned` den Abbruch nach `orphanTimeoutMs` (`DEFAULT_ORPHAN_TIMEOUT_MS` = 10 min); verbindet sich ein Spieler wieder oder endet die Runde, wird er aufgehoben (die Frist beginnt danach von vorn). Bis dahin läuft die Runde mit Auto-Check/Fold weiter. Beim Abbruch: Timer aus, `abortRound` in der Hook-Warteschlange (DB: Runde `aborted` ohne Platz/Punkte, Tisch `closed`, mit Retry), `table.closed` an Beobachter, `lobby.remove`, Tisch aus dem Speicher. Gespeicherte Hände bleiben (wie D-019).

### Tische im Speicher, Robustheit
- Ein Prozess hält alle Tische (`GameServer` → `Table`); Zustandsänderungen sind synchron, nur DB-Zugriffe und Hooks asynchron. Nachrichten einer Verbindung werden nacheinander verarbeitet. Jede Nachricht läuft in einem `try/catch`: Fehler → `error` an den Absender (`INTERNAL`), andere Tische und der Server laufen weiter. Schlägt das Speichern des Starts fehl, bleibt der Tisch `open`.
- **Verbindungsstatus:** pro Tisch zählt der Server Verbindungen je User, die den Tisch beobachten (`Table.isConnected`, `seats[].connected`). Getrennte Spieler bleiben sitzen (D-012); Regeln für Abbrüche und mehrere Tabs: „Timer und Verbindungsmodell“.
- **Aufräumen (WP-015):** Offene und beendete Tische ohne Beobachter werden nach `idleTableTimeoutMs` (`DEFAULT_IDLE_TABLE_TIMEOUT_MS` = 10 min) geschlossen (`closeTable`, DB `closed`) und aus dem Speicher genommen; beobachtet sie vorher wieder jemand, bleiben sie. Die Frist deckt Reload, den Wechsel Lobby → Tischseite (eigene WebSocket-Verbindung) und das Teilen des Einladungslinks (App-Wechsel am Handy) ab. Sofort aufgeräumt wird, wenn der letzte Beobachter per `table.leave` geht und niemand mehr sitzt bzw. die Runde beendet ist. Laufende Tische: siehe „Verwaiste Runde“. `idle()` wartet auch auf Schreibvorgänge bereits entfernter Tische.
- **Einladungscode:** Wer einem privaten Tisch per `inviteCode` beigetreten ist, darf ihn danach auch per `tableId` betreten (`Table.invite`/`isInvited`, nur im Speicher) – z. B. die Tischseite nach der Einladungsseite oder nach einem Reload.
- **Repository:** `TableRepository` (`createTable`, `startRound`, `finishRound`, `abortRound`, `closeTable`) mit `createPgTableRepository(db)` (Betrieb) und `InMemoryTableRepository` (Tests ohne DB).
- **Neustart:** Tische und laufende Runden gehen verloren. Beim Start ruft `main.ts` `closeOrphanedTables(db)` auf: laufende Runden → `aborted` (ohne Platz/Punkte), offene und laufende Tische → `closed`. Clients verbinden sich neu und sehen eine leere Lobby. Bereits gespeicherte Hände bleiben (D-019, Details unter „Datenmodell“ → „Persistenz“).

### Erweiterungspunkte
- **Hooks** (`GameHooks`, `buildApp({ game: { hooks } })`), genutzt von der Hand-Historie (WP-013): `onHandStarted` (Hand nach Austeilen und Blinds), `onHandComplete` (abgeschlossene Hand + Runde danach + `autoActionSeqs` = `seq` der vom Server per `autoCheckOrFold` ausgeführten Aktionen), `onRoundComplete` (Ergebnis mit `userId`). Sie bekommen den vollständigen Serverzustand inkl. Deck und Hole Cards (nie an Clients geben), laufen pro Tisch strikt nacheinander in Ereignisreihenfolge (zusammen mit den DB-Schreibvorgängen), werden vom Spielablauf aber nicht abgewartet; Fehler werden geloggt und stören den Tisch nicht. `app.game.idle()` wartet auf alle eingereihten Hooks.
- **Server-Aktionen:** `Table.actFor(userId, action)` (Aktion im Namen eines Spielers ohne `seq`-Prüfung), `Table.autoCheckOrFold(userId)` (D-013), `Table.isConnected(userId)`, `GameServer.getTable(id)` – genutzt vom Zug-Timer (WP-012).

### Tests
- `packages/engine/src/protocol/validate.test.ts` (gültige/ungültige Nachrichten, Defaults, Grenzen), `view.test.ts` (eigene/fremde Karten, Zuschauer, `legalActions`, Showdown mit Mucks, All-in, Fold-out, keine geteilten Referenzen).
- `apps/server/src/ws.test.ts` (Upgrade `401`/`403`/`404`/`500`, Handshake, Versionsfehler, ungültige und zu große Nachrichten, Heartbeat), `game/game-server.test.ts` (ohne Netzwerk, `ManualClock`: Pause nach der Hand, Blind-Level, WP-012-Erweiterungspunkte, DB-Fehler beim Start), `game/game.ws.test.ts` (echte WebSockets, Port 0, In-Memory: 3 Bots spielen eine Runde bis zum Sieger, kein Client sieht je fremde Hole Cards – geprüft über alle empfangenen Nachrichten, strukturell und per Textsuche gegen die echten Karten aus `onHandStarted`; unerlaubte Aktionen, Start durch Nicht-Ersteller, Beitritt nach Start, 10. Spieler; Lobby-Updates; private Tische; Hook-Fehler), `game/game.db.test.ts` (mit `TEST_DATABASE_URL`: echte Sessions, Runde mit DB-Einträgen, `401` bei abgelaufener Session, geteilte Plätze, Neustart-Aufräumen). Hilfen: `game/ws-test-client.ts` (Client mit Mitschnitt, Bot, Leak-Prüfung).
- WP-015: `game/lifecycle.test.ts` (ohne Netzwerk, `ManualClock`: „Nochmal“ mit denselben Spielern und neuer Runde, nur Ersteller, nicht vor/während der Runde, getrennte Spieler stehen auf bzw. `NOT_ENOUGH_PLAYERS` bei < 2 verbundenen (WP-026); verwaiste Runde nach genau 10 min `aborted`, Frist beginnt nach Rückkehr neu, Zuschauer zählen nicht, beendete Runde bleibt; Leerlauf-Aufräumen; Rückkehr per `tableId` nach Beitritt per Code), `history/history.db.test.ts` (Postgres: verwaiste Runde → `aborted`, Tisch `closed`, Hände bleiben; „Nochmal“ → zwei gewertete Runden am selben Tisch), `protocol/validate.test.ts` (D-020-Grenzen, `table.rematch`).
- WP-012: `game/timer.test.ts` (ohne Netzwerk, `ManualClock`: Deadline/Zeitbank/`serverNowMs` in der Sicht, Ablauf → Fold bzw. Check, anteiliger Zeitbank-Verbrauch, Zeitbank 0, getrennter Spieler → Gnadenfrist ohne Zeitbank, alle Spieler getrennt → Runde läuft mit Blinds bis zum Ende, Reconnect in der Gnadenfrist, Ablösung durch neuere Verbindung, `ping`), `game/reconnect.ws.test.ts` (echte WebSockets mit `ManualClock`: harter Abbruch mitten in der Hand → neue Verbindung → identischer Zustand, Auto-Fold nach Gnadenfrist, zweiter Tab → 4001, `ping`/`pong`).
- WP-033: `game/admin-reveal.test.ts` (ohne Netzwerk: Karten nur an den Admin, keine Nachricht an Mitspieler/Zuschauer, einmal protokolliert pro Hand und Platz, `FORBIDDEN`/`NOT_SEATED`/`NOT_AT_TABLE`/`NO_HAND_IN_PROGRESS`/`INVALID_SEAT`, Protokoll verneint bzw. scheitert, Hand endet während des Schreibens), `game/admin-reveal.ws.test.ts` (echte WebSockets: ganze Runde, Admin fordert in jeder Hand alle Karten an, Nicht-Admin bekommt nur `FORBIDDEN`; Leak-Prüfung aller anderen Verbindungen per Textsuche), `admin/reveal.db.test.ts` (Test-DB: Eintrag `table.reveal_cards` mit Namen in `/api/admin/audit`, Nicht-Admin, entzogenes Flag bei offener Verbindung, `recordCardReveal` nur für aktive Admins).

### Timer und Verbindungsmodell
Umsetzung: `Table` (`syncTurn`, `endTurn`, `scheduleDeadline`) und `GameServer` (`takeOver`, `ping`). Timer laufen nur auf dem Server (D-013) über die injizierte `Clock`.

- **Zug-Timer:** Nach jedem Spielschritt (`afterTransition`, vor dem Senden der Sichten) gleicht `syncTurn` den Timer mit der Hand ab. Ein Zug ist `(handNumber, actionSeq)` – jede neue Aktion startet einen neuen Zug, auch wenn derselbe Spieler wieder dran ist (z. B. Big Blind preflop und dann zuerst auf dem Flop). Ein Zug hat `turnTimeSeconds` normale Zeit, danach läuft die **Zeitbank** des Spielers. Es gibt genau einen Timer pro Tisch, geplant auf `deadlineMs = turnEndsAtMs + Zeitbank zu Zugbeginn`; bei Ablauf `autoCheckOrFold` (Check, wenn erlaubt, sonst Fold). Der Übergang „normale Zeit → Zeitbank“ erzeugt keine Nachricht – die Deadline steht von Anfang an fest.
- **Zeitbank:** pro Spieler und Runde (`timeBankSeconds`, Standard 60 s, D-013), im Speicher des Tisches. Abgezogen wird beim Ende des Zugs nur die Zeit über `turnEndsAtMs` hinaus (`min(Zeitbank, max(0, Ende − turnEndsAtMs))`); wer innerhalb der normalen Zeit handelt, verliert nichts. Ein Timeout verbraucht die gesamte Restbank; danach hat der Spieler nur noch die normale Zugzeit.
- **Getrennte Spieler (D-012):** bleiben sitzen, zahlen Blinds wie alle (Engine). Ist der Spieler am Zug ohne Verbindung zum Tisch (oder trennt er sich während seines Zugs), wird die Deadline auf `min(normale Deadline, jetzt + DISCONNECT_GRACE_MS)` verkürzt (`DEFAULT_DISCONNECT_GRACE_MS` = 3 s, `GameServerOptions.disconnectGraceMs`). Kommt er in der Frist zurück, gilt wieder die normale Deadline. Eine Auto-Aktion innerhalb der normalen Zugzeit kostet keine Zeitbank. Der Tisch wartet so pro Zug höchstens 3 s auf einen Getrennten; sind alle getrennt, läuft die Runde allein weiter (mit steigenden Blinds bis zum Ende). Als „verbunden“ zählt, wer mindestens eine Verbindung hat, die den Tisch beobachtet – wer `table.leave` sendet, gilt also auch als getrennt.
- **Zeit in der Sicht:** `TableView.serverNowMs` (Server-Uhr beim Erstellen der Sicht), `seats[].timeBankMs` (Restbank zu `serverNowMs`; vor dem Start der volle Wert) und `turnClock` (`null`, wenn niemand am Zug ist):

  | `TurnClockView` | Bedeutung |
  |---|---|
  | `playerId`, `seat`, `handNumber`, `actionSeq` | wer am Zug ist, zu welcher Aktion |
  | `startedAtMs` | Zugbeginn |
  | `turnEndsAtMs` | Ende der normalen Zugzeit |
  | `deadlineMs` | automatische Aktion; `> turnEndsAtMs` → dazwischen läuft die Zeitbank; `≤ turnEndsAtMs` → keine Zeitbank-Phase (leer oder Spieler getrennt) |

  Alle Zeitpunkte sind Server-Uhr (ms seit Epoche). Client: beim Empfang `offset = serverNowMs − Date.now()` merken, Restzeit = `deadlineMs − (Date.now() + offset)`; Ring Phase 1 bis `turnEndsAtMs`, Phase 2 (Zeitbank) bis `deadlineMs`. Neue `table.state` kommen nur bei Änderungen (Aktion, Verbindungswechsel, neue Hand), nicht im Sekundentakt.
- **Mehrere Verbindungen desselben Users:** Pro User ist höchstens eine Verbindung aktiv. Sendet eine neue Verbindung `hello`, wird die ältere sofort von Lobby und Tischen abgemeldet, ihre weiteren Nachrichten werden ignoriert, und sie wird mit Close-Code **4001** (`CLOSE_REPLACED`, Grund `replaced by newer connection`) geschlossen. Die neue Verbindung erbt **keine** Abos – sie sendet selbst `lobby.subscribe`/`table.join`. Bis dahin gilt der Spieler kurz als getrennt (Gnadenfrist deckt das ab).
- **Reconnect:** Session = Cookie; eine neue WebSocket-Verbindung mit `hello` und `table.join { tableId }` liefert sofort die gefilterte Sicht inkl. eigener Hole Cards, Zeitbank und Zug-Uhr. Spieler am Tisch dürfen auch private Tische per `tableId` wieder betreten. Eine halb-offene alte Verbindung (Netz weg ohne Close) wird dabei per 4001 abgelöst.
- **Heartbeat:** Der Server pingt alle 30 s (`HEARTBEAT_INTERVAL_MS`, D-014) und beendet Verbindungen ohne Pong; Browser beantworten Pings automatisch, sehen sie aber nicht. Deshalb gibt es zusätzlich `ping` → `pong { requestId, serverNowMs }` auf Anwendungsebene.
- **Was der Client tun muss (WP-018, nicht Teil von WP-012):**
  1. Verbinden auf `/ws` (relativ, `ws:`/`wss:` aus `location`, D-014), sofort `hello { protocolVersion: 1 }`, auf `welcome` warten.
  2. Danach die gewünschten Abos neu herstellen: `lobby.subscribe` bzw. `table.join { tableId }` für den offenen Tisch. Der erste `table.state` ersetzt den lokalen Zustand vollständig (keine Diffs).
  3. Alle ~20 s `ping` senden (hält auch Cloudflare-Idle-Timeouts fern); kommt binnen ~10 s kein `pong` (oder irgendeine Nachricht), Verbindung als tot behandeln, schließen und neu verbinden. `serverNowMs` aus `pong`/`table.state` für den Uhrabgleich nutzen.
  4. Bei `close`/`error`: neu verbinden mit exponentiellem Backoff (z. B. 0,5 s, 1 s, 2 s … max. 10 s, mit Zufallsanteil), Zähler nach erfolgreichem `welcome` zurücksetzen. Zusätzlich sofort versuchen bei `online` und wenn der Tab wieder sichtbar wird.
  5. **Nicht** automatisch neu verbinden bei Close-Code **4000** (falsche Protokollversion → Hinweis „Seite neu laden“) und **4001** (anderer Tab/Gerät hat übernommen → Hinweis mit Knopf „Hier weiterspielen“, der bewusst neu verbindet). HTTP-Ablehnung beim Upgrade (401: Session abgelaufen) zeigt der Browser nur als Fehler/1006 – nach mehreren Fehlversuchen `GET /api/me` prüfen und ggf. zum Login. Close-Code **4002** (Konto gesperrt, WP-028) und 1008 (Sessions vom Admin beendet bzw. Konto gelöscht) behandeln die Clients derzeit wie einen Abbruch: der Reconnect scheitert mit 401, die Session-Prüfung führt zum Login, das die Sperre meldet. Eigene Behandlung von 4002 (sofort zum Login) ist für die gemeinsame Verbindung (WP-027) vorgesehen.
  6. Aktionen nicht puffern: Nach dem Reconnect zählt nur der neue `table.state` (`handNumber`/`actionSeq` für `table.action`); veraltete Klicks lehnt der Server mit `STALE_ACTION` ab.

## Datenmodell
Postgres 16 (D-010). Schema in `apps/server/migrations/*.sql`, Runner und Zeilentypen in `apps/server/src/db/`.

### Tabellen
| Tabelle | Inhalt | Schlüssel / wichtige Constraints |
|---|---|---|
| `users` | Account: `username`, `password_hash` (argon2id, D-011), `is_admin`, `created_at`, `deleted_at`, `banned_at` (Sperre, 0007) | Unique-Index auf `lower(username)` (case-insensitive), Länge 3–20; `username`/`password_hash` dürfen nur bei gesetztem `deleted_at` `NULL` sein, und bei gesetztem `deleted_at` **müssen** sie `NULL`, `is_admin` `false` und `banned_at` `NULL` sein (0005, 0007) |
| `sessions` | Login-Sessions: `token_hash` (SHA-256 des Tokens, 32 Byte), `user_id`, `created_at`, `expires_at` | PK `token_hash`; Indizes auf `user_id` und `expires_at` (Aufräumen) |
| `tables` | Tisch: `created_by`, `name`, `is_public`, `invite_code` (Link-Code, jeder Tisch hat einen), `max_seats` (2–9, D-007), `starting_stack`, `small_blind`, `big_blind`, `blind_structure` (JSONB, Form legt der Game-Server fest), `turn_time_seconds` (Standard 20) und `time_bank_seconds` (Standard 60, D-013), `status` (`open`/`running`/`closed`), `created_at`, `closed_at` | `invite_code` eindeutig; Partial-Index für die Lobby (öffentlich, nicht geschlossen) |
| `rounds` | Freezeout-Runde (D-012): `table_id`, `started_at`, `finished_at`, `status` (`running`/`finished`/`aborted`) | `finished_at` gesetzt ⇔ Status ≠ `running` |
| `round_players` | Teilnahme: `round_id`, `user_id`, `seat` (0–8), `placement` (1 = Sieger), `points` | PK (`round_id`, `user_id`), Sitz je Runde eindeutig; Platzierung **nicht** eindeutig (geteilte Plätze, Migration 0002), Index (`round_id`, `placement`); `placement`/`points` sind `NULL`, solange die Runde läuft oder bei Abbruch |
| `hands` | Hand einer Runde: `hand_number`, `button_seat`, Blinds, `small_blind_seat` (`NULL` = kein Small Blind), `big_blind_seat`, `deck` (`text[]`, 52 Karten zu Handbeginn, nur serverseitig), `board` (`text[]` mit Karten-Strings der Engine), `players` (JSONB: Sitz, User, Stack, Hole Cards zu Handbeginn), `result` (JSONB: Pots, Gewinner, Sichtbarkeit der Karten), `started_at`, `finished_at` | Unique (`round_id`, `hand_number`); `deck` hat 52 Karten (0003) |
| `hand_actions` | Aktion in einer Hand: `seq` (Reihenfolge ab 1), `user_id`, `street` (`preflop`…`river`), `action` (`small_blind`, `big_blind`, `fold`, `check`, `call`, `bet`, `raise`), `amount`, `is_all_in`, `is_automatic` (0003), `created_at` | PK (`hand_id`, `seq`) |
| `admin_audit_log` | Admin-Protokoll (0007): `admin_id`, `action`, `target_user_id`, `target_table_id`, `details` (JSONB-Objekt), `source`, `created_at` – siehe „Auth“ → „Admin (WP-028)“ | Verweise `ON DELETE SET NULL`, Trigger lösen sie bei Konto-Löschung; Indizes auf `created_at`, `admin_id`, `target_user_id` |
| `schema_migrations` | vom Migrations-Runner verwaltet: `version`, `checksum`, `applied_at` | PK `version` |

Beziehungen:
```
users 1─n sessions
users 1─n tables (created_by) 1─n rounds 1─n round_players n─1 users
                                     rounds 1─n hands 1─n hand_actions n─1 users
```

- **Löschverhalten:** Alle Verweise auf `users` (außer `sessions`, `feedback` und `admin_audit_log`, siehe „Feedback“ bzw. „Admin (WP-028)“) sind `ON DELETE RESTRICT`. Accounts werden nie hart gelöscht, sondern anonymisiert (`username`/`password_hash` → `NULL`, `deleted_at` setzen; `anonymizeAccount`, siehe „Auth“ → „Konto löschen“) – so bleibt die Hand-Historie der anderen Spieler vollständig, und der Name wird wieder frei. `sessions` kaskadieren mit dem User. Innerhalb eines Aggregats wird kaskadiert: Runde → `round_players`, `hands`; Hand → `hand_actions`. Tische werden nicht gelöscht, sondern auf `closed` gesetzt (`rounds.table_id` ist `RESTRICT`).
- **Indizes für spätere Abfragen:** Rangliste `SUM(points) GROUP BY user_id` über `round_players (user_id, points)` (Index-Only-Scan); Runden und Hand-Historie eines Users über `round_players (user_id, round_id)` → `hands (round_id, hand_number)`; Statistiken pro User (VPIP, PFR) über `hand_actions (user_id, hand_id)`.
- **Zahlentypen:** IDs, Chips und Punkte sind `integer`. Grund: `pg` liefert `integer` als JS-`number`, `bigint` dagegen als String (eigene Parser nötig). Die Größenordnung passt: `starting_stack` ist per Constraint auf 10⁸ begrenzt, damit die Summe aller Stacks (max. 9 Spieler) unter 2³¹ bleibt; Punkte pro Runde sind ≤ 9; 2³¹ Zeilen pro Tabelle erreicht eine Freundesrunde nicht. Achtung: `sum()`/`count()` liefern in Postgres `bigint` → in Queries `::int` casten.
- **Typen:** `src/db/types.ts` enthält handgeschriebene Zeilentypen (`UserRow`, `TableRow`, `HandRow` …, Spalten 1:1 in snake_case) für `pool.query<T>()` – kein ORM. Ändert eine Migration eine Tabelle, wird der Typ im selben Commit angepasst.

### Migrationen
- **Werkzeug:** eigener kleiner Runner (`src/db/migrate.ts`, `runMigrations(connection)`) statt `node-pg-migrate`: ein kleines Modul ohne neue Abhängigkeit, reine SQL-Dateien, und Lock-, Transaktions- und Prüfverhalten sind vollständig sichtbar und getestet. Ein Down-Pfad fehlt bewusst – Korrekturen sind neue Vorwärts-Migrationen.
- **Dateien:** `apps/server/migrations/NNNN_name.sql` (vierstellige Nummer, Kleinbuchstaben), angewendet in Nummernreihenfolge. SQL ohne Schema-Präfix (Tests nutzen eigene Schemas über `search_path`). Eine angewendete Migration wird nie geändert – der Runner vergleicht die SHA-256-Checksumme und bricht ab, wenn eine Datei geändert wurde oder fehlt.
- **Ablauf beim Serverstart** (`main.ts`, vor `listen`): eigene Verbindung → `pg_advisory_lock` (fester Schlüssel, serialisiert parallel startende Instanzen) → `schema_migrations` anlegen, falls nötig → Checksummen der angewendeten Migrationen prüfen → jede fehlende Migration in **einer eigenen Transaktion** zusammen mit ihrem `schema_migrations`-Eintrag ausführen → Lock freigeben. Schlägt eine Migration fehl, wird sie vollständig zurückgerollt und der Server startet nicht. Ein zweiter Lauf ist ein No-Op. Befehle, die keine Transaktion vertragen (z. B. `CREATE INDEX CONCURRENTLY`), werden nicht unterstützt.
- **Tests:** `src/db/migrate.test.ts` (frische DB, zweiter Lauf No-Op, parallele Läufe, Rollback, geänderte/fehlende Dateien) und `src/db/schema.test.ts` (Constraints, Fremdschlüssel, Löschverhalten, Beispiel-Queries). Sie laufen nur mit gesetztem `TEST_DATABASE_URL` (sonst `skipIf`, damit `npm run check` ohne Docker grün bleibt). `npm run test:db -w @poker/server` nutzt standardmäßig die Datenbank `poker_test` im dev-Postgres (`localhost:4312`), legt sie bei Bedarf an (`src/db/test-db.ts`), gibt jedem Testlauf ein eigenes Schema `test_<zeit>_<zufall>` und löscht es danach.

### Persistenz (Hand-Historie und Rundenergebnis, WP-013)
Code in `apps/server/src/history/`, Engine-Hilfen `initialDeck`/`replayHand` in `packages/engine/src/replay.ts`.

- **Verdrahtung:** `buildApp` hängt `createHandHistoryHooks(createPgHandHistoryStore(db), retry)` vor die übergebenen `game.hooks` (`combineHooks`: alle Sätze nacheinander, ein Fehler hält die anderen nicht auf). Mit eigenem `game.repository` (Tests ohne DB) ist die Historie aus, `game.history: null` schaltet sie explizit ab.
- **Wann wird geschrieben:** `onHandStarted` → `saveHandStarted`: Zeile in `hands` mit Button, Blinds, Blind-Sitzen, `players` (Sitz, `userId`, Stack vor den Blinds, **alle** Hole Cards) und `deck` (`INSERT … ON CONFLICT DO NOTHING`). `onHandComplete` → `saveHandCompleted`: dieselbe Zeile per Upsert um `board`, `result`, `finished_at` ergänzt (legt sie an, falls der Start nicht gespeichert wurde) und alle Aktionen in `hand_actions` (`ON CONFLICT DO NOTHING`) – eine SQL-Anweisung. Beides ist idempotent und damit wiederholbar. Rundenende: `finishRound` des Repositorys (WP-011) schreibt `rounds.status = finished`, `round_players.placement`/`points` und schließt den Tisch; es läuft in derselben Warteschlange nach dem letzten `onHandComplete`.
- **Aktionen:** eine Zeile je Eintrag im Engine-Protokoll (`hand.log`), Blinds zuerst. `smallBlind`/`bigBlind` → `small_blind`/`big_blind`; `amount` = in diesem Schritt eingezahlte Chips (bei Bet/Raise der Zuwachs, „to“ ergibt sich beim Replay); All-in steht nur in `is_all_in` (eine All-in-Aktion wird je nach Wirkung als `bet`, `raise` oder `call` gespeichert, wie in der Engine). Antes gibt es nicht (D-016) – sie würden einen Fehler werfen. `is_automatic` markiert Aktionen, die der Server bei Zeitablauf oder Trennung ausgeführt hat (D-013, `Table.autoCheckOrFold`).
- **`hands.result` (JSONB, `StoredHandResult` in `history/records.ts`):** `showdown`, `allHandsShown`, `payouts` (`userId`, `amount`), `uncalled`, `pots` (Main Pot zuerst: `amount`, `eligibleUserIds`, `winnerUserIds`, `shares`, `winningHand` mit `category`/`description`/`cards`; leer ohne Showdown) und `players` (`userId`, `seat`, `endStack`, `folded`, `cards`, `hand`). `cards` ist die Sichtbarkeit der Hole Cards für spätere Anzeigen: `shown` (im Showdown gezeigt), `mucked` (im Showdown verdeckt), `hidden` (gefoldet oder ohne Showdown gewonnen). Die Hole Cards selbst stehen immer in `players` – eine Anzeige für andere Spieler darf nur `shown` zeigen (D-003), `deck` nie.
- **Punkte auf dem Account:** keine eigene Spalte, sondern `SUM(round_players.points)` (`loadUserPoints(db, userIds)`, Index `round_players_user_points_idx`). Abgebrochene Runden haben `points = NULL` und zählen nicht. Die Punkte selbst berechnet nur die Engine (`placementPoints`, D-012; geteilte Plätze nach D-018: Durchschnitt der belegten Plätze, abgerundet).
- **Speicherfehler:** halten das Spiel nie an – alle Schreibvorgänge laufen in der Hook-Warteschlange des Tisches. `withRetry` wiederholt vorübergehende Fehler (Verbindung, Timeout, Neustart der DB) nach 1 s, 5 s und 15 s (`DEFAULT_RETRY_DELAYS_MS`, `game.retryDelaysMs`); deterministische SQL-Fehler (SQLSTATE-Klassen 22, 23, 42) sofort nicht. Danach wird der Fehler geloggt („Fehler in Tisch-Hook“ mit Task, Runde, Hand), die Hand fehlt dann in der Historie. Ein Retry verzögert nur die folgenden Schreibvorgänge dieses Tisches. Dasselbe gilt für `finishRound` (`withFinishRoundRetry`); `startRound` bleibt ohne Retry (der Ersteller bekommt sofort einen Fehler). Beim Herunterfahren wartet die App bis zu 10 s auf ausstehende Schreibvorgänge.
- **Replay:** `loadRoundHands(db, roundId)`/`loadHand(db, id)` laden Hände mit Aktionen; `replayHandRecord(hand)` spielt sie über `replayHand` der Engine mit dem gespeicherten Deck nach (Aktionen → Engine-Aktionen: `bet`/`raise` mit `amount` = Straßeneinsatz danach, mit `is_all_in` → `allIn`), vergleicht jeden erzeugten Protokolleintrag mit dem gespeicherten und liefert Endzustand und neu abgeleiteten Datensatz. `initialDeck(hand)` rekonstruiert das Deck aus jedem Handzustand (Hole Cards in Austeilreihenfolge, je Straße Burn + Board, Rest).
- **Server-Neustart (D-019):** Tische und laufende Runden leben nur im Speicher. Beim Start setzt `closeOrphanedTables` laufende Runden auf `aborted` (Platz/Punkte bleiben `NULL`, keine Punkte) und offene/laufende Tische auf `closed`. Bereits gespeicherte Hände der abgebrochenen Runde bleiben: beendete vollständig (nachspielbar), eine zum Zeitpunkt des Absturzes laufende Hand nur mit Ausgangslage (`result`/`finished_at` `NULL`, keine Aktionen, kein Board). Statistiken zählen sie nicht (D-022, siehe „Statistiken“).
- **Verwaiste Runde (D-022, WP-015):** gleiche Wirkung zur Laufzeit über `abortRound` (Runde `aborted`, Tisch `closed`, idempotent, mit Retry); die Hand, die beim Abbruch lief, bleibt wie beim Neustart ohne Ergebnis.
- **„Nochmal“ (D-020, WP-015):** mehrere Runden pro Tisch; `tables.status` ist zwischen zwei Runden `closed` und wird von `startRound` wieder `running` (`closed_at` = NULL).
- **Tests:** `history/records.test.ts` (Abbildung, Sichtbarkeit, Replay ganzer Zufallsrunden ohne DB), `history/retry.test.ts` (Retry-Regeln, `combineHooks`), `history/history.db.test.ts` (mit `TEST_DATABASE_URL`: Runde über den Game-Server → jede Hand gleich dem Serverzustand und per Replay identisch; Platzierungen/Punkte unabhängig nachgerechnet, Summe je Account über drei Runden; vorübergehende und dauerhafte Speicherfehler; automatische Aktionen; Neustart mitten in der Runde mit gespeicherten Händen), `packages/engine/src/replay.test.ts` (Deck-Rekonstruktion, 300 Zufallshände mit All-ins/Side Pots, Manipulation wird erkannt).

### Statistiken (Rangliste, Profil, Hand-Historie, WP-019)
Code in `apps/server/src/stats/`: `stats.ts` (reine Berechnung), `view.ts` (Hand-Historie für Clients, rein), `queries.ts` (SQL), `routes.ts` (Fastify-Plugin, registriert in `buildApp`). Web: Abschnitt „Frontend“.

**Was zählt:** nur Runden mit Status `finished` und darin nur beendete Hände (`hands.result` gesetzt). Hände abgebrochener Runden bleiben in der Historie und sind nachlesbar, zählen aber nirgends (D-019, D-022); laufende Runden sind über die API gar nicht sichtbar.

**Rangliste und Rundenwerte** (aus `round_players` ⋈ `rounds`):

| Wert | Definition |
|---|---|
| Punkte | `SUM(points)` über beendete Runden (D-012; geteilte Plätze nach D-018 abgerundet, berechnet die Engine) |
| Runden | Anzahl beendeter Runden mit Teilnahme |
| Siege | Anzahl Runden mit `placement = 1` |
| Platz | `rank()` nach Punkten: gleiche Punkte = gleicher Platz (1, 1, 3). Sortierung innerhalb eines Platzes: Siege, Runden, Name |

Die Rangliste enthält nur aktive Accounts mit mindestens einer beendeten Runde (D-024), gelöschte nicht; `rank()` läuft nur über diese. Im Profil ist der Platz ohne beendete Runde `null` (UI: „–“). In Rundenergebnissen und Händen erscheinen gelöschte Spieler mit Name `null` („Gelöschter Spieler“ in der UI) – egal ob die User-Zeile anonymisiert ist (`deleted_at`) oder fehlt.

**Spielstil je Hand** (`classifyHand`, Eingabe: eigene Aktionen der Hand in Reihenfolge, Board-Größe, Showdown ja/nein, Pot gewonnen ja/nein):

| Kennzahl | Zähler | Nenner |
|---|---|---|
| Hände | – | alle gewerteten Hände, in denen der Spieler Karten bekam |
| VPIP | Hände mit eigenem Preflop-`call`, `bet` oder `raise` | Hände mit eigener Preflop-Entscheidung |
| PFR | Hände mit eigenem Preflop-`bet` oder `raise` | wie VPIP |
| Showdown-Quote (WTSD) | Flop gesehen und ohne Fold im Showdown | Flop gesehen |
| Showdown gewonnen (W$SD) | im Showdown mindestens einen Pot (auch geteilt) gewonnen | Showdowns |

- **Blinds** sind nie freiwillig. Ein Big Blind, der seine Option checkt, hat entschieden (Nenner), aber nichts freiwillig gezahlt. Ein Small Blind, der completet (Call), zählt als VPIP.
- **Eigene Preflop-Entscheidung:** mindestens eine Nicht-Blind-Aktion preflop, und der Spieler war nicht abwesend. Walk für den Big Blind und All-in schon durch den Blind haben keine Entscheidung (nicht im VPIP-/PFR-Nenner).
- **Flop gesehen:** preflop nicht gefoldet und die Hand hat mindestens drei Board-Karten – auch per All-in-Run-out.
- **Automatische Aktionen (`is_automatic`):** Ist die **erste** eigene Nicht-Blind-Aktion einer Hand automatisch, war der Spieler nicht da (getrennt oder Zeit abgelaufen, bevor er überhaupt gehandelt hat). Solche Hände zählen bei „Hände“, aber in **keinem** Nenner der Quoten (VPIP, PFR, WTSD, W$SD). Grund: Ein getrennter Spieler wird automatisch gefoldet bzw. gecheckt (D-012, D-022) – mitgezählt würde Abwesenheit seinen Spielstil verzerren (VPIP fällt, ein abwesender Big Blind „sieht“ Flops). Hat der Spieler in der Hand zuerst selbst gehandelt und läuft später die Zeit ab, zählt die Hand normal, der automatische Fold wie ein eigener. Automatische Aktionen sind immer Check oder Fold, also nie VPIP oder PFR.
- **Gewonnen** heißt: Anteil an einem Pot (`result.pots[].winnerUserIds`); zurückgegebene, nicht gecallte Einsätze zählen nicht. W$SD zählt nur Hände mit Showdown, ein Gewinn ohne Showdown ist kein W$SD.
- Quoten liefert die API als `{ count, of }`; die UI zeigt ganze Prozent, bei `of = 0` „–“.
- **Tests:** `stats.test.ts` (Tabellentests je Fall und eine bekannte Zehn-Hände-Historie), `stats.db.test.ts` vergleicht die SQL-Ableitung (`loadPlayerHands`) mit `playerHandFromRecord` über die gespeicherten Hände echter Zufallsrunden und prüft, dass abgebrochene Runden und unbeendete Hände nicht zählen.

**Abfragen (`queries.ts`):** Rangliste in einer Anweisung (`users` ⋈ `round_players` ⋈ `rounds`, `rank()`); Spielstil über `hand_actions (user_id, hand_id)` → je Hand ein JSON-Array der eigenen Aktionen, Board-Größe, `result.showdown` und Pot-Gewinn per `jsonb_path_exists` – gerechnet wird in `aggregateHandStats`. Das reicht, weil jeder Spieler mit Karten in jeder Hand mindestens eine Aktion hat (Blind oder Entscheidung: wer nicht im Blind sitzt, muss preflop handeln). Letzte Runden über `round_players (user_id, round_id)`, Hände über `hands (round_id, hand_number)`. Die vorhandenen Indizes aus 0001 genügen, es gibt keine neue Migration. Profil: Rangliste + Spielstil, beides pro Aufruf frisch gerechnet (keine Zwischenspeicher, die veralten könnten).

**Endpunkte** (alle `GET`, nur mit gültiger Session, sonst `401 { error: "unauthorized" }`; Fehler `{ error, message }` wie bei „Auth“):

| Pfad | Antwort |
|---|---|
| `/api/leaderboard` | `{ players: [{ rank, userId, name, points, rounds, wins }] }` |
| `/api/players/:name/stats` | `{ player: { id, name }, rank (null ohne beendete Runde), points, rounds, wins, hands: { hands, vpip, pfr, wtsd, wsd } }`; Name case-insensitiv, unbekannt/gelöscht `404` |
| `/api/rounds/recent?player=&limit=` | `{ rounds: RoundSummary[] }` – beendete und abgebrochene Runden von `player` (Standard: man selbst), neueste zuerst, Runden privater Tische nur, wenn der Betrachter mitgespielt hat (D-024), `limit` 1–50 (Standard 10, sonst `400`). `RoundSummary`: `id`, `tableName`, `status`, `startedAt`, `finishedAt`, `handCount`, `viewerParticipated`, `isPublic`, `players` (`name`, `seat`, `placement`, `points`, `isViewer`; nach Platz, geteilte Plätze möglich) |
| `/api/rounds/:id` | `{ round: RoundSummary, hands: [{ id, handNumber, board, winners, viewer: { holeCards, net } \| null }] \| null }`; laufend/unbekannt `404`. Ohne Teilnahme: öffentlicher Tisch → Ergebnis mit `hands: null`, privater Tisch → `403` (D-024) |
| `/api/hands/:id` | `{ hand: HandView }` (`view.ts`): Blinds, Button/Blind-Sitze, Board, `players` (`seat`, `name`, `isViewer`, Stacks vor/nach, `folded`, `cards` = Sichtbarkeit, `holeCards`, `handDescription`), `actions` (`seq`, `street`, `seat`, `name`, `action`, `amount`, `streetTotal` = Einsatz auf der Straße danach, `isAllIn`, `isAutomatic`), `pots` (Gewinner, Hand), `winners` (ohne zurückgegebene Einsätze); unbeendete Hand oder laufende Runde `404`, ohne Teilnahme an der Runde `403` |

**Datenschutz der Historie (D-003):** Das Deck wird für die API gar nicht geladen (`HISTORY_HAND_SELECT` ohne `deck`), die Antwort wird Feld für Feld aufgebaut. Hole Cards: eigene immer, fremde nur bei `cards === 'shown'` (gemuckte und gefoldete bleiben `null`). Hand-Details und Handliste einer Runde nur für deren Teilnehmer. Rundenergebnisse (Plätze, Punkte; `/api/rounds/:id` und „letzte Runden“) öffentlicher Tische sieht jeder Eingeloggte, privater Tische nur deren Teilnehmer (D-024, WP-026): `/api/rounds/:id` antwortet `403`, `/api/rounds/recent` lässt die Runde weg. Die Summen in Rangliste und Profil (Punkte, Runden, Siege, Spielstil) enthalten private Runden weiterhin – sie verraten kein einzelnes Rundenergebnis. Tests: `view.test.ts` (feste Hände und Zufallsrunden: für jeden Betrachter tauchen nur Board-, eigene und gezeigte Karten auf), `stats.db.test.ts` (über HTTP, inkl. `403`/`404`, private vs. öffentliche Tische).

**Aktualität:** keine Push-Nachricht. Die Rangliste ist nach Rundenende aktuell, weil `finishRound` Platz und Punkte direkt beim Rundenende schreibt und die Seiten bei jedem Aufruf sowie bei `focus`/`visibilitychange` neu laden (`useResource` mit `refetchOnFocus`); wer vom Tisch zur Rangliste wechselt, öffnet sie neu. `/api/` wird weder von nginx (`no-store`) noch vom Service Worker gecacht.

## Prod-Umgebung
`compose.prod.yml`, Compose-Projekt `poker-prod` (D-002, D-005, D-014), gebaut und betrieben aus dem eigenen Git-Worktree auf `main` (`~/code/Arthurreuss/poker-prod`, D-017); Werte aus dessen `.env.prod` (gitignored, Vorlage `.env.prod.example`). Bedienung, Release, Tunnel, Backup/Restore und Betrieb: [OPERATIONS.md](OPERATIONS.md).

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
| `backup` | `prodrigestivill/postgres-backup-local:16` | go-cron + `pg_dump`, Health-Port 8080 | – (Bind-Mount `BACKUP_DIR` → `/backups`) | Scheduler-Endpunkt (`curl :8080`) | `db` healthy |
| `logrotate` | `alpine:3.24.2` | `sh /rotate.sh loop` (`docker/logrotate/rotate.sh`, Bind-Mount), kein Netz | – (Volumes `server-logs`, `web-logs`) | letzte Rotation < 26 h | – |

- Alle Dienste `restart: unless-stopped` (geprüft von `scripts/test/compose-prod.test.mjs`), damit poker-prod nach einem Neustart von Docker Desktop ohne Eingreifen wieder läuft. DB-Daten im Named Volume `poker-prod-db`.
- **Logs (WP-022, D-025 – höchstens 14 Tage für Logs mit IP-Adressen):** Docker rotiert Container-Logs nur nach Größe. Deshalb schreiben `server` (`LOG_FILE=/var/log/poker/server.log`, pino-Datei-Ziel) und `web` (`NGINX_ACCESS_LOG=/var/log/poker/access.log`, eigenes Format `poker` mit `$client_ip`, ohne Healthchecks von `127.0.0.1`) ihre Request-Logs in die Volumes `server-logs`/`web-logs` (Name mit Projekt-Präfix, der Restore-Test bekommt eigene). `logrotate` rotiert sie einmal pro Kalendertag (copytruncate, die Dienste öffnen mit `O_APPEND`) und löscht rotierte Dateien nach 12 Tagen; die älteste Zeile ist damit höchstens ~13 Tage alt. Alle Dienste nutzen den Log-Treiber `local` mit 3 × 10 MB (Anker `x-logging`); dort landen nur noch Meldungen ohne Client-IP (Start, nginx-Fehlerlog mit der internen cloudflared-Adresse, Postgres, Backup, cloudflared auf Level `info`). Ohne die Variablen (dev, lokale Tests) loggen server und nginx nach stdout. Bedienung: [OPERATIONS.md](OPERATIONS.md#logs).
  Gewählt statt „IP-Adressen nicht loggen + nur Größen-Rotation“: Größen-Rotation garantiert bei wenig Verkehr keine Höchstdauer, die IP wird für die Missbrauchsabwehr gebraucht, und die Datenschutzerklärung nennt eine feste Frist.
- **Backup:** `backup` dumpt täglich (`BACKUP_SCHEDULE`, Standard `@daily`, Zeitzone `BACKUP_TZ`) per `pg_dump -Z6` (Plain-SQL, gzip) über das Netz `backend` in einen Host-Ordner außerhalb von Docker (`BACKUP_DIR`, Standard `~/poker-backups`, aufgelöst in `scripts/lib/prod-env.sh`); Aufbewahrung 7 täglich / 4 wöchentlich / 6 monatlich (`last/`, `daily/`, `weekly/`, `monthly/`). Restore per `scripts/restore.sh`: Server stoppen → DB neu anlegen → Dump in einer Transaktion einspielen → Server starten. Netz `backend` ist `internal` (kein Zugang nach außen), die DB hat keinen Host-Port.
- **Server-Image:** Build-Stage mit allen Abhängigkeiten → `esbuild`-Bundle; eigene Stage installiert nur die Laufzeit-Abhängigkeiten des Servers (`npm ci --omit=dev -w @poker/server`, ohne Source-Maps); Runtime `node:22-alpine` mit `node_modules` + `server.mjs`, User `node`, `NODE_ENV=production`.
- **Web-Image:** Build-Stage `vite build` → Runtime `nginxinc/nginx-unprivileged` (User `nginx`, Port 8080). Konfiguration `docker/nginx/default.conf.template`, Ziel des Proxys per `API_UPSTREAM=server:4321` (envsubst beim Start, Auflösung über Docker-DNS zur Laufzeit). `/api/` und `/ws` gehen an den Server (`/ws` mit Upgrade-Headern, Read-/Send-Timeout 1 h); gzip; `/assets/*` (gehasht) `Cache-Control: public, max-age=31536000, immutable`, `index.html` und SPA-Fallback `no-cache`, `/api/` `no-store`. Security-Header (WP-022) aus `docker/nginx/security-headers.conf`, per `include` in **jedem** `location`-Block (nginx vererbt `add_header` nicht in Blöcke mit eigenem `add_header`): CSP nur `'self'` (keine Inline-Skripte, kein `eval`, `connect-src 'self' wss://$host`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` (Kamera, Mikrofon, Standort, Zahlung, Sensoren … aus), `Cross-Origin-Opener-Policy: same-origin`. HSTS setzt Cloudflare. In `location /` ersetzt `sub_filter` den Platzhalter der Open-Graph-Tags durch die aufgerufene Origin (siehe „Frontend“ → „Link-Vorschau“). Geprüft von `scripts/test/nginx-headers.test.mjs`; Wortlaut und manueller Test: [OPERATIONS.md](OPERATIONS.md#security-checkliste).
- **Proxy-Header:** nginx setzt `X-Forwarded-For` auf `CF-Connecting-IP` (hinter dem Tunnel) bzw. die Peer-Adresse und reicht `X-Forwarded-Proto` von cloudflared durch; der Server vertraut ihnen nur in prod (`trustProxy`).
- **cloudflared:** eigener Tunnel für Poker, unabhängig vom Jarvis-Tunnel (D-014); `TUNNEL_TOKEN` aus `.env.prod`. Public Hostname `poker.arthur-reuss.de` → `http://web:8080`.

### Feedback (WP-024)
Spieler schicken aus der App Feedback (Bug, Idee, Sonstiges); Admins lesen es unter `/admin/feedback` oder per CLI (`admin:feedback`, Aufruf: README „Admin“, Betrieb: OPERATIONS.md „Feedback lesen“). Code: `apps/server/src/feedback/`, Migration `0004_feedback.sql`, Web: `apps/web/src/feedback/`, `pages/AdminFeedbackPage.tsx`.

**Tabelle `feedback`:** `user_id` (`NULL` = Account gelöscht), `category` (`bug`/`idea`/`other`), `message` (1–2000 Zeichen, getrimmt), Kontext `page` (Pfad, ≤ 200), `table_id` (laut Client, ohne Fremdschlüssel), `app_version` (≤ 100, Build-Version/Commit), `user_agent` (≤ 500, vom Server aus dem Request-Header), `orientation` (`auto`/`portrait`/`landscape`, Einstellung aus `useOrientationPreference`), `status` (`new`/`read`/`done`, Standard `new`), `created_at`, `done_at` (Migration `0006_feedback_retention`: Zeitpunkt des Erledigens, Check-Constraint `feedback_done_at`: gesetzt genau bei `status = 'done'`; `updateFeedbackStatus` setzt es beim Wechsel auf `done`, behält es bei erneutem `done` und leert es sonst). Indizes für die Admin-Liste (`status, created_at DESC`, `created_at DESC`) und `user_id`. Codes sind englisch wie die übrigen Status-Spalten; die UI zeigt Bug/Idee/Sonstiges und Neu/Gelesen/Erledigt.

**Speicherdauer (WP-022, D-025):** `feedback/retention.ts` – `purgeExpiredFeedback(db, now)` löscht erledigtes Feedback 30 Tage nach `done_at` und jedes Feedback 365 Tage nach `created_at` (`FEEDBACK_RETENTION`, steht so in der Datenschutzerklärung). `startFeedbackPurgeJob({ db, log, now?, intervalMs? })` läuft beim Serverstart sofort und dann täglich (Timer `unref`, Fehler werden geloggt, nicht geworfen); gestartet in `main.ts`, nicht in `buildApp` (Tests mit Fake-DB bleiben unberührt). Die Admin-Ansicht weist auf die Fristen hin. Test: `feedback/retention.db.test.ts` (Grenzen, `done_at`-Pflege, Constraint, Job mit injizierter Uhr).

**Account-Löschung:** Feedback bleibt erhalten, wird aber anonymisiert. `user_id` ist `ON DELETE SET NULL` (eine harte Löschung des Users wird nie blockiert). Zusätzlich leeren zwei Trigger auf `users` (`BEFORE DELETE` und `AFTER UPDATE OF deleted_at`, sobald `deleted_at` gesetzt wird) `user_id` **und** `user_agent` aller Feedbacks des Users – der User-Agent ist zusammen mit Zeitpunkt und Freitext ein Wiedererkennungsmerkmal. Seite, Tisch, App-Version und Ausrichtung bleiben. Der Freitext selbst bleibt unverändert (kann Personenbezug enthalten, den der Spieler selbst hineingeschrieben hat).

**API** (gekapseltes Fastify-Plugin `feedbackRoutes`, Session aus dem Cookie wie beim WebSocket; Fehler im Format `{ error, message }`):

| Methode und Pfad | Zugriff | Body / Query | Erfolg | Fehler |
|---|---|---|---|---|
| `POST /api/feedback` | eingeloggt | `{ category, message, page?, tableId?, appVersion?, orientation? }` (max. 16 KiB) | `201 { feedback: { id, createdAt } }` | `401 unauthorized`, `400 invalid_request` (Kategorie, Text leer/zu lang, Kontext ungültig), `429 rate_limited` |
| `GET /api/admin/feedback` | `isAdmin` | `?status=new\|read\|done\|all` (Standard alle), `?limit=` (Standard 100, max. 500) | `200 { feedback: FeedbackItem[], counts: { new, read, done } }`, neueste zuerst | `401`, `403 forbidden`, `400` |
| `PATCH /api/admin/feedback/:id` | `isAdmin` | `{ status }` | `200 { feedback: FeedbackItem }` | `401`, `403`, `400`, `404 not_found` |

`FeedbackItem` = `{ id, userId, username, category, message, page, tableId, appVersion, userAgent, orientation, status, createdAt }` (`username`/`userId` `null` bei gelöschtem Account).

**Rate-Limit:** `@fastify/rate-limit` nur für `POST /api/feedback`, pro **User** (nicht IP), erst nach der Session-Prüfung (`preHandler`) – ohne Session zählt nichts. Standard 5 pro Stunde; `FEEDBACK_RATE_LIMIT_MAX` (`0` = aus) und `FEEDBACK_RATE_LIMIT_WINDOW_SECONDS` (Standard 3600), `loadFeedbackConfig(env)`, Tests übergeben `buildApp({ feedback })`. Zähler im Speicher des Prozesses (Neustart setzt zurück).

**Web:** Knopf „Feedback“ im `FeedbackSlot` der App-Shell öffnet einen Dialog (Portal in `document.body`, Escape/Hintergrund schließen) mit Kategorie, Text (`maxLength` 2000, Zähler) und Bestätigung. Kontext automatisch: `page` = `window.location.pathname`, `tableId` aus `/table/<zahl>` (überschreibbar), `appVersion` = `__APP_VERSION__`, `orientation` aus `useOrientationPreference`. Für Stellen außerhalb der App-Shell (Tisch-Menü) liefert `useFeedbackDialog({ tableId })` `{ open, close, isOpen, dialog }`: `open` an den Menüeintrag, `dialog` außerhalb des Menüs rendern.

**Tests:** `feedback/feedback.unit.test.ts` (Validierung, User-Agent, Config, CLI) und `feedback/feedback.db.test.ts` (Test-DB: Speichern mit Kontext, 401/400/429, Admin-API 401/403/404, Filter, Statuswechsel, Anonymisierung bei hartem Löschen und bei `deleted_at`).

## Frontend
React 19 + Vite, Routing mit `react-router` (Deklarativ: `BrowserRouter`/`Routes`). Keine UI-Bibliothek.

### Struktur (`apps/web/src`)
| Pfad | Inhalt |
|---|---|
| `main.tsx`, `App.tsx` | Einstieg; `App` = `AuthProvider` + `BrowserRouter` + `AppRoutes` (Tests rendern `AppRoutes` in einem `MemoryRouter`) |
| `api/` | `client.ts` (`apiRequest`, `ApiError`), `auth.ts` (`register`, `login`, `logout`, `me`, `deleteAccount`), `feedback.ts` (`sendFeedback`, `listFeedback`, `updateFeedbackStatus`), `ws.ts` (`wsUrl`); Export über `api/index.ts`; `stats.ts` (Rangliste, Profil, Runden, Hände – direkt importiert) |
| `auth/` | `AuthContext.tsx` (`AuthProvider`, `useAuth`), `guards.tsx` (`RequireAuth`, `RequireAdmin`, `RedirectIfAuthenticated`), `validation.ts` (Regeln wie der Server) |
| `layout/AppShell.tsx` | Kopfzeile mit App-Name, Menü (Lobby, Rangliste, Einstellungen, Admin nur für Admins, Abmelden) und Feedback-Slot; `<Outlet>` für die Seite; `LegalFooter` |
| `legal/` | Impressum und Datenschutz (WP-022): `LegalPage.tsx` (Seiten), `LegalFooter.tsx` (Spielgeld-Hinweis D-001 + Links, in App-Shell, Login/Registrierung und den Rechtstexten), `Placeholder.tsx` (markiert offene Angaben); **Texte nur in `legal/content/impressum.tsx` und `datenschutz.tsx`** – die Datenschutzerklärung muss mitgeändert werden, wenn sich die Datenverarbeitung ändert |
| `feedback/` | Feedback (WP-024): `FeedbackSlot` (Knopf „Feedback“ in der App-Shell, `data-slot="feedback"`), `FeedbackForm`, `FeedbackDialog`/`FeedbackButton`/`useFeedbackDialog` (Einstieg von überall, z. B. Tisch-Menü), `context.ts` (automatischer Kontext); Export über `feedback/index.ts` |
| `pages/` | Login, Registrierung, Lobby, Rangliste, Profil (`PlayerPage`), Runde (`RoundPage`), Hand (`HandPage`), Einstellungen, Admin, Tisch |
| `game/` | Spielablauf (WP-018): WebSocket-Verbindung, Tisch-Store, Adapter Protokoll → Tischansicht, Spielseite; siehe „Frontend: Spielablauf und Verbindung“ |
| `stats/` | Bausteine für Rangliste/Profil/Historie: `useResource` (Laden mit Abbruch, optional Neuladen bei Fokus), `format.ts` (Quoten, Plätze inkl. „geteilt“, „Gelöschter Spieler“, Aktionstexte), `parts.tsx` (`MiniCard` als Text-Karte, `PlayerLink`, `ResourceView`, `Tile`), `Stats.module.css` |
| `settings/orientation.ts`, `settings/animations.ts` | `useOrientationPreference()` (D-009), `useAnimationsPreference()` (WP-018) |
| `settings/DeleteAccount.tsx` | Einstellungen → „Konto löschen“ mit Passwort-Bestätigung (WP-022) |
| `styles/` | `tokens.css` (Vertrag, siehe „Design-Tokens (Web)“), `global.css`, `cx.ts` (Klassen verbinden) |
| `lobby/` | Lobby-Client und -Bausteine (WP-015), siehe „Frontend: Lobby“ |
| `table/` | Tischansicht (WP-016 ff.) |
| `test/` | Test-Setup (jest-dom, Cleanup) und `mockApi` (ersetzt `fetch` je `"METHODE /pfad"`) |

### Routing
| Pfad | Seite | Zugriff |
|---|---|---|
| `/login`, `/register` | Anmelden, Registrieren | nur ausgeloggt (eingeloggt → Zielseite bzw. `/`) |
| `/impressum`, `/datenschutz` | Rechtstexte (WP-022) | immer, ohne Login, eigener schlichter Rahmen |
| `/` | Lobby (WP-015) | eingeloggt, in der App-Shell |
| `/join/:code` | Einladung zu einem privaten Tisch (WP-015): tritt per Code bei, weiter zu `/table/:id` | eingeloggt (sonst Login mit Rücksprung), App-Shell |
| `/leaderboard` | Rangliste: Platz, Punkte, Runden, Siege (nur Spieler mit beendeter Runde, D-024); eigener Eintrag hervorgehoben, Link „Meine Statistiken“ | eingeloggt, App-Shell |
| `/players/:name` | Profil: Platz, Punkte, Runden, Siege, Spielstil, letzte Runden | eingeloggt, App-Shell |
| `/rounds/:id` | Runde: Ergebnis (geteilte Plätze), Handliste | eingeloggt, App-Shell; Ergebnis bei öffentlichen Tischen für alle, sonst nur Teilnehmer; Handliste nur Teilnehmer (D-024) |
| `/hands/:id` | Hand: Spieler mit Karten, Aktionen je Straße, Pots | eingeloggt, App-Shell; Daten nur für Teilnehmer |
| `/settings` | Einstellungen (Ausrichtung, Animationen, Konto löschen) | eingeloggt, App-Shell |
| `/admin/*` | Admin (`pages/AdminPage.tsx` mit Unterrouten): Übersicht, `/admin/feedback` (`AdminFeedbackPage`, WP-024) | nur `isAdmin`, sonst Umleitung auf `/` |
| `/table/:id` | Tisch (`pages/TablePage.tsx` → `game/GameTable.tsx`, WP-018); keine gültige Nummer → „Tisch nicht gefunden“ | eingeloggt, **ohne** App-Shell (volle Fläche, eigenes Tisch-Menü) |
| `/dev/table`, `/dev/new-table` | Testseite der Tischansicht; Tisch per WebSocket anlegen (WP-018) – nur im Dev-Build (`import.meta.env.DEV`) | eingeloggt |
| sonst | „Seite nicht gefunden“ | eingeloggt, App-Shell |

Auth-Zustand: `AuthProvider` fragt beim Start einmal `GET /api/me` (`loading` → `authenticated` bzw. `anonymous`; auch ein nicht erreichbarer Server gilt als ausgeloggt). `RequireAuth` leitet Ausgeloggte auf `/login` und merkt sich die Zielseite in `location.state.from` (nur interne Pfade); nach Login/Registrierung leitet `RedirectIfAuthenticated` dorthin. Nach bewusstem Abmelden gibt es kein Rücksprungziel. Nach dem Löschen des Kontos (`deleteAccount`) ist man abgemeldet, die Login-Seite zeigt „Dein Konto wurde gelöscht.“ Das Admin-Flag kommt aus `/api/me` (`isAdmin`); die echte Prüfung macht der Server.

### API-Client (`src/api/`)
- `apiRequest<T>(path, { method, body, signal })`: nur relative Pfade (`/api/...`, absolute URLs werfen – D-014), `credentials: 'same-origin'` (Session-Cookie), Body als JSON.
- Antworten ≥ 400 werden zu `ApiError { status, code, message }`; `code`/`message` stammen aus dem Server-Format `{ error, message }` (siehe „Auth“). Clientseitige Codes: `network` (Server nicht erreichbar, `status` 0) und `unknown` (Antwort ohne Fehler-Body). Die UI zeigt `message` direkt an (deutsche Texte vom Server).
- `wsUrl('/ws')` baut die WebSocket-URL aus `location` (`https:` → `wss:`, sonst `ws:`; gleicher Host inkl. Port). Verbindungen: Lobby-Client (`lobby/`, WP-015), Spiel-Client (`game/connection.ts`, WP-018).
- Formular-Validierung (`auth/validation.ts`) spiegelt die Server-Regeln (Name 3–20 aus `[A-Za-z0-9_-]`, Passwort 8–128, Registrierung mit Wiederholung; Login prüft nur Pflichtfelder) – nur für schnelle Rückmeldung, der Server prüft selbst.

### Styling
CSS-Modules (`*.module.css` neben der Komponente, von Vite ohne Zusatzpaket unterstützt) für Komponenten, dazu `styles/global.css` (Reset, Body, `100dvh`, `overscroll-behavior: none` gegen Pull-to-Refresh/Gummiband, Klasse `.safe-area` mit `env(safe-area-inset-*)` für Notch/Home-Indikator, `viewport-fit=cover` in `index.html`) und `styles/tokens.css`. Farben, Abstände, Rundungen und Schrift nur über die Tokens. Klassen aus CSS-Modules sind `string | undefined` typisiert → zusammensetzen mit `cx(...)`.

### Einstellungen
`useOrientationPreference()` liefert `[preference, setPreference]` mit `'auto' | 'portrait' | 'landscape'` (D-009). Gespeichert in `localStorage` unter `poker.orientation` (Zugriffe in try/catch, sonst nur im Speicher); alle Hook-Nutzer und andere Tabs (`storage`-Event) sehen Änderungen sofort (`useSyncExternalStore`). Wie das Layout daraus folgt, entscheidet die Tischansicht (WP-017).
`useAnimationsPreference()` (WP-018) genauso unter `poker.animations` (`on`/`off`, Standard an); Schalter „Animationen (Karten, Chips)“ auf der Einstellungsseite.

### PWA
- `vite-plugin-pwa` (`generateSW`, `registerType: 'autoUpdate'`, Registrierung per `registerSW.js` mit `defer`, kein Inline-Script). Der Service Worker precacht nur die Build-Dateien (`js, css, html, svg, png, webmanifest`, ohne `og-image.png`); `navigateFallback: /index.html` für SPA-Navigation mit Denylist für `/api` und `/ws`, **kein** Runtime-Caching. API und WebSocket gehen immer ans Netz. Im Dev-Server ist der Service Worker aus.
- Manifest (`manifest.webmanifest`, generiert): Name/Kurzname „Poker“, `display: standalone`, `orientation: any`, `start_url`/`scope` `/`, Theme- und Hintergrundfarbe = `--color-bg`, Icons 192/512, maskable 512, SVG.
- iOS: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent` (Inhalt unter der Statusleiste, deshalb Safe-Area-Insets), `apple-touch-icon` 180 px; dazu `mobile-web-app-capable` und `theme-color`.
- Icons in `public/icons/` sind eigene Grafiken, erzeugt von `scripts/generate-icons.mjs` (`npm run icons -w @poker/web`, rendert ein im Skript definiertes SVG mit `@resvg/resvg-js`; Farben aus `tokens.css`). Die PNGs sind eingecheckt, der Build braucht das Skript nicht. Herkunft/Lizenzen: [apps/web/ASSETS.md](../apps/web/ASSETS.md).
- nginx (prod) liefert `sw.js`, `registerSW.js`, Manifest und `index.html` mit `Cache-Control: no-cache`, gehashte `/assets/` langlebig.

### Link-Vorschau (Open Graph, WP-030)
- Messenger (WhatsApp, Signal, …) laden die geteilte URL ohne JavaScript und lesen die Meta-Tags aus dem ausgelieferten `index.html` – für jede Route dasselbe (SPA-Fallback). Deshalb stehen `og:*`- und `twitter:*`-Tags statisch in `apps/web/index.html`: Titel „Poker – Spiel mit Freunden“, allgemeine Beschreibung, `og:image` = `/og-image.png` (1200 × 630, `summary_large_image`). **Keine Tischdaten**, auch nicht für `/join/…` privater Tische.
- `og:image` und `og:url` müssen absolut sein und zur aufgerufenen Domain passen (zwei Domains, D-023). In `index.html` steht der Platzhalter `__POKER_ORIGIN__`; nginx ersetzt ihn per `sub_filter` (nur `text/html`, `location /`) durch `$og_scheme://$og_host`. Beide Werte sind per `map` geprüft (Schema nur `https`/`http` aus `X-Forwarded-Proto`, Host nur `[a-z0-9.-]` mit optionalem Port, sonst `localhost`), weil sie vom Client kommen. `og:url` ist die Startseite der Domain (nicht der Einladungslink). Die CSP bleibt unverändert, Meta-Tags brauchen keine Ausnahme. Der Vite-Dev-Server lässt den Platzhalter weg (relative URLs).
- Vorschaubild: eigene Grafik aus `apps/web/scripts/generate-og-image.mjs` (`npm run og-image -w @poker/web`, SVG → PNG mit `@resvg/resvg-js`, Farben aus `tokens.css`), eingecheckt in `public/og-image.png`; nicht im Precache des Service Workers (`globIgnores`).
- Geprüft von `scripts/test/og-tags.test.mjs` (Tags, Platzhalter-Ersetzung für beide Domains, nginx-`sub_filter`, Bildgröße, CSP-Wortlaut); manuell: [OPERATIONS.md](OPERATIONS.md#link-vorschau).

### Tests
Vitest mit jsdom und Testing Library (`*.test.ts(x)` neben dem Code): `App.test.tsx` (Routen-Schutz, Rücksprung nach Login, Login-/Registrierungsfehler 400/401/409/429/Netzwerk, Admin-Menü, Abmelden, Einstellungen, Tisch-Route), `api/api.test.ts` (Client, Fehler, `wsUrl`), `auth/validation.test.ts`, `settings/orientation.test.ts`, `legal/legal.test.tsx` (Rechtstexte ohne Login, Footer auf allen Seiten), `feedback/Feedback.test.tsx` (Formular, Zähler, Kontext, Dialog, Einstieg in der App-Shell), `pages/AdminFeedbackPage.test.tsx` (Liste, Filter, Statuswechsel, Fehler), `stats/stats.test.tsx` (Rangliste inkl. geteilter Plätze, ohne Spieler ohne beendete Runde, Hervorhebung, Neuladen bei Fokus; Profil; Runde mit und ohne Teilnahme; Hand mit verdeckten/gezeigten Karten). Spielablauf siehe „Frontend: Spielablauf und Verbindung“. `fetch` wird mit `test/mockApi.ts` ersetzt.

## Design-Tokens (Web)
Gemeinsamer Vertrag für alle Frontend-WPs (D-008: Anmutung PokerStars, eigene Werte). Definiert in [`apps/web/src/styles/tokens.css`](../apps/web/src/styles/tokens.css) (WP-014); Komponenten nutzen nur diese CSS-Variablen.

| Variable | Zweck |
|---|---|
| `--color-bg`, `--color-surface`, `--color-surface-2` | Hintergrund dunkel, Flächen (Plaketten, Menüs) |
| `--color-felt`, `--color-felt-edge` | Tischfilz grün, Tischrand |
| `--color-text`, `--color-text-muted` | Text hell, Nebentext |
| `--color-accent` | Akzent gold (aktiver Spieler, Dealer-Button, Hervorhebungen) |
| `--color-fold`, `--color-call`, `--color-raise` | Aktionsbuttons (rot, grün, gelb/orange) |
| `--color-danger`, `--color-success` | Fehler, Bestätigung |
| `--color-card-face`, `--color-card-red`, `--color-card-black` | Kartenfarben |
| `--color-card-blue`, `--color-card-green` | Karo und Kreuz im optionalen Vier-Farben-Deck |
| `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` | Rundungen |
| `--space-1` … `--space-6` | Abstände (4, 8, 12, 16, 24, 32 px) |
| `--font-sans`, `--font-size-sm`, `--font-size-md`, `--font-size-lg` | Typografie |
| `--shadow-md` | Schatten für Plaketten/Karten |

## Frontend: Lobby
Quellen: `apps/web/src/lobby/`, Seiten `pages/LobbyPage.tsx` und `pages/JoinPage.tsx` (WP-015).

- **Lobby-Client** (`lobby/client.ts`, `LobbyClient`): eigene, kleine WebSocket-Verbindung ohne React-Abhängigkeit, damit sie später mit dem Spiel-Client (WP-018, `src/game/`) zusammengeführt werden kann. Folgt „Was der Client tun muss“ (siehe „Timer und Verbindungsmodell“): `hello` → `welcome` → `lobby.subscribe` (abschaltbar: `subscribe: false` für die Einladungsseite), `ping` alle 20 s, ohne Antwort binnen 10 s Neuaufbau; Reconnect mit Backoff 0,5 … 10 s plus Zufall, sofort bei `online`/sichtbarem Tab; **kein** Reconnect nach 4001 (Status `replaced`, Knopf „Hier weiterspielen“) und 4000 (`outdated`, „Seite neu laden“). Zustand `{ status, tables }` für `useSyncExternalStore`; `lobby.snapshot/update/remove` halten die Liste (nach ID sortiert) aktuell. Anfragen: `createTable(settings)` (Antwort `table.created` per `requestId`), `joinByInvite(code)` (erster `table.state` mit diesem Code); `error` mit passender `requestId` → `LobbyRequestError { code, message }`; ohne Verbindung oder bei Abbruch `code: 'DISCONNECTED'`.
- **`useLobby({ subscribe })`** (`lobby/useLobby.ts`): ein Client pro Seite, Start beim Mounten, `stop()` (Close 1000) beim Verlassen – die Tischseite baut ihre eigene Verbindung auf (der Server hält den Tisch dafür offen, siehe „Aufräumen“). Der Socket kommt aus `LobbySocketContext` (Standard: Browser-`WebSocket`; Tests: `lobby/fakeSocket.ts`).
- **Lobby-Seite:** Verbindungsanzeige, Liste öffentlicher Tische (`TableList`: Name, Status „Offen“/„Läuft“, Spieler/Plätze, Blinds des ersten Levels mit „steigend“/„fest“, Startstack, Zugzeit + Zeitbank, Ersteller; Knopf „Beitreten“ bzw. „Zuschauen“ → `/table/:id`). „Tisch erstellen“ öffnet das Formular; öffentlicher Tisch → direkt zu `/table/:id`, privater Tisch → Kasten mit Einladungslink und „Zum Tisch“.
- **Formular** (`CreateTableForm`, Modell und Prüfung in `tableSettingsForm.ts`): Name (Default „Tisch von <Name>“), Startstack (1.500), Plätze (2–9, Default 9), Start-Blinds (Auswahl aus den Standard-Leveln der Engine), Blind-Erhöhung steigend (Standard, Minuten pro Level, Default 10; Struktur = Standard-Level ab dem gewählten) oder fest, Zugzeit (10–120 s, Default 20), Zeitbank (0–300 s, Default 60), öffentlich/privat. Keine Antes (D-016). Die Feldprüfung nutzt die Grenz-Konstanten aus `@poker/engine/protocol` und zeigt Meldungen je Feld (`aria-invalid`, `aria-describedby`); das Ergebnis läuft zusätzlich durch `validateTableSettings` – denselben Code wie auf dem Server.
- **Einladungslink** (`invite.ts`, `InviteShare`, WP-015/WP-030): private Tische `/join/<inviteCode>`, öffentliche `/table/<id>` (`invitePath`/`tablePath`, `InviteShare path=…`), immer unter der eigenen Origin (D-014). „Link teilen“ öffnet das Teilen-Menü des Geräts (Web Share API) und erscheint nur, wenn `navigator.share` existiert **und** das Gerät einen groben Zeiger hat (`(pointer: coarse)`, Handy/Tablet – `canShareNatively`); am Desktop ist „Link kopieren“ (`navigator.clipboard`) die Hauptaktion, Bestätigung „Link kopiert“. Abbruch im Teilen-Menü kopiert nicht, ein anderer Fehler kopiert; ohne Zwischenablage wird der Link zum Markieren ausgewählt. Der Teilen-Text nennt den Tischnamen (schreibt der Teilende selbst), die Link-Vorschau im Messenger nicht (siehe „Link-Vorschau“).
- **Einladungsseite** `/join/:code`: Verbindung ohne Lobby-Abo, `table.join { inviteCode }`, bei Erfolg `replace` auf `/table/:id` (der Server erlaubt danach den Beitritt per `tableId`); ungültiger Code → Hinweis und Link zur Lobby.
- **Tests:** `lobby/tableSettingsForm.test.ts` (Defaults, Grenzen je Feld, Ergebnis besteht `validateTableSettings`), `lobby/CreateTableForm.test.tsx` (Komponententest der Formular-Validierung), `lobby/client.test.ts` (Protokollablauf, Anfragen, Backoff, 4000/4001, Ping-Timeout), `lobby/invite.test.ts`, `lobby/InviteShare.test.tsx` (Handy → Teilen-Menü, Desktop → kopieren mit Bestätigung), `lobby/LobbyPage.test.tsx` (Live-Updates ohne Reload, Beitreten, öffentlich/privat erstellen, Teilen/Kopieren, 4001, Einladungsseite).

## Frontend: Tischansicht (Layout-Schicht)
Code unter `apps/web/src/table/` (WP-016 Hochformat, WP-017 Querformat und Umschalter). Die Tischansicht ist eine **reine Funktion** eines bereits gefilterten Tischzustands (D-003, D-009): keine eigene Spiellogik, kein Netzwerk, kein Zustand außer Darstellung. Beide Layouts nutzen dieselben Komponenten mit anderen Positionen und Maßen.

**View-Model `TableView`** (`types.ts`) – darstellungsorientiert, ohne Server-/Protokolltypen (nur der Typ `Card` kommt aus `@poker/engine`); das Mapping Protokoll → `TableView` macht `src/game/adapter.ts` (WP-018).
- `seats`: genau 9 Einträge (D-007), Index = Sitznummer; `{ kind: 'empty' }` oder Spieler mit `name`, `stack`, `bet` (Einsatz der laufenden Straße), `status` (`active` | `folded` | `allIn` | `eliminated`), `connected` und `holeCards` (`none` | `hidden` | `visible` = eigene | `shown` = im Showdown aufgedeckt).
- `heroSeat` (eigener Sitz, `null` = Zuschauer), `buttonSeat`, `smallBlindSeat`, `bigBlindSeat`, `toActSeat`, optional `timeRemaining` (0–1, Timer läuft auf dem Server, D-013) und `timeBankSeconds` (Restzeit der Zeitbank, nur solange sie läuft).
- `board` (0–5 Karten), `pots` (Main Pot zuerst, dann Side Pots), `blinds` (`small`, `big`, optional `level`, `ante`).

**Layout** (`layout.ts`, rein und unit-getestet): `placeSeats(view)` zeichnet nur belegte Sitze. Der eigene Sitz steht immer unten mittig (Position `B`), die übrigen folgen im Uhrzeigersinn in Sitzreihenfolge; ohne eigenen Sitz steht der niedrigste belegte Sitz unten. `SLOTS_BY_COUNT` wählt je Spielerzahl (1–9) Positionen aus `PORTRAIT_SLOTS`, sodass die Spieler gleichmäßig verteilt sind. Jede Position hat Plaketten-Mittelpunkt und Einsatz-Anker in % der Tischfläche sowie die Seite für Dealer-Button/Blind-Marker. Seitliche Sitze liegen in zwei Reihen (L2/R2 oben, L1/R1 unten), dazwischen bleibt ein Band für Pots und Board.

**Querformat (WP-017):** `placeSeats(view, layout)` mit `layout: 'portrait' | 'landscape'` (Standard Hochformat); `LAYOUT_TABLES` liefert je Layout die Positionstabelle (`PORTRAIT_SLOTS` bzw. `LANDSCAPE_SLOTS`, gleiche Positions-IDs) und die Verteilung je Spielerzahl (`SLOTS_BY_COUNT` bzw. `LANDSCAPE_SLOTS_BY_COUNT`). Die Sitzrotation ist in beiden Layouts gleich (eigener Sitz unten mittig). Im Querformat ist der Tisch breit und flach: drei Plätze oben (TL/T/TR), je zwei an den Seiten (L2/R2 oben, L1/R1 halbe Höhe), BL unten links; die Ecke unten rechts gehört der Aktionsleiste, `BR` sitzt deshalb darüber und wird nur bei 9 Spielern genutzt – bis 8 Spieler ist die Verteilung links/rechts symmetrisch (6 Spieler: B, L1, TL, T, TR, R1). Der eigene Einsatz steht links neben den eigenen Karten.

**Welches Layout gilt (D-009):** `resolveLayout(preference, deviceLandscape)` (rein, in `layout.ts`): `auto` folgt dem Viewport, `portrait`/`landscape` erzwingen das Layout auch gegen die Gerätelage. `useTableLayout(preference)` (`useTableLayout.ts`) liest die Lage live per `matchMedia('(orientation: landscape)')` (`useSyncExternalStore`; ohne `matchMedia` gilt Hochformat). Erzwungenes Layout gegen die Gerätelage wird nicht gedreht, sondern eingepasst (Querformat-Tisch höchstens `56cqw` hoch und vertikal zentriert, Hochformat wie bisher höchstens `60cqh` breit) – auf Handys ist das klein, aber vollständig.

**Umschalter und Zustand:** `TableScreen` = `PokerTable` + Layoutwahl + `TableMenu`. Präferenz aus `useOrientationPreference()` (dieselbe wie auf der Einstellungsseite, Änderungen wirken sofort in beide Richtungen); optional gesteuert über `preference`/`onPreferenceChange` (Testseite). `TableMenu`: Knopf oben links (`.pt-menu-slot`, absolut über der Kopfzeile, nimmt keinen Platz im Raster), Panel mit Ausrichtung Auto/Hoch/Quer, schließt bei Escape und Klick außerhalb; weitere Einträge per `menuItems` (WP-018). `PokerTable` hat für beide Layouts **denselben Elementbaum** (nur Klasse `pt-root--<layout>`, `data-layout` und Positionen ändern sich): ein Wechsel mountet nichts neu, Zustand in Aktionsleiste und Menü bleibt erhalten (belegt in `TableScreen.test.tsx`). Wer später den Tischzustand und die Verbindung hält (WP-018), sitzt oberhalb von `TableScreen` und ist vom Layout unabhängig.

**Komponenten:** `PokerTable` (Props `view`, `fourColor`, `actionBar`, `layout`, `menu`; Kopfzeile mit Level/Blinds, ovaler Filz, Sitze, Einsätze, Pots + Board in der Mitte, unten der freie Bereich `actionBar` für die Aktionsleiste aus WP-018), `SeatPlate` (Name, Stack bzw. „All-in“/„Ausgeschieden“, Etikett „Fold“/„Getrennt“, Symbol bei getrennter Verbindung, Leuchtrand am Zug, Timer-Ring als SVG-Rahmen um die Plakette, sobald `timeRemaining` gesetzt ist – unter 25 % in `--color-danger` –, darunter „Zeitbank N s“, solange die Zeitbank läuft (WP-018)), `Card` (Vorder-/Rückseite, Größen `seat`/`board`/`hero`, optional Vier-Farben-Deck), `BetChips`, `DealerButton` (auch SB/BB-Marker), `Board` (freie Plätze bleiben reserviert), `PotDisplay` („Pot“ bzw. „Main Pot“/„Side Pot n“). Öffentliche API: `src/table/index.ts`.

**Skalierung:** `.pt-host` und `.pt-root` sind Size-Container; im Hochformat ist `.pt-root` höchstens `60cqh` breit. Alle Größen sind Vielfache der Grundeinheit `--u` (Hochformat `1cqw`, Querformat `min(0.95cqh, 0.48cqw)` der Tischfläche), Positionen Prozent der Tischfläche – kein festes Pixel-Layout. Im Querformat hat das Raster nur Kopfzeile + Tisch; die Aktionsleisten-Fläche (`.pt-action-slot`, gleiches Element) liegt absolut unten rechts (`--pt-action-w` 200–340 px, `--pt-action-h` 72–120 px). Schriften haben eine Untergrenze von 11 px. Farben nur über die Design-Tokens oben; `table.css` mappt sie einmal auf lokale Aliase mit Fallback (`--pt-felt: var(--color-felt, …)`), damit die Ansicht auch ohne `tokens.css` funktioniert. Einzige tischlokale Farben: Karo/Kreuz im Vier-Farben-Deck.

**Assets:** Karten, Kartenrücken, Chip, Dealer-Button und Symbole sind selbst gezeichnete React-SVG-Komponenten (D-008), Herkunft in `apps/web/src/table/ASSETS.md`.

**Testseite und Tests:**
- `dev/TableDevPage.tsx` mit Mock-Zuständen (`dev/mocks.ts`: 2/6/9 Spieler, Preflop, Flop mit Einsätzen, All-in mit Side Pots, Showdown, getrennt/ausgeschieden, dazu 3/4/5/7/8 Spieler) und Umschaltern (Zustand, 4 Farben, Ausrichtung) sowie dem Tisch-Menü (`TableScreen`); URL-Parameter `state=<id>`, `four=1`, `bare=1` (ohne Umschalter-Leiste), `layout=auto|portrait|landscape` (gilt nur für die Seite, ohne die gespeicherte Einstellung zu ändern; ohne Parameter gilt die gespeicherte Einstellung). Eigene Vite-Entry `apps/web/table-dev.html` → `src/table/dev/main.tsx` (im Dev-Server unter `/table-dev.html`, für Playwright); zusätzlich im App-Router unter `/dev/table`, nur wenn `import.meta.env.DEV` (nicht im Prod-Build).
- Komponenten-Tests (Vitest + Testing Library, `// @vitest-environment jsdom` pro Datei): `layout.test.ts` (inkl. Querformat, `resolveLayout`), `PokerTable.test.tsx` (inkl. Timer-Ring/Zeitbank), `TableScreen.test.tsx` (Layoutwechsel ohne Neu-Mounten, Auto folgt `matchMedia`, Menü, Einstellung).
- Screenshot-Tests (Playwright, `apps/web/e2e-visual/`, Dateien `*.pw.ts` – Vitest sammelt sie nicht ein): je Mock-Zustand auf 360×740 und 430×932 (Hochformat) sowie 740×360 und 932×430 (Querformat, jeweils per „Auto“) Bounding-Box-Prüfungen (keine Überlappung zwischen Sitzen, Einsätzen, Pots, Board, Kopfzeile, Menü-Knopf; alles im Viewport und außerhalb der Aktionsleisten-Fläche; kein abgeschnittener Text, Schrift ≥ 11 px) plus Screenshot-Vergleich für 2/6/9 Spieler; dazu Umschalter-Tests (erzwungenes Layout, Drehen bei „Auto“, Menü-Auswahl ohne Neu-Mounten). Baselines in `e2e-visual/__screenshots__/` mit Plattform-Suffix (`-darwin`). Ausführen: `npm run test:visual -w @poker/web` (startet Vite auf Port 4316, D-006; Chromium einmalig per `npx playwright install chromium` im Workspace). Baselines aktualisieren: `npm run test:visual -w @poker/web -- --update-snapshots=all`. Nicht Teil von `npm run check` (langsam, plattformabhängig).

## Frontend: Spielablauf und Verbindung
Code unter `apps/web/src/game/` und `apps/web/src/table/actions/` (WP-018). Setzt die Client-Pflichten aus „Timer und Verbindungsmodell“ um und verbindet den Server-Zustand mit der Tischansicht. Der Server bleibt autoritativ (D-003): der Client zeigt an, was im letzten `table.state` steht, und sendet Wünsche; er rechnet weder Grenzen noch Gewinner selbst aus.

**Schichten:**
| Datei | Aufgabe |
|---|---|
| `game/connection.ts` | `GameConnection`: eine WebSocket-Verbindung auf `wsUrl('/ws')` mit Handshake, Heartbeat, Backoff und Wieder-Beitritt; ohne React |
| `game/tableGame.ts` | `TableGameStore`: Zustand eines Tisches (letzter `table.state`, Empfangszeit, Rundenergebnis, Fehler, Vorab-Aktion, „Aktion unterwegs“) und Wünsche an den Server |
| `game/hooks.ts` | `useTableGame(tableId)` (Store + Verbindung pro Seite, `useSyncExternalStore`), `useNow` (Uhr für den Timer-Ring) |
| `game/adapter.ts` | `toTableView(server, { turnClock, nowMs })` Protokoll-`TableView` → View-Model der Tischansicht; `heroHandContext(server)` für die Aktionsleiste |
| `game/turnClock.ts` | `readTurnClock` (Zug-Uhr auf die lokale Uhr umgerechnet), `turnClockDisplay` (Anteil für den Ring, Zeitbank-Sekunden) |
| `game/results.ts` | Texte für Showdown (`handResult`, `describePotResult`) und Rundenende (`standingRows`) |
| `game/GameTable.tsx`, `game/GamePanels.tsx` | Spielseite: `TableScreen` + Inhalt des `actionBar`-Bereichs, Verbindungshinweis, Fehlermeldung, Rundenende-Dialog, Menü-Einträge |
| `table/actions/` | `ActionBar`, `BetSlider` und die reine Logik dazu (`logic.ts`) |
| `game/dev/DevNewTablePage.tsx` | `/dev/new-table` (nur Dev-Build): Tisch per `table.create` anlegen, gleich Platz 1 nehmen und zum Tisch wechseln – bis es die Lobby gibt (WP-015) |

**Verbindung (`GameConnection`):**
- Status: `connecting { attempt }` → nach `welcome` `open`; bei Abbruch `waiting { attempt, retryAt }`; `replaced` (4001); `failed { reason: 'version' | 'unauthorized' }`; `closed` (nach `stop()`).
- Erst nach `welcome` gilt die Verbindung als offen; dann sendet sie für jeden beobachteten Tisch (`watchTable`) `table.join { tableId }`. Jeder neue `table.state` ersetzt den Stand vollständig. `send()` liefert `false`, wenn nicht offen – Aktionen werden **nicht** gepuffert.
- Backoff: `0,5 s · 2^(n−1)`, höchstens 10 s, ±20 % Zufall (`DEFAULT_BACKOFF`); `n` = Abbrüche in Folge seit dem letzten `welcome`. Sofort neu verbinden bei `online` und wenn der Tab sichtbar wird (bei offener Verbindung dann sofort `ping`); `offline` trennt sofort. „Jetzt verbinden“ im Hinweis überspringt das Warten.
- Heartbeat: nach 20 s ohne Nachricht `ping`; kommt binnen 10 s nichts (irgendeine Nachricht zählt), gilt die Verbindung als tot und wird neu aufgebaut (`DEFAULT_HEARTBEAT`).
- Close-Code 4000 → `failed('version')`, Hinweis „Neu laden“; 4001 → `replaced`, kein automatischer Versuch, Knopf „Hier weiterspielen“ verbindet bewusst neu. Nach 3 Fehlversuchen in Folge prüft sie `GET /api/me`; bei 401 → `failed('unauthorized')` mit Link zum Login.
- Eine Verbindung pro Spielseite (`useTableGame`); Lobby und Tisch teilen sich (noch) keine Verbindung. Der Lobby-Client (`lobby/client.ts`, WP-015) setzt dieselben Regeln eigenständig um (Anfrage/Antwort für `table.create`/Beitritt per Code); beide zusammenzuführen ist Folgearbeit.

**Tisch-Store (`TableGameStore`):**
- `act(action)` sendet `table.action` mit `handNumber`/`seq` = `actionSeq` der letzten Sicht. Bis ein neuer Stand (andere `handNumber/actionSeq`) oder ein Fehler kommt, ist die Aktionsleiste gesperrt (kein Doppelklick); ein Verbindungsabbruch gibt sie wieder frei. Server-Fehler (deutsch) erscheinen als Meldung (`ErrorToast`, 4 s); `TABLE_NOT_FOUND` zeigt „Diesen Tisch gibt es nicht (mehr)“ (auch nach einem Server-Neustart).
- `sit`, `stand`, `startRound`, `leave` (`table.leave`, vor dem Start steht man dabei auf). Vor dem Start zeigt der Aktionsbereich „Platz nehmen“ (erster freier Sitz) bzw. „Aufstehen“ und für den Ersteller „Runde starten“ (ab 2 Spielern).
- Rundenende: `table.roundFinished` öffnet den Dialog; wer die Nachricht verpasst hat (Reconnect), bekommt das Ergebnis beim Wechsel auf `status: 'finished'` aus `round.standings`. Nach dem Schließen holt „Ergebnis“ es wieder. „Nochmal“ (nur Ersteller, nur `finished`, D-020) sendet `table.rematch`; sitzen getrennte Spieler am Tisch, nennt der Dialog sie („spielt bei „Nochmal“ nicht mit“, D-024); der nächste `table.state` mit `running` schließt das Ergebnis bei allen, Fehler (`NOT_CREATOR`, `ROUND_NOT_FINISHED`, `NOT_ENOUGH_PLAYERS`) erscheinen als Meldung.
- **Admin deckt Karten auf** (WP-033, D-027): `GameConnection.isAdmin` kommt aus `welcome`. Sitzt ein Admin am Tisch, gibt `GameTable` der Tischansicht die Prop `reveal` (`CardReveal`: bekannte Karten, aufgedeckte Plätze, `onToggle`); verdeckte Karten der Mitspieler werden dann zu Schaltern (`table/RevealableCards.tsx`, Drehung per CSS in `table/reveal.css`, nur mit Animationen). Zustand rein in `game/adminReveal.ts`: der erste Tipp auf einen Platz sendet `admin.revealCards` (`requestId` `reveal:<Platz>`), `admin.cards` dreht um; Zurückdrehen und erneutes Umdrehen derselben Hand passieren nur im Client (keine Anfrage, kein Protokolleintrag). Neue oder beendete Hand, `table.left`/`table.closed` → alles vergessen. Fehler darauf erscheinen als Meldung, ohne die Aktionsleiste freizugeben. Nicht-Admins und Zuschauer sehen keinen Unterschied.
- `table.closed { reason }` (verwaiste Runde abgebrochen, D-022, oder Admin, WP-028): Tisch nicht mehr beobachten, Hinweis „Runde abgebrochen – niemand war mehr da“ bzw. „Ein Admin hat den Tisch geschlossen – die Runde zählt nicht.“, nach 5 s (oder per Knopf) zurück zur Lobby. Der `switch` über `ServerMessage` ist erschöpfend (`satisfies never`), neue Nachrichtentypen fallen beim Typecheck auf.
- Tisch-Menü (`menuItems` von `TableScreen`): Tischname, „Einladen“ (`InviteShare` aus `lobby/`; privat mit Einladungslink, öffentlich mit Link zum Tisch), „Feedback senden“ (`useFeedbackDialog({ tableId })`, Dialog per Portal außerhalb des Menüs), Links „Impressum“/„Datenschutz“ (neuer Tab), „Tisch verlassen“.

**Adapter (`toTableView`):** Sitze aus `seats` (Name, `connected`), Stack/Einsatz/Status aus der laufenden Hand bzw. `round.players`; ausgeschieden = Stack 0 mit Platzierung und nicht mehr in der Hand. Karten: eigene `visible`, aufgedeckte fremde `shown`, sonst `hidden`; gefoldet bzw. im Showdown gemuckt `none`. `toActSeat` nur in der Setzphase. Pots = `calculatePots` (Engine) über die Einsätze **früherer** Straßen – die laufende Straße liegt noch als Einsatz vor den Sitzen; nach der Hand (`phase: complete`) keine Pots und Einsätze mehr, das Ergebnis steht im Aktionsbereich. Blinds aus der Hand, sonst aus dem Level bzw. den Einstellungen; Level-Nummer nur bei steigenden Blinds.

**Timer:** `readTurnClock` nimmt `turnClock` nur, wenn `handNumber`/`actionSeq` zur Hand passen, und verschiebt alle Zeitpunkte um `serverNowMs − Empfangszeit`. Der Ring zeigt erst den Anteil der normalen Zugzeit, danach (Deadline > Zugende) den Anteil der Zeitbank, darunter „Zeitbank N s“. Liegt die Deadline vor dem Zugende (Zeitbank leer, Spieler getrennt), endet der Ring dort. Die Seite rendert dafür alle 200 ms neu, solange eine Uhr läuft.

**Aktionsleiste (`ActionBar`, `BetSlider`):** Grenzen nur aus `legalActions` (`actionOptions`): Fold; Check **oder** Call mit Betrag (reicht der Stack nur zum Call: „All-in“); Bet/Raise öffnet über der Leiste die Einsatzwahl – Schnellwahl ½ Pot / Pot / All-in (`potWager`: höchster Einsatz + Anteil × (Pot + eigener Call), auf `[min, max]` geklemmt), Regler in Schritten ab `min` (Maximum immer erreichbar), Zahleneingabe (außerhalb der Grenzen markiert, beim Verlassen geklemmt); der Knopf wird zu „Raise auf X“/„Bet X“/„All-in X“. Der Höchstbetrag geht als `allIn`, sonst `bet`/`raise` mit `amount` = Gesamteinsatz der Straße. All-in unter dem Mindest-Raise hat einen eigenen Knopf. Neue Grenzen vom Server setzen die Einsatzwahl zurück. Knöpfe ≥ 44 px, Farben `--color-fold/call/raise`. Die Leiste füllt den `actionBar`-Bereich beider Layouts (Hochformat unten, Querformat unten rechts).

**Vorab-Aktionen** (nicht am Zug, aber noch in der Hand): „Check/Fold“ (bzw. „Fold“, wenn ein Einsatz offen ist), „Check“ bzw. „Call X“, „Call any“ – Umschalter, eine Wahl zur Zeit. Gültig nur für Hand und Straße der Wahl; „Check“ verfällt bei einem Einsatz, „Call X“ bei geändertem Betrag. Sobald man am Zug ist, löst der Store sie genau einmal aus (`resolvePreAction`, nur legale Aktionen).

**Showdown und Rundenende:** Nach der Hand zeigt der Aktionsbereich je Pot „X gewinnt N – Handbeschreibung“ (geteilt: „X und Y teilen sich N“; ohne Showdown ohne Hand) und die eigene Hand; die gezeigten Karten liegen an den Sitzen. Endet damit die Runde, bleibt dieses Ergebnis neben „Ergebnis“/„Zur Lobby“ sichtbar. Der Rundenende-Dialog listet Platz, Spieler und Punkte; geteilte Plätze als Bereich „2.–3.“ (D-018).

**Animationen:** Klasse `pg-anim` an der Spielseite, wenn „Animationen“ an ist (Einstellungen): Karten gleiten ein, Einsätze erscheinen mit kurzem Skalieren, Panels blenden ein. Unter `prefers-reduced-motion: reduce` immer aus. Nur `translate`/`scale`/`opacity`, damit Layout-Transforms der Tischansicht unberührt bleiben.

**Tests:**
- Vitest: `connection.test.ts` (Handshake, Backoff, 4000/4001, Session-Prüfung, Heartbeat, online/offline/sichtbar; Fake-Timer + `test/fakeSocket.ts`), `tableGame.test.ts` (Aktion mit `handNumber/seq`, Doppelklick, Fehler, Vorab-Aktionen auslösen/verfallen, Rundenende), `adapter.test.ts`, `turnClock.test.ts`, `results.test.ts`, `GameTable.test.tsx` (Seite mit Fake-Verbindung), `adminReveal.test.ts` und `GameTableReveal.test.tsx` (WP-033: Anfrage nur beim ersten Tipp, Zurück-/Umdrehen ohne Anfrage, Vergessen nach Handende, Nicht-Admins/Zuschauer ohne Schalter), `table/RevealableCards.test.tsx` (Tipp dreht um und zurück), `table/actions/logic.test.ts`, `table/actions/ActionBar.test.tsx` (nur legale Aktionen, Mindest-Raise, Schnellwahl, All-in, Regler/Eingabe-Grenzen, Vorab-Aktionen). Testdaten entstehen über die echte Engine (`game/test/fixtures.ts`: Runde starten, Aktionen anwenden, `toClientView`).
- Playwright `apps/web/e2e-game/round.pw.ts`: eine komplette Runde mit drei Browser-Kontexten und drei frisch registrierten Usern (`wp018_…`): Tisch über `/dev/new-table` anlegen, Platz nehmen, starten, Timer-Ring sichtbar, Vorab-Aktion, zwei Hände bis zum Showdown, dann All-in bis zum Rundenende-Dialog bei allen. Braucht den laufenden Dev-Stack (Game-Server 4311); startet einen eigenen Vite auf **4317** mit `API_PROXY_TARGET=http://localhost:4311` und `API_PROXY_ORIGIN=http://localhost:4310` (Origin-Prüfung des Servers). Ausführen: `npm run test:game -w @poker/web` (führt auch `smoke.pw.ts` aus; anderer Vite-Port per `PW_PORT`). Nicht Teil von `npm run check`; die Test-User werden am Ende per `DELETE /api/me` gelöscht.
- Playwright `apps/web/e2e-game/smoke.pw.ts` (WP-020, E2E-Smoke-Test): zwei Spieler registrieren sich über die Seite, privaten Tisch über die Lobby erstellen und über den Einladungslink beitreten, All-in bis zum Rundenende-Dialog, danach Konten löschen. Gemeinsame Hilfen beider Tests in `e2e-game/helpers.ts` (Registrieren mit Abwarten des Rate-Limits, Spielen bis Rundenende ohne feste Sleeps, Aufräumen). Ziel per `E2E_BASE_URL` (ohne: eigener Vite), für prod zusätzlich `E2E_ORIGIN` → lokaler Origin-Proxy `scripts/e2e-origin-proxy.mjs` (D-028). Läuft im Release nach dem prod-Start (`scripts/release-verify.sh`); Bedienung: [OPERATIONS.md](OPERATIONS.md), „Release“.

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
  OPERATIONS.md         Betrieb: Start/Stopp, Release, Tunnel, Backup/Restore, Status, Logs, Neustart
  work-packages/        ein WP pro Datei
packages/
  engine/               @poker/engine – Poker-Logik (src/, Tests als *.test.ts daneben)
apps/
  server/               @poker/server – Game-Server (src/main.ts Einstieg, src/app.ts buildApp, build.mjs Prod-Bundle)
  web/                  @poker/web – Frontend (index.html, vite.config.ts, src/, public/icons/, scripts/generate-icons.mjs, ASSETS.md)
docker/
  dev.Dockerfile        Node-Image für server/web in dev
  server.Dockerfile     Prod-Image Server (multi-stage)
  web.Dockerfile        Prod-Image Web (multi-stage, nginx)
  nginx/                nginx-Konfiguration für das Web-Image
  logrotate/rotate.sh   tägliche Log-Rotation in prod (Dienst logrotate, D-025)
compose.dev.yml         Dev-Umgebung (poker-dev)
compose.prod.yml        Prod-Umgebung (poker-prod)
.env.example            alle Umgebungsvariablen mit Defaults (dev)
.env.prod.example       Vorlage für .env.prod (prod, gitignored)
scripts/
  docs.mjs              Doku-Check und -Sync
  lib/prod-env.sh       gemeinsame Helfer der prod-Skripte (Prod-Worktree, .env.prod, BACKUP_DIR)
  prod.sh               prod:up/down/logs/tunnel:up/smoke
  prod-worktree-setup.sh  prod:setup (Prod-Worktree auf main anlegen)
  backup-now.sh         prod:backup
  restore.sh            prod:restore
  status.sh             prod:status
  test-restore.sh       Restore-Test (isolierte prod-Kopie)
  smoke-prod.mjs        Smoke-Test prod (Health + WebSocket)
  release.sh            Release dev → main (im Prod-Worktree)
  test/                 Tests für die Skripte
ops/launchd/            LaunchAgent-Vorlage (caffeinate), nicht automatisch installiert
.githooks/pre-commit    blockiert Commits auf main, führt npm run check aus
package.json            Workspaces und npm-Skripte
tsconfig.base.json      gemeinsame TypeScript-Einstellungen
eslint.config.js        ESLint (Flat Config)
.prettierrc.json        Prettier
vitest.config.ts        Vitest-Projekte aller Workspaces
.nvmrc                  Node 22
```
