# Weichenstellung

Teil des Rats-Skills: Ändert eine Entscheidung ein Muster (ein bestehender Weg wird durch einen
neuen ersetzt), erzeugt das Festhalten drei Dinge zugleich, damit nie zwei Wege nebeneinander
bleiben (`.agents/fleet/grundsaetze.md`, Grundsatz 3).

## Die drei Dinge
1. **ADR:** der Kommentar am Rats-Ticket (`SKILL.md` „Ergebnis am Ticket“) mit der Abbau-Liste in
   der Zeile `Abbau:`. Der Bau-Agent des Bau-Tickets schreibt sie; ihre Konsequenzen nennen die
   Umbau-Tickets. Hat das alte Muster eine ADR, bekommt sie „teilw. ersetzt durch NNNN“.
2. **Abbau-Liste:** jede Stelle, die noch dem alten Muster folgt, in Code, Tests, Doku und
   Konfiguration. Jede ist per Suche belegt: Suchbefehl und Fund (`<datei>:<zeile>`). Die Suche
   macht ein Lese-Agent (`.claude/agents/lese-agent.md`) nach Stichworten aus der Frage und den
   Antworten der Sitze; eine Stelle ohne Beleg gehört nicht auf die Liste.
3. **Umbau-Tickets:** je zusammenhängendem Teil der Liste eines, mit `Nach #<Bau-Ticket>`; jede
   Stelle ist ein Abnahme-Kriterium. Was ersetzt wird, wird vollständig abgebaut: Code, Tests, Doku,
   Konfiguration.

## Wird abgebaut
Bis die Liste leer ist (alle Umbau-Tickets geschlossen), ist der alte Weg als „wird abgebaut“
markiert: an der Stelle, die ihn beschreibt (`.agents/rules/architektur.md` oder seine ADR), mit
ADR und Umbau-Tickets. Das setzt das Bau-Ticket. Solange die Marke steht, wird der alte Weg nicht
erweitert; wer ihn braucht, baut auf dem neuen oder meldet es im Umbau-Ticket.

Das letzte Umbau-Ticket nimmt die Marke weg, setzt die alte ADR auf „ersetzt durch NNNN“ und trägt
die Begriffe des alten Wegs in `ABGELOEST` von `scripts/check_drift.py` ein, damit er nicht
wiederkommt.
