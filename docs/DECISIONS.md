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
- **Status:** akzeptiert
- **Kontext:** Ein Team, eine Sprache, Spielzustand serverseitig, mobile Web-App.
- **Entscheidung:**
  - TypeScript überall, Node.js 22 LTS (`.nvmrc`, Docker-Image `node:22-alpine`)
  - npm-Workspaces-Monorepo: `packages/engine` (reine Poker-Logik, keine Abhängigkeiten zu I/O), `apps/server`, `apps/web`
  - Server: Fastify (HTTP) + `ws` (WebSocket)
  - Frontend: React + Vite als PWA
  - Datenbank: Postgres 16 (siehe D-010)
  - Tests: Vitest (Unit/Integration), Playwright (E2E)
  - Handbewertung: eigene Implementierung in `packages/engine`, vollständig getestet (keine untypisierte Fremdbibliothek im Kern)
- **Konsequenzen:** `npm run check` umfasst Typecheck, Lint, Tests aller Workspaces und den Doku-Check.

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

## D-007: 9 Plätze pro Tisch
- **Status:** akzeptiert
- **Kontext:** 10 Plätze sind auf dem Handy im Hochformat zu eng.
- **Entscheidung:** 2–9 Spieler pro Tisch.
- **Konsequenzen:** Layouts für Hoch- und Querformat sind für bis zu 9 Sitze ausgelegt.

## D-008: Design im Stil von PokerStars, eigene Assets
- **Status:** akzeptiert
- **Kontext:** Vorbild ist PokerStars. Grafiken, Logos, Kartendesigns und Sounds sind urheber- bzw. markenrechtlich geschützt.
- **Entscheidung:** Wir übernehmen die Anmutung (dunkler Hintergrund, grüner ovaler Tisch, klare Sitz-Plaketten mit Stack, große Aktionsbuttons unten, gut lesbare Karten), aber keine Originalassets, Logos, Namen oder Farbcodes 1:1. Karten und Chips sind eigene SVGs oder Assets unter freier Lizenz (Lizenz in `apps/web/ASSETS.md`).
- **Konsequenzen:** Kein „PokerStars“ in Namen, Texten oder Metadaten der App.

## D-009: Hoch- und Querformat, umschaltbar
- **Status:** akzeptiert
- **Kontext:** Gespielt wird vor allem am Handy, mal im Hoch-, mal im Querformat.
- **Entscheidung:** Die Tischansicht hat zwei Layouts. Standard folgt der Geräteausrichtung, der Spieler kann es in den Einstellungen fest auf Hoch oder Quer stellen (lokal gespeichert).
- **Konsequenzen:** Das Layout ist eine reine Darstellungsschicht über demselben Tischzustand; beide Layouts werden getestet.

## D-010: Postgres
- **Status:** akzeptiert
- **Kontext:** Persistenz für Accounts, Runden, Hand-Historie, Statistiken.
- **Entscheidung:** Postgres 16 im eigenen Container, getrennte Datenbanken/Volumes für dev und prod. Schema per versionierten SQL-Migrationen.
- **Konsequenzen:** Prod braucht automatische Backups (eigenes WP). Der Port der Dev-DB ist 4312 (D-006), die Prod-DB ist nicht nach außen offen.

## D-011: Offene Registrierung
- **Status:** akzeptiert
- **Kontext:** Jeder mit dem Link soll mitspielen können. main ist öffentlich erreichbar.
- **Entscheidung:** Registrierung mit Benutzername + Passwort, ohne Einladung. Passwörter mit argon2id, Login per httpOnly-Session-Cookie.
- **Konsequenzen:** Rate-Limits für Registrierung/Login, Benutzernamen-Validierung, keine E-Mail-Pflicht (dadurch kein Passwort-Reset per Mail im MVP – Reset über Admin).

## D-012: Spielformat Freezeout mit Punkten
- **Status:** akzeptiert
- **Kontext:** Chips sollen keinen Wert über eine Runde hinaus haben, jede Runde startet fair.
- **Entscheidung:**
  - No-Limit Texas Hold'em. Eine **Runde** = alle Spieler am Tisch starten mit demselben Startstack, gespielt wird, bis einer alle Chips hat.
  - Jeder Spieler kann einen Tisch erstellen (öffentlich in der Lobby oder privat per Link) und legt fest: Startstack, Blinds, Blind-Erhöhung (fest oder alle X Minuten steigend, Standard: steigend), Zeitlimit pro Zug.
  - Spieler setzen sich (2–9), der Ersteller startet. Danach kein Einstieg mehr, nur Zuschauen.
  - Wer nicht verbunden ist, wird automatisch gecheckt/gefoldet und zahlt weiter Blinds.
  - Punkte nach Platzierung: Bei n Spielern bekommt Platz k genau (n − k) Punkte, der Sieger zusätzlich 1 Bonuspunkt. Die Punktesumme pro Account ergibt die Rangliste. Formel lebt an einer zentralen Stelle in der Engine.
- **Konsequenzen:** Keine Chip-Konten, keine Rebuys. Es gibt kein klassisches Cash Game; „Cash Game“ im Sinne von jederzeitigem Ein-/Aussteigen ist bewusst nicht im MVP.

## D-013: Zeitlimit pro Tisch einstellbar
- **Status:** akzeptiert
- **Kontext:** Ein Spieler, der nicht reagiert, darf den Tisch nicht blockieren.
- **Entscheidung:** Standard 20 Sekunden pro Zug plus eine Zeitbank von 60 Sekunden pro Spieler und Runde. Beides beim Erstellen änderbar. Bei Ablauf: Check, wenn möglich, sonst Fold.
- **Konsequenzen:** Timer laufen ausschließlich auf dem Server; der Client zeigt nur die Restzeit an.

## D-014: Hosting von main unter poker.arthur-reuss.de
- **Status:** akzeptiert
- **Kontext:** main wird über Cloudflare veröffentlicht. Auf dem Mac läuft bereits ein Tunnel für ein anderes Projekt (Jarvis).
- **Entscheidung:** Poker bekommt einen **eigenen** Cloudflare-Tunnel mit eigenem `cloudflared`-Container im Compose-Projekt `poker-prod`. Hostname `poker.arthur-reuss.de` → Web-Container im internen Docker-Netz. Tunnel-Token nur in `.env.prod` (nicht im Git).
- **Konsequenzen:** Damit alles von Anfang an tunnel-tauglich ist, gilt für jeden Code:
  - Eine Origin: Web, API (`/api`) und WebSocket (`/ws`) laufen unter demselben Host; der Client nutzt nur relative URLs und leitet `ws:`/`wss:` aus `location` ab.
  - Kein Hostname, keine Ports hart im Code – alles über Umgebungsvariablen.
  - Server vertraut Proxy-Headern (`CF-Connecting-IP`, `X-Forwarded-Proto`) nur in prod; Cookies in prod `Secure`.
  - WebSocket-Heartbeat alle 30 s (Cloudflare trennt idle Verbindungen nach 100 s); Client reconnectet automatisch.
  - `GET /api/health` für Healthchecks.
  - WebSocket-Upgrade prüft den `Origin`-Header gegen `PUBLIC_ORIGIN`.

## D-015: Eigener SQL-Migrations-Runner, `integer` für Chips und Punkte
- **Status:** akzeptiert
- **Kontext:** WP-009 brauchte ein Migrationswerkzeug und Zahlentypen für Chips/Punkte.
- **Entscheidung:** Kleiner eigener Runner (`apps/server/src/db/migrate.ts`): reine SQL-Dateien `NNNN_name.sql`, Tabelle `schema_migrations` mit SHA-256-Checksumme, `pg_advisory_lock` gegen parallele Starts, eine Transaktion pro Migration, Abbruch bei geänderter oder fehlender Migration. Angewendete Migrationen werden nie geändert, nur durch neue ergänzt. IDs, Chips und Punkte sind `integer` (pg liefert sie als JS-Zahl), Startstack ist auf 10⁸ begrenzt.
- **Konsequenzen:** Keine ORM-/Migrations-Abhängigkeit. Das Prod-Image muss `apps/server/migrations/` enthalten.
