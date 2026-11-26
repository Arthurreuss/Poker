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
  Hand geändert ist) und `scripts/check_struktur.py` (Ordner und Schichten nach
  `scripts/struktur.toml`). Der Commit-Hook prüft sie bei jedem Commit.
- **Weitere Stufen** (`test`, `e2e`, `smoke` …) richtet das Ticket ein, das sie braucht, an drei
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
- **Stand:** Im Zug läuft nur `static`; `npm run check` (Unit-, Komponenten- und Skript-Tests ohne
  Datenbank) läuft lokal im Commit-Hook. Datenbank-Tests (`npm run test:db -w @poker/server`) und
  die Playwright-Tests brauchen heute einen laufenden Dev-Stack; ihre Stufen über die Warteschlange
  (mit den Regeln unten) kommen mit eigenem Ticket. Bis dahin laufen sie nicht durch Agenten.

## Testdatenbanken und App
Warum das im Projekt liegt: fleet-Repo docs/pruefungen.md „Test-VM und Vorlage-Datenbanken“ und
„Regeln für Tests“.
- **Postgres:** Ist `FLEET_TEST_POSTGRES_URL` gesetzt, nutzt die Testsuite diesen Server; fehlt sie
  oder antwortet er nicht, startet sie einen eigenen (testcontainers), so bleibt Prüfen ohne den
  Verbund möglich.
- **Tests mit Datenbank laufen über die Warteschlange** (`python3 scripts/pruefung.py <stufe…>`),
  auch gezielte während des Baus. Auf der Bau-Maschine gibt es dafür kein Docker; Agenten starten
  dort keinen eigenen Postgres und richten keinen ein. Lokal läuft nur, was keine Datenbank
  braucht.
- **Jede Testdatenbank ist eine Kopie einer Vorlage** `poker_tpl_<hash>` (Hash über die
  Migrationen und alles, was das Schema bestimmt), gebaut unter einer Advisory-Sperre; sie
  überlebt Läufe. Kein Test fährt Migrationen von null, außer Migrationstests, die Zwischenstände
  brauchen. Tests mit eigenen Rollen nehmen eine Vorlage mit festen Testrollen.
- Alles aus einem Lauf heißt `poker_lauf_<alloc8>_…` (Datenbanken und Rollen, `poker`
  ohne `_`); der Lauf löscht es am Ende selbst.
- **App einmal je Test-Worker,** geteilt von seinen Tests (Fixture für die Sitzung). Ihr Start
  bleibt in Tests billig: nichts je Nutzer, keine teuren Importe, kein Netz. Ein eigener Test
  prüft den echten Start.
