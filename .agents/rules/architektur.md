---
trigger: always_on
description: Abgesegnete Architektur des Projekts poker: Bausteine, Daten, Schnittstellen, Datei-Verfassung.
---
# Architektur

Bestand vor der Anbindung an fleet, abgesegnet über die Entscheidungen D-001 bis D-039
(`docs/DECISIONS.md`); im Einzelnen `docs/ARCHITECTURE.md`, nur den betroffenen Abschnitt lesen.
Jeder Bau sortiert sich hier ein; was nicht hineinpasst, ist eine Weichenstellung
(`.agents/fleet/grundsaetze.md` „Wer entscheidet was“).

## Bausteine
- `packages/engine` (`@poker/engine`): reine Poker-Logik und Protokoll-Typen, ohne I/O, Uhr und
  unkontrollierten Zufall; Server und Frontend nutzen sie („Engine: …“ in `docs/ARCHITECTURE.md`).
- `apps/server` (`@poker/server`): Node-Server mit HTTP-API und WebSocket; hält alle Tische in einem
  Prozess (D-039), Konten, Hand-Historie, Admin („Game-Server: Protokoll und Tische“, „Auth“).
- `apps/web` (`@poker/web`): React-PWA für Handy hoch und quer („Frontend“).
- Postgres mit eigenem Migrations-Runner (`apps/server/migrations`, D-015).

## Daten
Konten, Sitzungen, Runden, Hände, Punkte, Feedback und Admin-Protokoll in Postgres („Datenmodell“).
Nur Spielgeld (D-001). Die Daten gehören den Spielern; Löschen des Kontos ist möglich.

## Schnittstellen nach außen
Eine Origin je Domain (D-014): statische Dateien, `/api/*` und `/ws` hinter nginx, öffentlich über
den eigenen Cloudflare-Tunnel unter poker.arthur-reuss.de und poker.deinemudda.win. Keine fremden
Dienste zur Laufzeit.

## Bewusst nicht
Echtgeld, Kauf oder Auszahlung (D-001), Passwort-Reset per Mail (D-011), Chat.

## Teuer zu ändern
Server als Autorität, Client nur Darstellung (D-003); Tische in einem Prozess (D-039); das
WebSocket-Protokoll zwischen Engine, Server und Web.

## Datei-Verfassung
npm-Workspaces wie oben: Die Engine liegt unten und importiert weder Server noch Frontend; Server
und Frontend kennen sich nicht (gemeinsam nur `@poker/engine`). Der Wächter
`scripts/check_struktur.py` prüft das nach `scripts/struktur.toml`, ESLint die Reinheit der Engine.
