# Architektur

_Wird mit den ersten Code-WPs gefüllt. Beschreibt immer den **aktuellen** Stand, nicht Pläne – Pläne stehen in den WPs._

## Komponenten
npm-Workspaces-Monorepo (D-004). Alle Workspaces sind TypeScript (ESM, `strict`). `packages/engine` enthält Karten, Deck und Zufall (siehe unten); `apps/server` und `apps/web` sind noch Platzhalter.

| Workspace | Paket | Zweck |
|---|---|---|
| `packages/engine` | `@poker/engine` | reine Poker-Logik, keine I/O-Abhängigkeiten |
| `apps/server` | `@poker/server` | Game-Server (später Fastify + `ws`); importiert `@poker/engine` |
| `apps/web` | `@poker/web` | Frontend (später React + Vite als PWA) |

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
| `typecheck` | `tsc --noEmit` in allen Workspaces |
| `lint` | ESLint über das ganze Repo |
| `format` / `format:check` | Prettier schreiben bzw. prüfen |
| `test` | Doku-Check-Tests (`node --test`) + Vitest aller Workspaces |
| `docs:check` / `docs:sync` | Doku-Konsistenz prüfen bzw. PROGRESS-Tabelle generieren |
| `check` | `docs:check` + `typecheck` + `lint` + `test` (läuft im Pre-Commit-Hook) |

In einem Workspace gehen auch `npm run typecheck` und `npm test` einzeln (oder vom Root aus mit `-w @poker/engine`).

## Engine: Karten und Zufall
Quellen in `packages/engine/src/` (`cards.ts`, `deck.ts`, `rng.ts`, `crypto-rng.ts`), öffentliche API über `index.ts`.

- **Karte = String** aus Rang + Farbe: `"As"`, `"Td"`, `"2c"` (TypeScript-Typ ``Card = `${Rank}${Suit}` ``, Ränge `2–9 T J Q K A`, Farben `c d h s`). Begründung: ohne Umwandlung JSON-serialisierbar, kompakt im Protokoll und im Engine-Zustand (WP-006), gut lesbar in Tests und Logs, per `===` vergleichbar. Interne Repräsentationen für schnelle Handbewertung (WP-005) kann die Engine daraus ableiten. `parseCard`/`parseCards` validieren (Fehler: `CardParseError`), `isCard` prüft unbekannte Werte z. B. aus Client-Nachrichten, `formatCards` ist die Umkehrung von `parseCards`.
- **Deck** ist ein einfaches `Card[]` (Index 0 = oberste Karte). `createDeck()` liefert die 52 Karten in fester Reihenfolge, `shuffle(items, rng)` ist ein Fisher-Yates-Shuffle, `shuffledDeck(rng)` kombiniert beides, `deal(deck, n)` gibt `{ cards, deck }` zurück. Alles reine Funktionen ohne versteckten Zustand; Eingaben werden nie verändert.
- **Zufall wird injiziert:** `interface Rng { int(maxExclusive): number }` (gleichverteilt in `[0, maxExclusive)`).
  - `createSeededRng(seed)` – deterministischer PRNG (mulberry32, Rejection Sampling gegen Modulo-Bias) für Tests und Simulationen, **nicht** für echtes Spiel.
  - `cryptoRng` – Produktion, nutzt `crypto.randomInt` (unverzerrt, kryptografisch sicher). Liegt in `crypto-rng.ts`, der **einzigen** Engine-Datei mit Node-Import, und wird nur über den Subpfad `@poker/engine/crypto-rng` exportiert, damit `@poker/engine` selbst browser-tauglich und frei von I/O bleibt. Der Server (D-003) übergibt `cryptoRng` an die Engine.
- **Reinheit:** Ein Test (`purity.test.ts`) prüft, dass nur `crypto-rng.ts` Node-Module importiert und keine Engine-Datei `Math.random`, `Date`, `process` o. Ä. nutzt. Die Engine-`tsconfig.json` lädt `@types/node` (für `crypto-rng.ts` und Tests).

## Engine: Zustandsmodell einer Hand
Quellen: `packages/engine/src/hand-state.ts` (Typen) und `betting.ts` (Logik), öffentlich über `index.ts`. Eine Hand ist eine reine Zustandsmaschine:

```
startHand(options) → HandResult        // { ok: true, state } | { ok: false, error: { code, message } }
legalActions(state) → LegalActions | null
applyAction(state, playerId, action) → HandResult
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

## Datenfluss
_noch keiner_

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
  server/               @poker/server – Game-Server
  web/                  @poker/web – Frontend
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
