# Zielklärung

Teil des Planer-Skills: Aus einer Vision werden ein Vertrag und eine abgesegnete Architektur. Sie
gilt für ein neues Vorhaben, den ersten Auftrag eines neuen Projekts, eine Zieländerung und einen
Wechsel des Anspruchs. Kleine Dinge (klarer Fehler, Aufräumen) werden ohne sie direkt ein Ticket.
Vor der abgesegneten Architektur wird nichts gebaut.

Gefragt wird nach `befragung.md`: eine Frage zur Zeit, in der Sprache des Auftraggebers, je Frage
ein empfohlener Vorschlag („üblich ist …, passt das?“). Der Auftraggeber braucht keinen
Entwickler-Hintergrund; Technik, Pakete und Werte fragst du nie.

## Runden von oben
1. **Vision und Anspruch:** wozu, für wen, was ist danach besser, was gehört nicht dazu. Dann der
   Anspruch (unten).
2. **Abläufe:** was die Nutzer Schritt für Schritt tun, je Art von Nutzer (Nutzerpfade), vom ersten
   Aufruf bis zum Ergebnis.
3. **Einzelheiten je Ablauf,** so tief wie nötig: Regeln, Ausnahmen, welche Daten, wer was sieht,
   was bei Fehlern geschieht.

Nach jeder Runde spiegelst du in wenigen Sätzen, was du verstanden hast, und fragst nach Zustimmung,
dann eine Ebene tiefer. Die Runden enden, wenn jeder Nutzerpfad von Anfang bis Ende und das System
als Ganzes (welche Teile, welche Daten, wer darf was) ersichtlich sind und der Auftraggeber dem
Spiegel zustimmt.

## Anspruch
Frage in seiner Sprache, mit Vorschlag aus „für wen“: „Soll es erst zeigen, ob die Idee trägt
(Prototyp), willst du es selbst dauerhaft nutzen (Werkzeug), oder sollen andere es nutzen
(Produkt)?“ Je Bereich darf er abweichen. Was jede Stufe bedeutet, steht in
`.agents/fleet/anspruch.md`. Der Auftraggeber kann den Anspruch jederzeit wechseln; das ist eine
neue Fassung (unten).

## Abnahme-Kriterien
Die Kriterien leitest du selbst ab, der Auftraggeber wird dazu nicht gefragt:
- **aus den Nutzerpfaden:** je Pfad mindestens ein Kriterium, das ihn Ende zu Ende belegt;
- **Stand der Technik:** recherchieren, was Nutzer bei dieser Art Funktion erwarten, mit Quellen;
  beim Produkt ganz, sonst nur für den Hauptpfad;
- **Stufe und Kataloge:** die Zeilen der Tabelle „Was die Stufe bestimmt“ und die Katalog-Punkte
  bis zur gewählten Stufe aus `.agents/fleet/anspruch.md`, nur was zum Vorhaben passt (ohne
  Personendaten kein Datenschutz); Weggelassenes mit Grund in einer Zeile;
- **Pragmatismus:** nur prüfbare Kriterien, jedes mit der Prüfung, die es belegt; nichts auf Vorrat.

Über die Auswahl aus den Katalogen entscheidet der Rat: Du legst sie als Rats-Ticket vor
(`.claude/skills/rat/SKILL.md` „Wie eine Frage ankommt“), nicht dem Auftraggeber.

## Architektur
Aus Nutzerpfaden und Anspruch entwirfst du die Architektur: Art und Stapel nach
`.agents/fleet/baukasten.md`, Bausteine, Daten (wem gehört was), Schnittstellen nach außen. Jede
Weichenstellung darin (`.agents/fleet/grundsaetze.md` „Wer entscheidet was“) geht über den Rat.

Der Auftraggeber segnet sie einmal ab, in verständlicher Form: woraus das System besteht, was es
bewusst nicht kann, was später teuer zu ändern wäre. Einen Stapel des Baukastens zu verlassen, legst
du ihm als Ob-Frage vor. Seine Zustimmung steht als Kommentar am Leit-Ticket. Danach geht an ihn nur
noch: neue Ideen, Ob-Fragen und was „Wer entscheidet was“ beim Auftraggeber nennt.

## Ablage
| Was | Wo |
|---|---|
| Vision, Nutzerpfade, Anspruch je Bereich | `docs/PRODUCT.md` |
| Architektur mit Datei-Verfassung | `.agents/rules/architektur.md` |
| Verträge: Leit-Ticket mit Meilensteinen, je Baueinheit ein Ticket | Tickets nach `.agents/fleet/arbeitsweise.md` „Tickets“ |
| Dauerhafte Festlegungen | ADRs über `docs/DECISIONS.md` |

Beide Dateien schreibt ein Bau-Ticket aus deinem Text; Plan- oder Vertragsdateien gibt es nicht. Ist
ein Ticket bereit, weckst du den Orchestrierer.

## Neue Fassung
Ändert sich das Ziel oder wechselt der Anspruch, ist das eine neue Fassung:
1. Ab der Runde, die sich ändert, neu fragen; Früheres bleibt, soweit es gilt.
2. Dem Auftraggeber den Unterschied zeigen: welche Kriterien dazukommen, wegfallen oder sich ändern,
   welche gebauten Teile betroffen sind. Berührt sie die Architektur, prüft der Rat sie, und der
   Auftraggeber segnet die Änderung ab.
3. Leit-Ticket und `docs/PRODUCT.md` auf die neue Fassung bringen; je betroffenem Teil ein
   Umbau-Ticket. Was die neue Fassung ersetzt, wird vollständig abgebaut.

Beim Wechsel des Anspruchs gilt dazu `.agents/fleet/anspruch.md` „Wechsel der Stufe“.
