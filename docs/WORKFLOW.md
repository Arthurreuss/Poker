# Arbeitsweise

## Grundprinzip
Arbeit passiert in **Arbeitspaketen (WPs)**. Ein WP ist klein genug für 1–3 Sessions, hat ein klares Ziel und prüfbare Akzeptanzkriterien. Jedes WP liegt als eigene Datei in [work-packages/](work-packages/) (Vorlage: [_TEMPLATE.md](work-packages/_TEMPLATE.md)).

## Single Source of Truth
| Information | Wo sie lebt | Nicht hier |
|---|---|---|
| Status eines WP | Frontmatter der WP-Datei | PROGRESS.md (wird generiert) |
| Was ein WP liefern muss | Akzeptanzkriterien im WP | Chat, Commit-Messages |
| Warum etwas so gebaut ist | [DECISIONS.md](DECISIONS.md) | Code-Kommentare (dort nur Verweis `D-00X`) |
| Wie das System aufgebaut ist | [ARCHITECTURE.md](ARCHITECTURE.md) | WP-Dateien |
| Verlauf / was zuletzt passiert ist | Log-Abschnitt in PROGRESS.md + Git | — |

Jede Information hat genau **einen** Ort. Andere Dateien verlinken darauf statt sie zu kopieren – so entsteht kein Drift.

## WP-Lebenszyklus
```
todo → in-progress → review → done
          ↓
       blocked (mit Grund im WP-Log)
```
- **todo**: definiert, Akzeptanzkriterien stehen, Abhängigkeiten bekannt.
- **in-progress**: es wird daran gearbeitet. Höchstens **fünf** WPs gleichzeitig, und nur, wenn sie sich nicht behindern (siehe Parallele Sessions).
- **review**: alle Kriterien aus Sicht des Bearbeiters erfüllt, Mensch schaut drüber.
- **done**: alle Checkboxen abgehakt, Tests grün, Doku aktuell, gemerged.
- **blocked**: Grund + was zum Entblocken nötig ist steht im WP-Log.

Ein WP darf erst `in-progress` werden, wenn alle WPs in `depends` `done` sind.

## Ablauf einer Session
1. `CLAUDE.md` → `PROGRESS.md` → aktives WP lesen.
2. WP-Status auf `in-progress` setzen, `npm run docs:sync`.
3. Arbeiten: Test zuerst (bei Logik), dann Implementierung, dann Doku.
4. Am Ende der Session: WP-Log ergänzen (1–3 Zeilen: was getan, was offen), Checkboxen aktualisieren, Session-Eintrag im Log von PROGRESS.md.
5. `npm run check` grün → Commit.

## Definition of Done (gilt für jedes WP)
- [ ] Alle Akzeptanzkriterien im WP abgehakt
- [ ] Tests für neue Logik vorhanden und grün (`npm test`)
- [ ] `npm run check` grün (Tests + Doku-Konsistenz + Lint, sobald vorhanden)
- [ ] Betroffene Doku (ARCHITECTURE, DECISIONS, README) aktualisiert
- [ ] Läuft auf dev per `docker compose up` unter localhost:4310 (sobald Docker-Setup existiert)

## Tests
- **Poker-Logik** (Mischen, Setzrunden, Side Pots, Handbewertung) ist reiner, deterministischer Code ohne I/O → Unit-Tests, Zufall per injizierbarem Seed.
- **Side Pots und Showdown** bekommen tabellarische Testfälle (Eingabe-Stacks → erwartete Pots/Gewinner).
- **Server**: Integrationstests über echte WebSocket-Verbindungen gegen einen Testserver.
- **Frontend**: Komponenten-Tests für Kernansichten; ein E2E-Smoke-Test (zwei Spieler spielen eine Hand).
- Ein Bug wird erst mit einem fehlschlagenden Test reproduziert, dann gefixt.

## Drift-Schutz
`npm run check` (auch als Pre-Commit-Hook) prüft automatisch:
- WP-Frontmatter gültig, ID passt zum Dateinamen, Status erlaubt, `depends` existieren.
- `done`-WPs haben keine offenen Checkboxen; `in-progress` nur, wenn Abhängigkeiten `done` sind.
- Höchstens fünf WPs `in-progress`.
- Jedes WP hat einen Meilenstein (`milestone: M1` …).
- Die generierte Tabelle in PROGRESS.md entspricht den WP-Dateien.
- Relative Links in allen Markdown-Dateien zeigen auf existierende Dateien.
- Entscheidungs-IDs in DECISIONS.md sind eindeutig und fortlaufend.

Was der Check **nicht** sieht (Inhalt veraltet, Architektur beschreibt alten Stand) wird über die Definition of Done abgefangen: Doku-Update gehört zum WP.

## Parallele Sessions
Unabhängige WPs werden von Teil-Sessions (Subagents) parallel bearbeitet:
- **Koordinator** (Haupt-Session) setzt Status (`in-progress`, `review`, `done`), führt `docs:sync` aus, mergt und schreibt das PROGRESS-Log. Alles auf `dev`.
- **Teil-Session** arbeitet in einem eigenen Git-Worktree auf `wp/WP-XXX` (von `dev` abgezweigt). Sie ändert nur Code, Tests, die betroffene Doku und **in ihrer WP-Datei** Checkboxen und Log, aber nie den Status und nie PROGRESS.md. So entstehen keine Merge-Konflikte in generierten Dateien.
- Teil-Sessions committen nur grün (`npm run check`), der Koordinator mergt `wp/WP-XXX → dev` mit `--no-ff`, prüft erneut und setzt den Status.
- Parallel nur, wenn die WPs verschiedene Bereiche anfassen (z. B. `packages/engine` vs. Docker/Infra). Gemeinsame Dateien (Root-`package.json`, Lockfile) ändert im Zweifel nur der Koordinator.
- Rückfragen und Entscheidungen gehen immer an Arthur. Teil-Sessions treffen keine Entscheidungen, die D-Einträge ändern würden, sondern melden sie zurück.

## Branches und Umgebungen
Details und Begründung: D-005 (Branches), D-006 (Ports) und D-017 (Prod-Worktree) in [DECISIONS.md](DECISIONS.md); Bedienung: [OPERATIONS.md](OPERATIONS.md).

| Branch | Zweck | Läuft wo |
|---|---|---|
| `dev` | Arbeitsbranch, hier wird committet; der Arbeitsordner `~/code/Arthurreuss/poker` bleibt immer auf dev | lokal: http://localhost:4310 |
| `main` | Release, nur per Merge von dev; ausgecheckt im eigenen Prod-Worktree `~/code/Arthurreuss/poker-prod` | http://localhost:4320, öffentlich https://poker.arthur-reuss.de (Cloudflare Tunnel) |

- Gearbeitet wird auf `dev` (bei größeren WPs optional auf `wp/WP-XXX` abzweigen und zurück nach dev mergen).
- Release: `npm run check` grün auf dev, lokal per Docker getestet, dann `npm run release` – mergt `dev → main` per `--no-ff` **im Prod-Worktree** (der Arbeitsordner wird nicht umgeschaltet), pusht beide Branches und startet prod aus dem Prod-Worktree neu. Einmalige Einrichtung des Worktrees: `npm run prod:setup`.
- Im Prod-Worktree wird nie direkt gearbeitet oder committet; er ändert sich nur durch `npm run release`.
- Direkte Commits auf `main` blockiert der Pre-Commit-Hook (Merge-Commits per `git merge` lösen ihn nicht aus).
- Keine fremden Ports verwenden: Auf dem Rechner laufen andere Docker-Projekte, Poker bleibt in 4310–4329.

## Commits
- Ein Commit referenziert sein WP: `WP-003: Side-Pot-Berechnung`.
- Kleine Commits, jeder für sich grün.

## Entscheidungen
Neue Architektur-/Technologieentscheidung → Eintrag in DECISIONS.md mit nächster ID (`D-00X`), Kontext, Entscheidung, Konsequenzen. Revidierte Entscheidungen werden nicht gelöscht, sondern als `ersetzt durch D-00Y` markiert.
