# Befragung

Teil des Planer-Skills: nachhaken, bis klar ist, was gemeint ist, nicht nur, was gesagt wurde. Die
Zielklärung (`zielklaerung.md`) nutzt sie, ebenso jede unklare Meldung: mehrdeutig, nach
Einzellösung klingend oder gegen einen Grundsatz.

## Vor jeder Frage
- **Nachsehen statt fragen:** Was Code, Tickets, ADRs (`docs/DECISIONS.md`), `docs/PRODUCT.md` oder
  die Leitlinien beantworten, siehst du nach (bei Bedarf mit Lese-Agenten) und nennst es als
  Feststellung.
- **Nur Absicht und Ob-Fragen.** Das Wie entscheidet das System nach
  `.agents/fleet/grundsaetze.md`; ein Wert ist eine Stellschraube und keine Frage.
- **Ast für Ast:** zuerst, was andere Antworten bestimmt, Abhängiges danach. Was eine Antwort
  überflüssig macht, fällt weg.

## Eine Frage
Eine Frage zur Zeit, in Alltagssprache, ohne Fachwörter, immer in dieser Form:
```
Frage: <ein Satz>
Wozu: <was von der Antwort abhängt, ein Satz>
Vorschlag: <empfohlene Antwort, vorausgewählt>
Andere: <höchstens drei Möglichkeiten>
Eigene Worte: <freies Feld>
```
Dieselbe Form trägt ein Formular: Vorschlag vorausgewählt, Möglichkeiten als Liste, ein freies Feld.
Jede Antwort hältst du sofort als Kommentar am Ticket fest.

## Nachhaken
- Ist eine Antwort vage oder mehrdeutig, fragst du mit zwei Beispielen nach („Meinst du A oder B?“).
- Nennt der Auftraggeber eine Lösung („ein Knopf, der …“), fragst du nach dem Zweck dahinter.
- Ist es ein Einzelfall, schlägst du den allgemeinen Mechanismus vor; das Beispiel wird ein Testfall.
- Widerspricht eine Antwort einer früheren oder einem Grundsatz, nennst du den Widerspruch und fragst,
  was gelten soll.

## Ende
Die Befragung endet, sobald eines zutrifft:
- Du spiegelst die Absicht in wenigen eigenen Sätzen samt Mechanismus, und der Auftraggeber stimmt
  zu. Das ist der Normalfall.
- Was offen ist, lässt sich nachsehen oder ist ein Wie.
- Zwei Nachfragen zum selben Punkt bringen nichts Neues, oder der Auftraggeber bricht ab: Der
  Vorschlag gilt als vorläufig und steht so im Ticket; hängt Unumkehrbares daran, wird er eine
  Ob-Frage mit `needs:decision`. Gearbeitet wird am Rest.
