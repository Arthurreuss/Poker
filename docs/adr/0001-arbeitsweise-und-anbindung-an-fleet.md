# ADR 0001 — Arbeitsweise und Anbindung an fleet

Status: aktiv
Bereich: Arbeitsweise

## Kontext
`poker` läuft schon im fleet-Verbund (Prod in einer Prod-VM, Deploy als Nomad-Job, D-039), hatte
aber eine eigene Arbeitsweise: Arbeitspakete `docs/work-packages/WP-NNN.md`, eine generierte
Tabelle und ein Log in `docs/PROGRESS.md`, Regeln in `docs/WORKFLOW.md`, Entscheidungen als
D-Einträge. Arthur hat am 26.11.2026 entschieden, poker an das Agenten-Setup von fleet anzubinden
und die Arbeitspakete auf GitHub-Tickets umzustellen (Arthurreuss/fleet#153).

## Entscheidung
1. Arbeitsweise, Ordnung und Verbote stehen in `.agents/` (Einstieg `.agents/project.md`); die
   Leitlinien und Rollen kommen gespiegelt aus fleet, die Befehlssperre ist aktiv.
2. Arbeit steht in GitHub-Issues von Arthurreuss/Poker mit Board und Labels nach fleet. Die offenen
   Arbeitspakete sind Tickets mit „WP-NNN“ im Titel; das WP-System (Dateien, PROGRESS, WORKFLOW,
   `docs:sync`) ist abgebaut, Erledigtes steht in der Git-Historie.
3. Neue dauerhafte Festlegungen sind ADRs in `docs/adr/` (Index am Ende von `docs/DECISIONS.md`); die
   D-Einträge D-001 bis D-039 bleiben als Bestand und werden über ADRs abgelöst.
4. Gearbeitet wird auf Branches vom Ziel-Branch `dev`; nach `dev` mergt der Merge-Zug von fleet
   (`fleet.toml` [zug], Eintrag `[poker]` in fleets `zug.toml`), bis er steht der Eigentümer.
   `main` bekommt nur Releases (`npm run release`, D-005, D-039).
5. Prüfung: Der Zug prüft die Stufe `static` (Wächter); `npm run check` läuft im Commit-Hook. Weitere
   Stufen (Tests, E2E) kommen mit eigenem Ticket in `scripts/ci_job.sh`.
6. Alles, was poker auf den Servern belegt, steht im Register des fleet-Repos
   (`register/projekte/poker.toml`); Prod und Überwachung ebenfalls dort.

## Konsequenzen
- Agenten arbeiten nach `.agents/fleet/arbeitsweise.md`; Teil-Sessions mit WP-Dateien gibt es nicht
  mehr.
- Ältere Texte und Kommentare nennen noch `WP-NNN`; neue nicht mehr (`scripts/check_drift.py`).
