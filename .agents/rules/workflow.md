---
trigger: always_on
description: Eigene Befehle und Besonderheiten des Vorgehens im Projekt poker.
---
# Workflow

Ablauf eines Baus, Commits, Verbote und Aufbau der Tickets stehen für alle Projekte gleich in
`.agents/fleet/arbeitsweise.md`. Hier steht nur, was dieses Projekt dazu festlegt.

## Welcher Weg?
- **Neues Vorhaben, Zieländerung, offene Entwurfsfrage:** Zielklärung des Planers
  (`.claude/skills/planer/zielklaerung.md`); der Vertrag ist ein Ticket, gebaut wird, sobald es
  `Bereit` ist.
- **Klarer Fehler, Aufräumen, Umbau mit feststehendem Ziel:** direkt ein Ticket mit Ziel und
  Kriterien, dann Bau nach der Arbeitsweise.
- Stößt ein Bau auf eine Entscheidung, gilt `.agents/fleet/grundsaetze.md` „Wer entscheidet was“;
  was an den Menschen geht, steht als Ob-Frage im Ticket.

## Branches und Umgebungen
Begründung: D-005 (Branches), D-006 (Ports), D-039 (Deploys); Bedienung: `docs/OPERATIONS.md`.

| Branch | Zweck | Läuft wo |
|---|---|---|
| `dev` | Ziel-Branch jedes Baus (Merge-Zug) | lokal `npm run dev:up`, http://localhost:4310 |
| `main` | nur Releases von `dev` | Prod-VM des Verbunds, https://poker.arthur-reuss.de |

- Der Hauptcheckout `~/code/Arthurreuss/poker` bleibt auf `dev`. Worktrees liegen unter
  `.claude/worktrees/` (ignoriert, für VS Code ausgeschlossen); ein frischer Worktree braucht
  `npm ci`, bevor `npm run check` läuft.
- Release (`npm run release`: `dev` → `main` per `--no-ff`, Push, Deploy über die Warteschlange)
  und Rollback (`npm run prod:rollback`) startet nur der Mensch. Direkte Commits auf `main`
  blockiert der Commit-Hook.
- Ports nur aus 4310–4329; auf den Rechnern laufen andere Docker-Projekte.
- Hat ein Merge `package.json`/`package-lock.json` geändert: `npm install` und `npm run dev:up`
  (baut das Dev-Image neu), sonst startet der Dev-Container mit fehlenden Paketen nicht.

## Merge-Zug
Ziel-Branch ist `dev` (`fleet.toml` [agenten] `ziel_branches` sperrt `dev` und `main` für direkte
Pushes). Der Zug für poker steht in `zug.toml` von fleet (`[poker]`); gemergt wird nur über ihn. Einreihen aus dem eigenen Worktree heraus, mit
dem absoluten Pfad zum fleet-Checkout (`FLEET_DIR`, sonst `~/code/Arthurreuss/fleet`, wie
`scripts/pruefung.py`):
```bash
uv run --python 3.12 --no-project "${FLEET_DIR:-$HOME/code/Arthurreuss/fleet}/fleet.py" zug enqueue --ticket <nr> --title "feat(<bereich>): … (ADR XXXX)"
```
Stand mit demselben Aufruf und `zug status --projekt poker`. Wie das Projekt geprüft wird,
steht in `fleet.toml` [zug] (fleet-Repo docs/merge-zug.md „Merge-Zug“). Der Zug prüft über die
Warteschlange (Quelle `merge-zug` aus `fleet.toml` [zug.umgebung], Priorität siehe `betrieb.md`).

Schlägt das Einreihen fehl, auch weil der Zug für das Projekt noch nicht freigegeben ist, steht die
Fehlermeldung als Kommentar am Ticket und der Bau endet dort; der Branch wartet auf den Zug. Ein
eigener PR, ein Merge von Hand oder ein Push auf `dev` oder `main` umgehen den Zug nie, auch nicht
nach einem Fehlschlag.

## Prüfen
Gezielt während der Arbeit und voll im Zug mit `scripts/pruefung.py`; Stufen, Commit-Hook und
Warteschlange in `testing.md`.

**Prüfung vor dem Einreihen:** nach der letzten Änderung im Worktree
```bash
python3 scripts/pruefung.py static && npm run check
```
(`npm run check`: Doku-Check, Format, Typecheck, Lint, Unit- und Komponententests, lokal, solange
es dafür keine Stufe im Zug gibt), dazu bei Datenbank- oder Oberflächenänderungen die betroffenen
Tests aus `testing.md` „Tests von poker“ und jede weitere eingerichtete Stufe (`testing.md` „Stufen“), die der Bau berührt. Eingereiht wird
erst, wenn alle grün sind; Exit 75 heißt Warteschlange nicht nutzbar, dann lokal mit
`scripts/ci_job.sh <stufe>`. Richtet ein Ticket eine Stufe ein, die jeder Bau berührt (etwa
`test`), kommt sie hier in den Befehl.
