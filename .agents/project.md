# poker — Master Index und Arbeitsregeln

Einstiegsdokument für alle Coding-Agenten. Es gilt ausnahmslos für jede Sitzung.

## Leitlinien aus fleet (`.agents/fleet/`)
Gelten in jedem Projekt, gespiegelt und nicht von Hand geändert: `grundsaetze.md` (Vorrang, wer
entscheidet), `anspruch.md`, `baukasten.md`, `arbeitsweise.md` (Ablauf eines Baus, Verbote,
Tickets). Die Rollen sind Skills (`.claude/skills/`) und Agenten-Definitionen (`.claude/agents/`);
`scripts/start.sh` öffnet Planer und Orchestrierer.

## Grundgesetze des Projekts
Was nur hier gilt; es ergänzt die Leitlinien und streicht nichts.
1. **Nur Spielgeld** (D-001): Chips haben keinen Geldwert; kein Kauf, kein Auszahlen, kein Tausch.
2. **Eigene Grafiken und Klänge** (D-008): keine Originalassets anderer Anbieter; Herkunft und
   Lizenz fremder Dateien stehen in den `ASSETS.md` von `apps/web`.

## Regeln (`.agents/rules/`)
| Datei | Inhalt |
|---|---|
| `architektur.md` | abgesegnete Architektur, Datei-Verfassung |
| `workflow.md` | eigene Befehle: Merge-Zug, Prüfen |
| `ordnung.md` | Struktur, ADRs, Doku, Geheimnisse |
| `testing.md` | Teststufen, Prüfpakete, Test-Postgres |
| `betrieb.md` | Prod, Prioritäten, Modelle, Überwachung im fleet-Verbund |

## Dokumentation
- `docs/PRODUCT.md`: Vision, Nutzerpfade, Anspruch je Bereich.
- `docs/ARCHITECTURE.md`: Aufbau im Einzelnen (Engine, Server, Frontend, Protokoll, Datenmodell);
  gezielt den Abschnitt lesen.
- `docs/OPERATIONS.md`: Betrieb (Release, Deploy-Job, Backups, Tunnel, Fehlersuche).
- `docs/DECISIONS.md`: Entscheidungen D-001 bis D-039 (Bestand) und Index der ADRs; gezielt suchen
  (`grep -ril <stichwort> docs/adr docs/DECISIONS.md`), nie alles lesen. Neue Festlegung nach
  `ordnung.md` „ADRs“.
- Arbeitsstand und Pläne: GitHub-Issues (`gh issue list -R Arthurreuss/Poker`). Ältere Texte nennen
  noch Arbeitspakete `WP-NNN` (ADR 0001); offene sind Tickets mit dieser Nummer im Titel.
