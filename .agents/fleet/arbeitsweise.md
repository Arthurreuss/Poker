---
trigger: always_on
description: Regeln für jeden Bau (Worktree, Prüfen, Commit, Zug, Rückläufer, Bericht, Verbote) und Aufbau der Tickets.
---
# Arbeitsweise

Gilt für jeden Bau in jedem Projekt. Wer was entscheidet, steht in `grundsaetze.md`; die Rollen
beschreiben `.claude/skills/` und `.claude/agents/`. Eigenes des Projekts (Prüfbefehle, Ziel-Branch,
Besonderheiten) steht in `.agents/rules/`.

## Ablauf eines Baus
Ein Bau-Agent baut genau ein Ticket. Sein Auftrag nennt nur Ticket, Branch, gesperrte Pfade und,
wenn ein paralleler Bau ebenfalls eine Datenbank-Migration bringt, „Einreihen nach #<nr>“; alles
andere steht hier.
1. **Eigener Worktree:** Worktree und Branch vom Ziel-Branch auf `origin`; im Hauptcheckout wird
   nicht gearbeitet.
2. **Gezielt lesen:** das Ticket mit seinen Kommentaren, `.agents/project.md`, die Regeln in
   `.agents/rules/`. ADRs nur über den Index `docs/DECISIONS.md` und eine Suche nach Stichworten,
   dann die passenden; nie alle.
3. **Umsetzen,** eingeordnet in die Architektur des Projekts; Hilfsskripte (auch zum Ersetzen)
   liegen im Arbeitsordner der Sitzung oder unter `/tmp`, nie im Worktree.
   Entscheiden nach grundsaetze.md „Wer entscheidet was“. Änderungen außerhalb des Repos (Board,
   Labels, Dienste, Daten) geschehen erst nach dem Merge, als eigenes Ticket; müssen sie vorher
   wirken, nur umkehrbar und mit Rückweg im Ticket vermerkt.
4. **Gezielt prüfen:** während der Arbeit nur das Betroffene (einzelne Tests, Linter, schnelle
   Stufe), schwere Prüfungen über die Warteschlange des Verbunds. Den vollen Prüflauf fährt der Zug;
   vor dem Einreihen läuft nach der letzten Änderung, was `.agents/rules/` als Prüfung vor dem
   Einreihen nennt. Jede Prüfung wird bis zur Abschlusszeile abgewartet; Warteschleifen sind vor
   dem Bericht beendet.
5. **Ein Commit je PR:** Ein Ticket kommt in so wenigen PRs wie möglich, meist einem. Jeder PR hat
   genau einen Commit, erst wenn die gezielten Prüfungen grün sind; Hooks laufen. Zwischenstände
   bleiben ohne Commit im Worktree.
6. **Einreihen statt mergen:** Der Bau-Agent mergt nicht und pusht nicht auf den Ziel-Branch. Die
   Belege (Zahlen vorher/nachher, Suchmuster ohne Treffer, Prüfungen) stehen im Abschlusskommentar
   am Ticket, nicht in der Commit-Nachricht. Dann reiht er seinen Branch beim Merge-Zug ein
   (Befehl in `.agents/rules/workflow.md`, Vertrag im fleet-Repo docs/merge-zug.md „Merge-Zug“)
   und endet.
7. **Rückläufer:** Gibt der Zug einen Branch zurück, steht der Grund am Ticket. Behoben wird im
   selben Branch: bei Konflikt auf den Ziel-Branch rebasen und die Konflikte so lösen, dass fremde
   Änderungen erhalten bleiben, danach nur die Konfliktdateien prüfen; bei Rot den Fehler beheben.
   Dann neu einreihen. Ist ein Rot nur Infrastruktur, reiht der Orchestrierer unverändert neu ein.
8. **Aufräumen:** Nach dem Merge gehen Worktree (`git worktree remove`), lokaler Branch und eigene
   Reste (Logs, Caches, Container) weg. Ein Lauf entfernt nur, was er selbst angelegt hat; Reste
   legt er im Worktree, im Arbeitsordner der Sitzung oder unter `/tmp` an (Probe-Checkouts auf
   anderen Rechnern immer unter `/tmp`), nur dort löscht er. Was anderswo liegt, nennt der Bericht.
   Der Arbeitsordner ist mit anderen Agenten geteilt: Eigene Logs und Reste tragen die
   Ticketnummer im Namen (`pruefung-<nr>.log`) und werden einzeln mit festem Pfad gelöscht, ohne
   `*`; einen Worktree räumt `git worktree remove` ab.
9. **Abschlussbericht,** höchstens 15 Zeilen: eingereihter Branch, eigene Entscheidungen, gelaufene
   Prüfungen mit Ergebnis (die echte Zahl des letzten vollen Laufs), was offen bleibt (als
   Ticket), und eine Zeile „Reibung:“ (was hat aufgehalten, welche Regel fehlte oder war unklar;
   sonst „keine“).

**fleet-Checkout** (`<fleet>`: `FLEET_DIR`, sonst der Pfad zum Einreihen in
`.agents/rules/workflow.md`): Nachgezogen wird er nur vom
Orchestrierer bei jedem Start und Weckruf; sonst fasst ihn niemand an. Bricht
`fleet.py projekt abgleichen` mit „alter Stand“ ab, gleicht ein Bau-Agent aus einem eigenen
fleet-Worktree ab (`git -C <fleet> fetch`, dann `git -C <fleet> worktree add --detach
<fleet>/tmp/<name> origin/main`, danach `git worktree remove`). Ändert ein Ticket fleet selbst,
gilt fleets `CLAUDE.md` „Ablauf“: eigener Worktree, Push nach `main`.

## Commits
- Nachricht: `typ(bereich): Beschreibung (ADR XXXX)` mit `feat`, `fix`, `chore`, `docs`,
  `refactor`, `test`; der ADR-Verweis nur, wenn der Bau eine ADR bringt. Sprache wie im Projekt.
- Der Commit trägt `Closes #<nr>`: Ein Ticket ist erledigt, sobald sein Bau-Teil gemergt ist.
  Reste (Handarbeit, Entscheidungen, Folge-Bau) werden vor dem Einreihen eigene Tickets, auch
  eine „bekannte Grenze“, die in der ADR steht.
  `Refs #<nr>` nur, wenn Bau-Arbeit dieses Tickets selbst noch fehlt; welche, steht im Bericht.
- Nie Geheimnisse, große Binärdateien oder Erzeugtes.

## Verbote
- Was die Befehlssperre blockiert (`.claude/hooks/befehlssperre.toml`, eigene Regeln in
  `fleet.toml` `[agenten]`). Es gibt keinen Schalter zum Umgehen; Nötiges führt der Mensch aus.
- Hilfsskripte, Sicherungen und Patch-Reste im Repo (`tmp_*.py`, `fix_*.py`, `*.bak`, `*.orig`,
  Skripte in der Wurzel ohne Eintrag): `scripts/check_wegwerf.py` in der Stufe `static` meldet sie.
- Prüfungen herabsetzen, Tests überspringen oder löschen, eine Ausnahme selbst eintragen. Wer eine
  braucht, meldet sie im Ticket.
- Hintergrundprozesse als fertig melden, bevor sie enden; blockierende Endlos-Befehle.
- Bauende Unter-Agenten (die Dateien ändern, Worktrees anlegen oder einreihen). Erlaubt sind
  höchstens zwei Lese-Agenten zugleich (`.claude/agents/lese-agent.md`), die selbst keine Agenten
  starten.
- Den Ziel-Branch oder den Hauptcheckout anfassen, deployen, taggen.
- Plan-, Vertrags-, Postfach- oder Ticket-Dateien im Repo.
- Änderungen an den Servern von Hand am Verbund vorbei; was den Verbund betrifft, wird im
  fleet-Repo geändert.

## Tickets
Tickets (GitHub-Issues des Projekts) sind die einzige Quelle für Verträge, Stand, Entscheidungen
und Fragen an den Menschen. Agenten und Mensch können dasselbe GitHub-Konto nutzen; wer dran ist,
zeigen deshalb Labels und Präfixe, nicht der Autor.

### Aufbau
Ein Ticket ist der Vertrag für seinen Bau:
- **Ziel** in ein, zwei Sätzen, **Anspruch** (`anspruch.md`), **nicht dabei**.
- **Abnahme-Kriterien** als abhakbare Liste, jedes mit der Prüfung, die es belegt.
- **Abhängigkeiten** als Zeile `Nach #<nr>`, gesperrte Pfade, wenn andere parallel bauen.

Ein großes Vorhaben bekommt ein Leit-Ticket (Label `leit`) mit Meilensteinen und je Baueinheit ein
Ticket; im Leit-Ticket legt der Auftraggeber Entscheidungen ab. Kleine Dinge (klarer Fehler,
Aufräumen) brauchen nur Ziel und Kriterien. Ändert sich das Ziel, ist das eine neue Fassung des
Textes; was sie ersetzt, wird zu Umbau-Tickets. Befunde, die kein Kriterium und keinen Grundsatz
verletzen, halten ein Ticket nicht offen; sie werden eigene Tickets.

### Status
Auf dem Board: `Backlog` → `Bereit` → `In Arbeit` → `Wartet auf Mensch` → `Fertig`. Bereit heißt:
Vertrag vollständig, Abhängigkeiten erledigt. Fertig setzt der Merge (`Closes #<nr>`).

### Labels
| Label | Bedeutung |
|---|---|
| `owner:agent` | ein Agent setzt um |
| `owner:mensch` | nur der Mensch kann es tun |
| `blocked:mensch` | wartet auf den Menschen |
| `needs:decision` | Ob-Frage mit Optionen und Empfehlung |
| `needs:handarbeit` | Handgriff außerhalb des Codes (Geheimnisse, Konten, Netz, sudo) |
| `leit` | Leit-Ticket eines Vorhabens |
| `rat` | Weichenstellung für den Rat; seine Entscheidung steht als Kommentar daran |

### Blocker-Regel
Braucht ein Ticket den Menschen außerhalb des Codes, entsteht ein eigenes Ticket mit
`owner:mensch`, `blocked:mensch` und `needs:handarbeit` oder `needs:decision`: Ziel in einem Satz,
nummerierte Schritte mit genauen Werten, Prüfbefehl, „Fertig, wenn“, Verweis auf die blockierten
Tickets. Diese bekommen `blocked:mensch` und den Status `Wartet auf Mensch`; gearbeitet wird an
anderen. Der Mensch hakt ab und schließt; ein Agent prüft mit dem Prüfbefehl und gibt die
blockierten Tickets frei.

### Kommentare
Agenten beginnen jeden Kommentar mit `[Claude]` und ihrer Rolle (`[Claude] Orchestrierer: …`, der
Zug mit `[Claude] Merge-Zug: …`). Ein Kommentar ohne Präfix ist vom Menschen.
