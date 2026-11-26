---
trigger: always_on
description: Standard-Stapel und Struktur je Art von Vorhaben (Website, Web-Anwendung, iPhone-App, Werkzeug).
---
# Baukasten

Je Art von Vorhaben ein Standard-Stapel aus großen, gepflegten Rahmenwerken mit festen Schichten und
fester Ordner-Struktur. Die Stapel sind ein Vorschlag des Betreibers, den der Rat mit Recherche
bestätigt.

| Art | Wofür | Stapel | Struktur und Betrieb |
|---|---|---|---|
| Website | Seiten mit Inhalt, kein eigenes Konto, keine eigene Datenhaltung | Nuxt mit Vue und TypeScript, statisch erzeugt (`nuxt generate`), Mehrsprachigkeit über das i18n-Modul, Inhalte als Dateien im Repo | Ordner Seiten, Bausteine, Inhalte, Layouts; statisch über Cloudflare ausgeliefert, kein Dienst im Verbund; Prüfung: Typen, Bauen, Verweise, Barrierefreiheit |
| Web-Anwendung | Anwendung mit Anmeldung und Daten, zuerst im Verbund gehostet | FastAPI, Postgres mit Alembic, React, pytest und Playwright | Schichten und Datei-Verfassung im Architektur-Dokument des Projekts; Docker Compose in der Prod-VM; Prüfung, Zug und Deploy über fleet |
| iPhone-App | App aus dem App Store oder über TestFlight | nativ mit Swift und SwiftUI, Zustand über `@Observable`, Navigation über NavigationStack, Daten auf dem Gerät mit SwiftData, Nebenläufigkeit der Sprache statt GCD, Tests mit Swift Testing | Schichten Ansicht, Zustand, Dienste; Logik in Swift-Paketen, die ohne Simulator testbar sind; Bauen und Tests per `xcodebuild` auf einem Mac des Verbunds; Apple-Konto, Zertifikate und Einreichen sind Handarbeit des Betreibers |
| Werkzeug | Befehl für die Kommandozeile oder Dienst im Verbund | Python mit uv, Register in TOML | wie fleet: Schichten in einem Paket, kleine Dateien, Doku gegen Code geprüft |

- **iPhone-App:** Ist die App im Kern eine vorhandene Web-Anwendung, bekommt sie stattdessen eine
  Hülle mit Capacitor und Swift-Plugins. Braucht sie ein Konto oder Daten, ist ihr Server eine
  Web-Anwendung nach diesem Baukasten. Die Recherche zum Stapel stützt sich auf Blogs; Mindestversion
  und Einzelheiten werden gegen Apples Doku geprüft.
- Ein Vorhaben kann aus mehreren Arten bestehen (App mit Web-Anwendung als Server). Eine fünfte Art
  legt der Rat fest, wenn das erste Vorhaben sie braucht.

## Im Baukasten bleiben
Wer im Baukasten bleibt, muss nichts entscheiden. Eine Abhängigkeit, die nicht zum Stapel gehört,
braucht den Rat. Einen Stapel für ein Vorhaben zu verlassen, ist eine Abweichung von der Architektur
und geht an den Auftraggeber.
