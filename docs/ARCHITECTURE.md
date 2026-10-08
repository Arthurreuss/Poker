# Architektur

_Wird mit den ersten Code-WPs gefüllt. Beschreibt immer den **aktuellen** Stand, nicht Pläne – Pläne stehen in den WPs._

## Komponenten
npm-Workspaces-Monorepo (D-004). Alle Workspaces sind TypeScript (ESM, `strict`).

| Workspace | Paket | Zweck |
|---|---|---|
| `packages/engine` | `@poker/engine` | reine Poker-Logik, keine I/O-Abhängigkeiten |
| `apps/server` | `@poker/server` | Game-Server: Fastify mit `GET /api/health` (prüft die DB per `pg`), Auth-Endpunkten (`/api/register`, `/login`, `/logout`, `/me`) und Platzhalter-WebSocket `/ws` (`ws`); importiert `@poker/engine` |
| `apps/web` | `@poker/web` | Frontend: React + Vite, derzeit Platzhalterseite mit Health-Anzeige (PWA folgt) |

### Server (`apps/server/src`)
- `config.ts` – `loadConfig(env)`: Konfiguration **nur** aus Umgebungsvariablen (D-014): `PORT`, `DATABASE_URL`, `PUBLIC_ORIGIN` (Pflicht), `HOST` (Standard `127.0.0.1`, im Container `0.0.0.0`), `NODE_ENV` (Standard `development`). Abgeleitet: `trustProxy` = `NODE_ENV === 'production'` (Proxy-Header nur in prod vertrauen, D-014).
- `db.ts` – `Database`-Schnittstelle (`ping`, `query`, `close`; `Queryable` = nur `query`, passt auch auf `pg.Pool`) und `createPgDatabase(url | poolConfig)` mit `pg.Pool`.
- `app.ts` – `buildApp({ db, publicOrigin, trustProxy, auth? })` baut die Fastify-App ohne `listen`; Tests nutzen `app.inject()` und können eine Fake-DB übergeben. `GET /api/health` → `200 { status: "ok", db: "ok" }` bzw. `503 { status: "error", db: "error" }`; die Route loggt nur Warnungen. Registriert das Auth-Plugin (`auth/routes.ts`, siehe „Auth“); `auth` ist optional eine `AuthConfig` (Standard: aus `process.env`).
- `auth/` – Registrierung, Login, Sessions, Rate-Limit (Abschnitt „Auth“); `cli/` – Admin-Skripte.
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

- Alle Dienste `restart: unless-stopped` (geprüft von `scripts/test/compose-prod.test.mjs`), damit poker-prod nach einem Neustart von Docker Desktop ohne Eingreifen wieder läuft. DB-Daten im Named Volume `poker-prod-db`.
- **Backup:** `backup` dumpt täglich (`BACKUP_SCHEDULE`, Standard `@daily`, Zeitzone `BACKUP_TZ`) per `pg_dump -Z6` (Plain-SQL, gzip) über das Netz `backend` in einen Host-Ordner außerhalb von Docker (`BACKUP_DIR`, Standard `~/poker-backups`, aufgelöst in `scripts/lib/prod-env.sh`); Aufbewahrung 7 täglich / 4 wöchentlich / 6 monatlich (`last/`, `daily/`, `weekly/`, `monthly/`). Restore per `scripts/restore.sh`: Server stoppen → DB neu anlegen → Dump in einer Transaktion einspielen → Server starten. Netz `backend` ist `internal` (kein Zugang nach außen), die DB hat keinen Host-Port.
- **Server-Image:** Build-Stage mit allen Abhängigkeiten → `esbuild`-Bundle; eigene Stage installiert nur die Laufzeit-Abhängigkeiten des Servers (`npm ci --omit=dev -w @poker/server`, ohne Source-Maps); Runtime `node:22-alpine` mit `node_modules` + `server.mjs`, User `node`, `NODE_ENV=production`.
- **Web-Image:** Build-Stage `vite build` → Runtime `nginxinc/nginx-unprivileged` (User `nginx`, Port 8080). Konfiguration `docker/nginx/default.conf.template`, Ziel des Proxys per `API_UPSTREAM=server:4321` (envsubst beim Start, Auflösung über Docker-DNS zur Laufzeit). `/api/` und `/ws` gehen an den Server (`/ws` mit Upgrade-Headern, Read-/Send-Timeout 1 h); gzip; `/assets/*` (gehasht) `Cache-Control: public, max-age=31536000, immutable`, `index.html` und SPA-Fallback `no-cache`, `/api/` `no-store`.
- **Proxy-Header:** nginx setzt `X-Forwarded-For` auf `CF-Connecting-IP` (hinter dem Tunnel) bzw. die Peer-Adresse und reicht `X-Forwarded-Proto` von cloudflared durch; der Server vertraut ihnen nur in prod (`trustProxy`).
- **cloudflared:** eigener Tunnel für Poker, unabhängig vom Jarvis-Tunnel (D-014); `TUNNEL_TOKEN` aus `.env.prod`. Public Hostname `poker.arthur-reuss.de` → `http://web:8080`.

## Design-Tokens (Web)
Gemeinsamer Vertrag für alle Frontend-WPs (D-008: Anmutung PokerStars, eigene Werte). Definiert in `apps/web/src/styles/tokens.css` (WP-014); Komponenten nutzen nur diese CSS-Variablen.

| Variable | Zweck |
|---|---|
| `--color-bg`, `--color-surface`, `--color-surface-2` | Hintergrund dunkel, Flächen (Plaketten, Menüs) |
| `--color-felt`, `--color-felt-edge` | Tischfilz grün, Tischrand |
| `--color-text`, `--color-text-muted` | Text hell, Nebentext |
| `--color-accent` | Akzent gold (aktiver Spieler, Dealer-Button, Hervorhebungen) |
| `--color-fold`, `--color-call`, `--color-raise` | Aktionsbuttons (rot, grün, gelb/orange) |
| `--color-danger`, `--color-success` | Fehler, Bestätigung |
| `--color-card-face`, `--color-card-red`, `--color-card-black` | Kartenfarben |
| `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` | Rundungen |
| `--space-1` … `--space-6` | Abstände (4, 8, 12, 16, 24, 32 px) |
| `--font-sans`, `--font-size-sm`, `--font-size-md`, `--font-size-lg` | Typografie |
| `--shadow-md` | Schatten für Plaketten/Karten |

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
  OPERATIONS.md         Betrieb: Start/Stopp, Release, Tunnel, Backup/Restore, Status, Neustart
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
