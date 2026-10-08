# CLAUDE.md – Einstieg für Claude (und Menschen)

Texas-Hold'em-Web-App für Freunde. **Nur Spielgeld**, läuft lokal per Docker.

## Vor jeder Arbeit lesen
1. [docs/WORKFLOW.md](docs/WORKFLOW.md) – wie wir arbeiten (verbindlich)
2. [docs/PROGRESS.md](docs/PROGRESS.md) – wo wir stehen
3. Das Arbeitspaket, an dem gearbeitet wird: `docs/work-packages/WP-XXX.md`
4. Bei Architekturfragen: [docs/DECISIONS.md](docs/DECISIONS.md) und [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Harte Regeln
- Kein Code ohne zugehöriges Arbeitspaket (WP). Kein WP → erst WP anlegen.
- Status eines WP steht **nur** im Frontmatter der WP-Datei. Die Tabelle in `PROGRESS.md` wird generiert (`npm run docs:sync`), nie von Hand editieren.
- Vor jedem Commit muss `npm run check` grün sein (läuft auch als Git-Hook).
- Architekturentscheidungen kommen in `DECISIONS.md`, nicht nur in Chat oder Commit-Messages.
- Ändert sich Verhalten, ändern sich im selben Commit: Code, Tests, betroffene Doku.
