---
trigger: always_on
description: Anspruch eines Vorhabens (Prototyp, Werkzeug, Produkt), was auf welcher Stufe dazugehört, und die Kataloge (Sicherheit, Datenschutz, KI-Verordnung, Barrierefreiheit, Betrieb, Mandanten).
---
# Anspruch

Jedes Vorhaben hat einen Anspruch; er wird in der Zielklärung zuerst gewählt und steht im Vertrag.
Er gilt je Vorhaben und kann je Teil abweichen (etwa Produkt, aber die Auswertung erst als
Prototyp); auch das steht im Vertrag.
- **Prototyp:** zeigt, ob die Idee trägt; nur das Nötigste.
- **Werkzeug:** für den eigenen Gebrauch, dauerhaft; sauber, aber ohne Ausbau für Fremde.
- **Produkt:** für andere Nutzer; alle Standard-Funktionen und alle Kataloge.

## Auf jeder Stufe gleich
Der Anspruch spart Umfang, nie Struktur. Immer gelten: abgesegnete Architektur und Schichten,
Datei-Verfassung mit Wächtern, Ordnung, Tests für alles Gebaute, Einstellungen statt fester Zahlen,
Eigentümer an jedem Datensatz, keine Geheimnisse im Repo, ADR für jede dauerhafte Festlegung.

## Was die Stufe bestimmt
Die Stufe bestimmt nur, wie viel gebaut wird. „dazu“ heißt: zusätzlich zur Stufe links.

| Thema | Prototyp | Werkzeug | Produkt |
|---|---|---|---|
| Funktionen | nur der Hauptpfad je Ablauf | alle Abläufe des Vertrags | dazu alles, was Nutzer bei dieser Art Funktion üblich erwarten (Recherche) |
| Anmeldung | keine oder eine feste | Anmeldung des Eigentümers über einen fertigen Baustein | vollständig: Registrierung, Zugang wiederherstellen, Schutz gegen Durchprobieren, Sitzungen verwalten, zweiter Faktor |
| Nutzer | einer | einer oder wenige bekannte | Mandanten, Rollen, Rechte |
| Tests | Hauptpfade | dazu Fehlerfälle und je Ablauf ein Test durch die Oberfläche | dazu jeder Nutzerpfad Ende zu Ende, Barrierefreiheit, Last nach Freigabe |
| Fehler | sichtbar, nie still geschluckt | verständliche Meldung, Wiederholung, Protokoll | dazu Überwachung, Alarm, Rückfallweg |
| Daten | keine echten Daten Dritter | eigene Daten, gesichert | Katalog Datenschutz ganz |
| KI-Verordnung | entfällt | KI-erzeugte Inhalte erkennbar | Katalog ganz |
| Sicherheit | Schutz des Rahmenwerks eingeschaltet, Eingaben geprüft | dazu Zugang nur für den Eigentümer, nichts offen im Netz | Katalog ganz, Sicherheitsprüfung vor dem Ausrollen |
| Betrieb | läuft in der Entwicklung, kein Prod | Prod im Verbund mit Sicherung und Health-Prüfung | dazu Rücksicherungs-Test, Alarme, Rückweg je Ausrollen |
| Barrierefreiheit | saubere Struktur der Seiten | Kontrast und Tastatur | WCAG AA geprüft |
| Doku | README, ADRs | dazu Betrieb | dazu Hilfe für Nutzer und Rechtstexte |

## Prüfung durch einen Menschen beim Produkt
Beim Anspruch Produkt prüft vor dem endgültigen Ausrollen an fremde Nutzer ein Mensch Recht und
Datenschutz. Der Rat bereitet die Prüfung vor, ersetzt sie aber nicht. Sie ist ein Ticket; ohne
dessen Haken ist das Ausrollen gesperrt.

## Wechsel der Stufe
Ein Wechsel (erst Prototyp, dann Produkt) ist eine neue Fassung des Vertrags: Die Zielklärung ergänzt
die Kriterien und Kataloge der höheren Stufe, der Rat prüft die Architektur dagegen, die Zeilen dieser
Tabelle werden Ausbau-Tickets. Weil die Struktur auf jeder Stufe dieselbe ist, bleibt das ein Ausbau
und kein Neubau.

## Kataloge
Prüflisten, keine Rechtsberatung. Die Zielklärung zieht je Vorhaben die Punkte bis zur gewählten
Stufe als Kriterien in den Vertrag, nur was passt; über die Auswahl entscheidet der Rat. „ab“ ist
die niedrigste Stufe, auf der ein Punkt gilt. Fristen und Rechtslage ändern sich: Der Sitz Recht
recherchiert den aktuellen Stand, statt sich auf diese Listen zu verlassen. Ob ein Gesetz das
Vorhaben überhaupt trifft, klärt beim Produkt die Prüfung durch einen Menschen (oben). Eigene
Kataloge (etwa für Gesundheitsdaten) ergänzt ein Projekt in `.agents/project.md`. Stand der Quellen:
November 2026.

### Sicherheit
| Punkt | ab | Prüfung | Quelle |
|---|---|---|---|
| Schutz des Rahmenwerks an (Ausgabe-Kodierung, CSRF, sichere Cookies), Eingaben am Rand geprüft | Prototyp | Test je Eingang mit ungültiger Eingabe | ASVS 5.0 L1: Encoding and Sanitization, Validation and Business Logic |
| Abhängigkeiten ohne bekannte Lücken, keine Geheimnisse im Repo | Prototyp | Abhängigkeits- und Geheimnis-Scan in der Prüfung | ASVS 5.0: Secure Coding and Architecture |
| Nichts offen im Netz: jeder Aufruf angemeldet, nur TLS | Werkzeug | Test: Aufruf ohne Anmeldung wird abgewiesen | ASVS 5.0 L1: Authentication, Secure Communication |
| Rechte serverseitig je Anfrage, Vorgabe „verweigern“ | Werkzeug | Test: fremder Datensatz wird abgewiesen | ASVS 5.0 L1: Authorization; OWASP Top 10 A01 |
| Anmeldung vollständig: Schutz gegen Durchprobieren, zweiter Faktor, Passwörter gegen bekannte Lecks geprüft, Sitzungen beenden | Produkt | Test je Fall | ASVS 5.0 L2: Authentication, Session Management; NIST SP 800-63B |
| Sicherheits-Protokoll (Anmeldung, abgewiesene Rechte, Admin-Aktionen) ohne Geheimnisse | Produkt | Test liest den Eintrag | ASVS 5.0 L2: Security Logging and Error Handling |
| Sicherheitsprüfung gegen ASVS L2 vor dem Ausrollen, Befunde als Tickets | Produkt | Ticket mit Prüfbericht | ASVS 5.0 L2 |
| Software beim Nutzer (App): Meldeweg für Schwachstellen, Sicherheits-Updates über die Lebensdauer | Produkt | Meldeadresse veröffentlicht, Ablauf in der Betriebs-Doku | Cyber Resilience Act, VO (EU) 2024/2847 Art. 13, 14: Meldepflicht seit 11.09.2026, übrige Pflichten ab 11.12.2027 |

### Datenschutz
Gilt, sobald personenbezogene Daten verarbeitet werden; Quelle ist die DSGVO, wo nichts anderes steht.

| Punkt | ab | Prüfung | Quelle |
|---|---|---|---|
| Keine echten Daten Dritter ohne Rechtsgrundlage | Prototyp | Testdaten sind erfunden | Art. 6 |
| Datenminimierung: je Feld ein Zweck, nichts auf Vorrat, Voreinstellungen datensparsam | Werkzeug | Zweck je Feld im Datenmodell | Art. 5 Abs. 1 c, Art. 25 |
| Speicherdauer je Datenart, Löschen nach Frist automatisch | Produkt | Test des Löschlaufs | Art. 5 Abs. 1 e |
| Nutzer können ihre Daten abrufen, exportieren, berichtigen und das Konto samt Daten löschen | Produkt | Test Ende zu Ende | Art. 15–17, 20 |
| Datenschutzerklärung und Impressum | Produkt | Seiten vorhanden, Prüfung durch einen Menschen | Art. 13; § 5 DDG |
| Einwilligung vor allem, was im Endgerät gespeichert oder gelesen wird und nicht nötig ist | Produkt | Test: ohne Einwilligung nichts davon | § 25 TDDDG; Art. 7 |
| Verzeichnis der Verarbeitungen, Vertrag mit jedem Auftragsverarbeiter, Übermittlung in Drittländer geprüft | Produkt | Ticket für den Menschen | Art. 28, 30, 44 ff. |
| Ablauf bei Datenpanne: Meldung binnen 72 Stunden, Betroffene informieren | Produkt | Ablauf in der Betriebs-Doku | Art. 33, 34 |
| Gesundheits- oder andere besondere Daten, hohes Risiko: Folgenabschätzung vor dem Ausrollen | Produkt | Ticket für den Menschen | Art. 9, 35 |

### KI-Verordnung
Gilt, wenn das Vorhaben ein KI-System anbietet oder betreibt. Quelle: VO (EU) 2024/1689 in der
Fassung der VO (EU) 2026/1744 (Digital-Omnibus), Fristen nach Art. 111 und 113.

| Punkt | ab | Prüfung | Quelle |
|---|---|---|---|
| Keine verbotene Praxis (Manipulation, Ausnutzen von Schwächen, Bewertung sozialen Verhaltens, Emotionserkennung am Arbeitsplatz und in der Bildung u. a.) | Prototyp | Rat prüft in der Zielklärung | Art. 5, seit 02.02.2025; neue Verbote (intime Bilder ohne Einwilligung, Missbrauchsdarstellungen) ab 02.12.2026 |
| KI-erzeugte Inhalte für den Nutzer erkennbar | Werkzeug | Test: Kennzeichnung sichtbar | Art. 50 |
| Nutzer erfahren, dass sie mit einer KI sprechen, wo es nicht offensichtlich ist | Produkt | Test Ende zu Ende | Art. 50 Abs. 1, seit 02.08.2026 |
| Erzeugte Texte, Bilder, Töne, Videos maschinenlesbar gekennzeichnet | Produkt | Test liest die Kennzeichnung | Art. 50 Abs. 2, seit 02.08.2026; Systeme von vorher bis 02.12.2026 |
| Täuschend echte Bilder, Töne, Videos und KI-Texte zu öffentlichen Angelegenheiten offengelegt | Produkt | Test: Hinweis sichtbar | Art. 50 Abs. 4 |
| Keine allein automatisierte Entscheidung mit rechtlicher oder ähnlich erheblicher Wirkung | Produkt | Rat prüft in der Zielklärung | Art. 22 DSGVO |
| Einordnung als Hochrisiko geprüft (Anhang III: Bildung, Beschäftigung, Kredit, wesentliche Dienste u. a.); wenn ja, Ob-Frage an den Auftraggeber | Produkt | Rats-Ticket mit Einordnung | Art. 6, Anhang III; Pflichten ab 02.12.2027 |

### Barrierefreiheit
| Punkt | ab | Prüfung | Quelle |
|---|---|---|---|
| Struktur: Überschriften, Beschriftungen, Rollen, Sprache der Seite | Prototyp | automatischer Prüfer (etwa axe) ohne Befund | WCAG 2.2: 1.3.1, 2.4.6, 3.1.1, 4.1.2 |
| Kontrast: Text 4,5:1, Bedienelemente 3:1 | Werkzeug | automatischer Prüfer | WCAG 2.2: 1.4.3, 1.4.11 |
| Alles per Tastatur, Fokus sichtbar, keine Falle | Werkzeug | Test nur mit Tastatur | WCAG 2.2: 2.1.1, 2.1.2, 2.4.7 |
| WCAG 2.2 AA ganz: Prüfer in jedem Test Ende zu Ende, dazu je Nutzerpfad von Hand mit Bildschirmleser und 200 % Zoom | Produkt | Prüfbericht je Nutzerpfad | WCAG 2.2 AA; EN 301 549 |
| App: Beschriftungen für VoiceOver, Schriftgröße des Systems | Produkt | Prüfung der Bedienhilfen im UI-Test | EN 301 549 Kap. 11 |
| Dienst für Verbraucher: Anforderungen und Erklärung zur Barrierefreiheit, wenn kein Kleinstunternehmen | Produkt | Prüfung durch einen Menschen | BFSG, seit 28.06.2025; Ausnahme § 3 Abs. 3 |

### Betrieb
| Punkt | ab | Prüfung | Quelle |
|---|---|---|---|
| Health-Prüfung je Dienst, in der Überwachung des Verbunds eingetragen | Werkzeug | Test der Health-Route, Eintrag in fleet | Google SRE Book: Monitoring Distributed Systems |
| Sicherung täglich, verschlüsselt, auf anderer Maschine; Alarm, wenn sie zu alt ist | Werkzeug | Alarm-Regel mit Test | BSI IT-Grundschutz CON.3 |
| Rücksicherung im Takt geprobt | Produkt | `scripts/restore_test.sh` grün | BSI IT-Grundschutz CON.3 |
| Alarme auf Latenz, Verkehr, Fehler, Auslastung; Schwellen als Stellschrauben | Produkt | Alarm-Regel je Dienst mit Test | Google SRE Book: die vier goldenen Signale |
| Rückweg je Ausrollen: vorige Version per Befehl, Migrationen verträglich mit der Vorversion | Produkt | Zurückrollen in der Probe | `scripts/deploy_job.sh`; Google SRE Book: Release Engineering |
| Protokolle mit Aufbewahrungsfrist, ohne Personendaten im Klartext | Produkt | Test liest einen Eintrag | BSI IT-Grundschutz OPS.1.1.5; Art. 5 DSGVO |

### Mandantenfähigkeit
| Punkt | ab | Prüfung | Quelle |
|---|---|---|---|
| Jeder Datensatz hat einen Eigentümer (Nutzer, Mandant) | Prototyp | Test: Modell ohne Eigentümer wird rot | „Auf jeder Stufe gleich“ (oben); Grundsatz 4 in `grundsaetze.md` |
| Stellschrauben mit Vorgabe, je Nutzer oder Mandant überschreibbar | Werkzeug | Test: Überschreiben wirkt nur für den einen | `grundsaetze.md` „Stellschrauben“ |
| Filter nach Mandant an einer Stelle der Datenschicht, nicht je Endpunkt | Produkt | Test je Endpunkt: Mandant A sieht und ändert nichts von B | ASVS 5.0 L2: Authorization; OWASP Top 10 A01 |
| Getrennt nach Mandant auch Dateien, Caches, Suche, Warteschlangen, Protokolle | Produkt | Test je Speicher | Microsoft Azure Architecture Center: Multitenant-Lösungen |
| Rollen und Rechte je Mandant; der Admin des Mandanten verwaltet seine Nutzer | Produkt | Test Ende zu Ende | ASVS 5.0: Authorization |
| Mandant exportieren und vollständig löschen | Produkt | Test Ende zu Ende | Art. 17, 20 DSGVO |

### Quellen
- OWASP ASVS 5.0: https://github.com/OWASP/ASVS – OWASP Top 10: https://owasp.org/Top10/
- NIST SP 800-63B: https://pages.nist.gov/800-63-4/sp800-63b.html
- DSGVO: https://eur-lex.europa.eu/eli/reg/2016/679/oj – TDDDG: https://www.gesetze-im-internet.de/ttdsg/ – DDG: https://www.gesetze-im-internet.de/ddg/
- KI-Verordnung: https://eur-lex.europa.eu/eli/reg/2024/1689/oj – Digital-Omnibus und Fristen: https://artificialintelligenceact.eu/ai-act-explorer/digital-omnibus/
- Cyber Resilience Act: https://eur-lex.europa.eu/eli/reg/2024/2847/oj
- WCAG 2.2: https://www.w3.org/TR/WCAG22/ – EN 301 549: https://www.etsi.org/deliver/etsi_en/301500_301599/301549/ – BFSG: https://www.gesetze-im-internet.de/bfsg/
- BSI IT-Grundschutz-Kompendium: https://www.bsi.bund.de/grundschutz – Google SRE Book: https://sre.google/sre-book/table-of-contents/
- Mandanten: https://learn.microsoft.com/azure/architecture/guide/multitenant/overview
