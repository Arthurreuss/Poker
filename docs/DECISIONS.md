# Entscheidungen

Format: Kontext → Entscheidung → Konsequenzen. Status: `akzeptiert`, `offen`, `ersetzt durch D-00X`.

## D-001: Nur Spielgeld
- **Status:** akzeptiert
- **Kontext:** Online-Poker um Echtgeld ist in Deutschland lizenzpflichtig (GlüStV).
- **Entscheidung:** Chips haben keinen Geldwert. Kein Kauf, kein Auszahlen, kein Tausch gegen Geld.
- **Konsequenzen:** Keine Payment-Integration. Chip-Nachschub erfolgt über Regeln im Spiel (z. B. Rebuy auf Startstack).

## D-002: Lokaler Betrieb mit Docker
- **Status:** akzeptiert
- **Kontext:** Läuft auf dem eigenen Mac, soll reproduzierbar starten.
- **Entscheidung:** Alle Dienste laufen per `docker compose`. Öffentliche Erreichbarkeit von `main` über Cloudflare Tunnel ist ein späteres, eigenes WP (Branches: D-005, Ports: D-006).
- **Konsequenzen:** Entwicklung und Betrieb nutzen dieselben Images; Datenbank liegt in einem Docker-Volume.

## D-003: Server ist autoritativ
- **Status:** akzeptiert
- **Kontext:** Spieler dürfen keine fremden Karten sehen oder Aktionen fälschen können.
- **Entscheidung:** Nur der Server mischt, verwaltet den Spielzustand und validiert jede Aktion. Clients erhalten nur ihre eigenen Karten und den öffentlichen Zustand.
- **Konsequenzen:** Poker-Logik lebt im Server bzw. einem geteilten, reinen Logik-Paket; der Client ist reine Darstellung.

## D-004: Tech-Stack
- **Status:** offen
- **Kontext:** Vorschlag: TypeScript überall, Node.js + WebSockets im Server, React oder Svelte als mobile PWA, SQLite zum Start.
- **Entscheidung:** _wird in der Arbeitspaket-Planung festgelegt_
- **Konsequenzen:** —

## D-005: Zwei Branches – dev und main
- **Status:** akzeptiert
- **Kontext:** Es soll eine stabile, öffentlich erreichbare Version geben und eine Version zum lokalen Testen.
- **Entscheidung:** `dev` ist der Arbeitsbranch und wird lokal unter localhost getestet. `main` ist die Release-Version und wird später über Cloudflare Tunnel gehostet. Änderungen kommen nur per Merge `dev → main` auf main, nie per direktem Commit (der Pre-Commit-Hook blockiert das).
- **Konsequenzen:** Vor jedem Merge auf main muss `npm run check` auf dev grün sein und dev lokal per Docker getestet worden sein. Dev und Prod laufen als getrennte Compose-Projekte (`poker-dev`, `poker-prod`) mit getrennten Datenbanken.

## D-006: Eigener Port-Bereich 4310–4329
- **Status:** akzeptiert
- **Kontext:** Auf dem Mac laufen bereits andere Docker-Projekte (u. a. 5173, 5432, 8000, 8080, 5000, 7000, 8790/8791, 11434 belegt).
- **Entscheidung:** Poker nutzt nur Ports aus 4310–4329, gebunden an `127.0.0.1`:

  | Umgebung | Web (Frontend) | Game-Server (HTTP/WS) | Datenbank |
  |---|---|---|---|
  | dev (localhost) | 4310 | 4311 | 4312 (nur falls extern nötig) |
  | prod (main, Cloudflare) | 4320 | 4321 | nicht nach außen |

- **Konsequenzen:** Ports stehen in `.env`-Dateien bzw. Compose-Files, nicht hart im Code. Neue Ports nur aus diesem Bereich und nach Eintrag hier. Prod ist nur über den Tunnel öffentlich erreichbar, nie über eine offene Portfreigabe.
