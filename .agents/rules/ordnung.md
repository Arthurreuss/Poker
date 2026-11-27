---
trigger: always_on
description: Struktur, ADRs, Doku und Geheimnisse im Projekt poker.
---
# Ordnung

Ordnung und vollständiger Abbau als Grundsatz: `.agents/fleet/grundsaetze.md`; keine Plan- oder
Ticket-Dateien und Aufräumen nach einem Lauf: `.agents/fleet/arbeitsweise.md`. Hier steht, wie das
Projekt sie umsetzt.

## Struktur
- Neue Ordner nur mit Grund und einer Zeile in `README.md` („Aufbau“). Kein `utils/`, `misc/`,
  `tmp/` oder `alt/` im Repo. Ordner und Schichten prüft `scripts/check_struktur.py`.
- Erzeugtes (Builds, Caches, `.venv`, `node_modules`) steht in `.gitignore`.
- Beim Ersetzen bekommt auch der ADR-Index „ersetzt durch“ (unten); keine auskommentierten Blöcke,
  keine Kompatibilitätsschichten ohne Abnehmer.

## ADRs
- Jede dauerhafte Festlegung ist eine eigene Datei `docs/adr/NNNN-kurzer-slug.md`
  (Kleinbuchstaben, Ziffern, Bindestriche) mit `# ADR NNNN — Titel`, Leerzeile, `Status: …`,
  `Bereich: …`, dann `## Kontext`, `## Entscheidung`, `## Konsequenzen`.
- Der Index `docs/DECISIONS.md` ist erzeugt: `python3 scripts/adr.py index` schreibt seine Tabelle
  aus den ADRs, `scripts/adr.py` prüft sie in der Stufe `static`. Nie von Hand ändern.
- Auf einem Feature-Branch steht statt der Nummer der Platzhalter `XXXX` (Datei `XXXX-slug.md`,
  Titel `# ADR XXXX — …`, Verweise `ADR XXXX`, Commit-Titel `… (ADR XXXX)`); im Index steht die
  neue ADR noch nicht. Die Nummer vergibt beim Merge der Zug (Haken `scripts/adr.py nach-rebase`),
  damit parallele Branches nicht dieselbe Nummer nehmen; er setzt sie in die Zeilen ein, die der
  Branch geändert hat, außer in String-Literalen. Bringt ein Branch mehrere neue ADRs, nennen
  Verweise außerhalb der ADR selbst den Pfad (`docs/adr/XXXX-slug.md`); ein bloßes `ADR XXXX` ist
  dann mehrdeutig und der Branch kommt zurück.
- Wo der Haken nicht ersetzt, steht kein Platzhalter, auch nicht im Pfad `docs/adr/XXXX-…`: in
  String-Literalen jeder Sprache, in Testdateien außer Python (Ordner `test/`, `tests/`, `e2e/`,
  `fixtures/`, `__tests__/`, Dateien `test_*`, `*.test.*`, `*.spec.*`), in Code außerhalb ganzer
  Kommentarzeilen (`#`, `//`, `/*`, `*` am Zeilenanfang) und in Dateien, die weder Fließtext
  (`.md`, `.txt`, `.toml`, `.yaml`, `.ini`, `.cfg`, `.env*`) noch Code mit Kommentarzeilen sind
  (etwa `.html`, `.json`). Dort schickt der Zug den Branch mit der Fundstelle zurück. Stattdessen
  steht ein Verweis ohne Nummer (auf das Ticket oder den Inhalt); die Nummer kommt, wo nötig, nach
  dem Merge mit einem eigenen Ticket. In Python ersetzt der Haken in Kommentaren und Docstrings,
  auch in Tests; in Fließtext nicht in Code-Blöcken, Code-Spans und unter Testordnern, dort bleibt
  der Platzhalter still stehen.
- Abgelöste ADRs werden nicht umgeschrieben: Ihre Zeile `Status:` bekommt „ersetzt durch NNNN“
  bzw. „teilw. ersetzt durch NNNN“, die neue ADR nennt die alte („ersetzt 0003“).
- Status mit festem Anfang: `aktiv` (kommt mit dem Code, also der Normalfall), `vorgeschlagen`
  nur, solange der Bau mit Ticket aussteht (`vorgeschlagen, Bau #12`), `ersetzt durch NNNN`,
  `teilw. ersetzt durch NNNN`.

## Doku aktuell halten
- Wer einen Zustand ablöst (Name, Stand, Zahl), zieht die Doku im selben Commit nach und trägt den
  alten Begriff in `ABGELOEST` von `scripts/check_drift.py` ein; der Wächter läuft in der
  schnellen Prüfstufe und findet jede Stelle.
- Zahlen über den Stand (Versionen, Zähler, Anteile) stehen nicht von Hand in der Doku, sondern
  kommen aus dem Code.

## Geheimnisse
- Nie im Repo: Passwörter, Tokens, Schlüssel, private URLs mit Zugang. Vorlage für Namen:
  `.env.example`; die echte `.env` ist ignoriert.
- Auf den Servern liegen die Geheimnisse des Projekts nur im Prod-Checkout, ignoriert: Werte in
  `.env.prod`, Dateien unter `.secrets/` (Modus 600; docs/OPERATIONS.md). `~fleet/.fleet/secrets/`
  gehört dem Verbund (fleet-Repo docs/maschinen.md „Geheimnisse“).
