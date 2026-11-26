---
trigger: always_on
description: Teststufen, Prüfpakete über die Warteschlange und Test-Postgres im Projekt poker.
---
# Testen

## Ebenen
| Ebene | Was | Wogegen | Laufzeit |
|---|---|---|---|
| Unit | reine Funktionen | nichts | Millisekunden |
| Integration | Datenzugriff, API | eigene Datenbank je Testlauf | schnell |
| Contract | Clients externer Dienste | aufgezeichnete Antworten | schnell |
| Smoke | ganzer Stack | laufender Container | langsam; beim Deploy, als Stufe `smoke` auch in der Prüfung, wenn ein Ticket es verlangt |
| Live | echte Modelle und externe Dienste | echte Endpunkte | eigener Lauf des Verbunds (nachts, auf Zuruf), nie im Zug |

Ein Test prüft genau eine Sache; sein Name beschreibt das Verhalten. Kein Test hängt am heutigen
Datum (Uhr über eine Funktion, die Tests festsetzen können).

## Stufen
Eine Prüfung besteht aus Stufen von `scripts/ci_job.sh`; lokal `scripts/ci_job.sh <stufe…>`, über
die Warteschlange `python3 scripts/pruefung.py <stufe…>`.
- **`static`** ist ab dem ersten Branch eingerichtet (Struktur, vor den Tests):
  `scripts/check_drift.py` (ADR-Status und abgelöste Begriffe in der Doku, Regel „Doku aktuell
  halten“ in `ordnung.md`), `scripts/adr.py` (Namen und Kopf der ADRs, Index gleich dem
  erzeugten, „ADRs“ in `ordnung.md`), `scripts/check_gespiegelt.py` (rot, wenn eine gespiegelte Datei von
  Hand geändert ist), `scripts/check_wegwerf.py` (rot bei Wegwerf-Dateien wie `tmp_*`, `*.bak` oder
  Skripten in der Wurzel außer `*.config.*`, gespiegelt) und `scripts/check_struktur.py` (Ordner und Schichten nach
  `scripts/struktur.toml`). Der Commit-Hook prüft sie bei jedem Commit.
- **`test`:** `npm run check` (Doku-Check, Format, Typecheck, Lint, Skript-, Unit- und
  Komponententests ohne Datenbank); Vitest-Worker nach `FLEET_EINHEITEN`.
- **`db`:** `npm run test:db -w @poker/server`, alle `*.db.test.ts` des Servers
  (`apps/server/vitest.db.config.ts`) gegen den Test-Postgres („Testdatenbanken und App“), Worker
  nach `FLEET_EINHEITEN`. Ein neuer Test mit Datenbank heißt `*.db.test.ts`; `npm run check`
  schließt diese Dateien aus.
- **`e2e`:** Playwright mit Chromium (`browser=True`): die Screenshot-Tests
  (`apps/web/e2e-visual`, Baselines `__screenshots__/*-darwin.png`, Worker nach `FLEET_EINHEITEN`)
  und die Spieltests (`apps/web/e2e-game`) gegen einen Dev-Stack im Paket: Playwright startet
  Game-Server (dev, ohne Rate-Limit) und Vite dieses Stands auf freien Ports gegen eine Kopie der
  Vorlage (`GAME_E2E_DATABASE_URL`).
- Alle vier Stufen prüft der Zug bei jedem Lauf (`fleet.toml` [zug]).
- **Weitere Stufen** (`smoke` …) richtet das Ticket ein, das sie braucht, an drei
  Stellen: in `scripts/ci_job.sh` (`STUFEN` und eine Funktion `<stufe>_stufe`), in `DAUER` von
  `scripts/pruefung.py` und in `fleet.toml` [zug], damit der Zug sie prüft; dazu die Prüfung vor
  dem Einreihen in `workflow.md` und die Stufe mit ihrem Inhalt in dieser Liste. Eine Stufe, die
  nicht eingerichtet ist, bricht mit Exit 2 und Hinweis ab; sie wird nie ohne Prüfung grün.

## Commit-Hook
`.githooks/pre-commit` sperrt Commits auf `main` und prüft bei jedem Commit
`python3 scripts/pruefung.py static` mit der Quelle `commit` (genau der Index); ist die
Warteschlange nicht nutzbar (Exit 75), lokal `scripts/ci_job.sh static`. Danach `npm run check`. Eingerichtet ist er über `git config core.hooksPath .githooks`: Das
setzt `fleet.py projekt anlegen` und nach einem frischen Clone `scripts/start.sh`; es gilt dann in
jedem Worktree des Clones. Rot hält den Commit auf; nie mit `--no-verify` umgehen.

## Prüfungen über die Warteschlange
- Schwere Prüfungen laufen als Pakete in Nomad, je Paket ein Job `pruefung-<quelle>-poker-<paket>-<hex6>`,
  der bucht, was das Paket nach Messung braucht. `scripts/pruefung.py <stufe…>` beschreibt nur die
  Pakete (`plan`); einreichen, messen, einsammeln und die Ergebnisdatei schreiben macht die
  fleet-Bibliothek (`fleetlib.pruefung_ablauf`). Der Knoten ruft `scripts/ci_job.sh <argumente>`.
  Pakete, die einen Browser starten (Playwright), tragen `browser=True`; Pakete mit Test-Datenbank
  oder Browser sind schwer (Namensmuster in fleet `fleet.toml` [pruefung] `schwer`, sonst `schwer=True`).
- Quelle über `PRUEFUNG_QUELLE`: `agent` (Standard), `commit` (Commit-Hook), `merge-zug`
  (`fleet.toml` [zug.umgebung]; Jobs heißen `pruefung-zug-…`), `release`; sie bestimmt die
  Priorität in Nomad.
- Exit 75 von `scripts/pruefung.py` heißt: Warteschlange nicht nutzbar (Nomad weg,
  `PRUEFUNG=lokal`). Der Commit-Hook und die Prüfung vor dem Einreihen prüfen dann lokal mit
  `scripts/ci_job.sh <stufe>`; der Zug hält an und startet begrenzt selbst neu.
- Vertrag von `scripts/ci_job.sh`: fleet-Repo, docs/pruefungen.md „Prüfungen in Paketen“.
- Was jede Prüfung im Verbund einhält (trocken, kein Stück über 120 s, Arbeit senken vor dem
  Teilen, Worker nach Buchung, Frist je Paket, Rücksicht auf Nachbarn): fleet-Repo
  docs/pruefungen.md „Regeln für Tests“.
- `scripts/ci_job.sh` (Hilfen dort): `einheiten_starten` direkt bevor die Worker starten, wenn
  Server und Datenbank laufen (Marke für die Buchung); gleiche Builds über `vorarbeit`, derweil
  Unabhängiges starten.

## Tests von poker
- **Poker-Logik** (Mischen, Setzrunden, Side Pots, Handbewertung) ist reiner, deterministischer
  Code ohne I/O: Unit-Tests, Zufall per injizierbarem Seed; Side Pots und Showdown tabellarisch
  (Eingabe-Stacks → erwartete Pots und Gewinner). Die Reinheit prüft ESLint.
- **Server:** Integrationstests über echte WebSocket-Verbindungen gegen einen Testserver.
- **Frontend:** Komponententests der Kernansichten (Vitest), Geometrie- und Screenshot-Tests
  (`npm run test:visual -w @poker/web`), Spieltest mit Browsern (`npm run test:game -w @poker/web`).
- Ein Fehler wird erst mit einem roten Test nachgestellt, dann behoben.
- **Wo sie laufen:** `npm run check` lokal im Commit-Hook und als Stufe `test`; Datenbank- und
  Playwright-Tests nur als Stufen `db` und `e2e` über die Warteschlange („Stufen“).

## Testdatenbanken und App
Warum das im Projekt liegt: fleet-Repo docs/pruefungen.md „Test-VM und Vorlage-Datenbanken“ und
„Regeln für Tests“.
- **Postgres:** Die Testsuite nutzt nur den Test-Postgres des Verbunds aus
  `FLEET_TEST_POSTGRES_URL` (`apps/server/src/db/test-db.ts`). Fehlt sie oder antwortet er nicht,
  ist jeder Test mit Datenbank rot mit Hinweis auf die Warteschlange, nie übersprungen; einen
  eigenen Postgres (testcontainers) startet sie nie (fleet#131).
- **Tests mit Datenbank laufen über die Warteschlange** (`python3 scripts/pruefung.py db`, `e2e`),
  auch gezielte während des Baus. Auf der Bau-Maschine gibt es dafür kein Docker; Agenten starten
  dort keinen eigenen Postgres und richten keinen ein. Lokal läuft nur, was keine Datenbank
  braucht. Ist die Warteschlange nicht nutzbar (Exit 75), gibt es für `db` und `e2e` keinen
  lokalen Ersatz: Das steht am Ticket, eingereiht wird erst nach Grün über die Warteschlange.
- **Jede Testdatenbank ist eine Kopie einer Vorlage** `poker_tpl_<hash>` (Hash über die
  Migrationen und alles, was das Schema bestimmt), gebaut unter einer Advisory-Sperre; sie
  überlebt Läufe. Kein Test fährt Migrationen von null, außer Migrationstests, die Zwischenstände
  brauchen. Tests mit eigenen Rollen nehmen eine Vorlage mit festen Testrollen.
- Alles aus einem Lauf heißt `poker_lauf_<alloc8>_…` (Datenbanken und Rollen, `poker`
  ohne `_`); der Lauf löscht es am Ende selbst.
- **App einmal je Test-Worker,** geteilt von seinen Tests (Fixture für die Sitzung). Ihr Start
  bleibt in Tests billig: nichts je Nutzer, keine teuren Importe, kein Netz. Ein eigener Test
  prüft den echten Start.
