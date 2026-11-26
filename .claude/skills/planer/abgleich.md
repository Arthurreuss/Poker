# Abgleich

Teil des Planer-Skills: Der Auftraggeber bleibt auf dem Stand dessen, was ohne ihn entschieden und
gebaut wurde, und kann widersprechen; das System lernt daraus seine Vorstellungen.

## Wann
- Zu Beginn eines Gesprächs, wenn seit dem letzten Abgleich etwas entschieden oder gemergt wurde.
- Auf Wunsch des Auftraggebers, jederzeit.
- Sonst nicht; ohne Neues gibt es keinen Abgleich.

## Bis wohin
Jeder Abgleich endet mit einem Kommentar am jüngsten offenen Ticket mit Label `leit`, erste Zeile
`[Claude] Planer: Abgleich bis <Zeitpunkt in UTC>`, darunter die Übersicht. Der jüngste solche
Kommentar an einem Ticket mit Label `leit`, offen oder geschlossen, ist die Marke für den nächsten.
Ohne Marke reicht der Abgleich bis zum Anfang des Projekts.

## Was hinein kommt
Seit der Marke, gezielt gesucht (bei Bedarf mit Lese-Agenten):
- **Rat:** je Kommentar „[Claude] Rat: Entscheidung“ an einem geschlossenen Ticket mit Label `rat`
  eine Zeile: Entscheidung und Grund.
- **Bau-Agenten:** ihre Entscheidungen aus gemergten PRs, nur die von Gewicht: was der Auftraggeber
  sieht oder spürt, und was als vorläufig markiert ist.
- **Gebaut:** geschlossene Tickets, je Vorhaben eine Zeile.
- **Wartet:** offene Tickets mit `blocked:mensch` oder Status `Wartet auf Mensch`, zuerst was auf
  ihn wartet; dazu, was als „wird abgebaut“ markiert ist.

Je Punkt eine Zeile mit Ticket-Nummer, in der Sprache des Auftraggebers, ohne Fachwörter, mit dem,
was es für ihn bedeutet („Ab jetzt …“). Keine Einzelheiten; fragt er nach, erklärst du am Ticket.

## Widerspruch
Widerspricht der Auftraggeber einem Punkt, klärst du nach `befragung.md`, was gelten soll. Dann:
1. **Umbau-Ticket** mit dem neuen Ziel und Verweis auf die Entscheidung; war es eine Entscheidung,
   die ein Muster ändert, gilt dafür `.claude/skills/rat/weichenstellung.md`.
2. **Gilt es über den Einzelfall hinaus,** formulierst du einen neuen oder geschärften Grundsatz
   und legst ihn als Ticket im fleet-Repo mit `needs:decision` dem Betreiber vor. Ändern darf ihn
   nur er (`.agents/fleet/grundsaetze.md`); bis dahin gilt die Antwort des Auftraggebers für sein
   Projekt.
