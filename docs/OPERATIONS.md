# Betrieb

Wie dev und prod gestartet, gestoppt und released werden, wie der Cloudflare-Tunnel eingerichtet wird, Backup, Restore, Status, Betrieb nach Neustart und die Security-Checkliste. Aufbau der Umgebungen: [ARCHITECTURE.md](ARCHITECTURE.md); Begründungen: D-002, D-005, D-006, D-010, D-014, D-017 in [DECISIONS.md](DECISIONS.md).

| | dev | prod |
|---|---|---|
| Branch | `dev` | `main` |
| Ordner | Arbeitsordner `~/code/Arthurreuss/poker` | Prod-Worktree `~/code/Arthurreuss/poker-prod` (`POKER_PROD_DIR`) |
| Compose | `compose.dev.yml`, Projekt `poker-dev` | `compose.prod.yml`, Projekt `poker-prod` |
| Konfiguration | `.env` (optional, Vorlage `.env.example`) | `.env.prod` im Prod-Worktree (Pflicht, Vorlage `.env.prod.example`) |
| App | http://localhost:4310 | http://localhost:4320, öffentlich https://poker.arthur-reuss.de (Tunnel) |
| Server direkt | http://localhost:4311 | http://localhost:4321 (nur Debugging) |
| Datenbank | `localhost:4312`, Volume `poker-dev-db` | nicht nach außen, Volume `poker-prod-db` |
| Backups | – | täglich nach `BACKUP_DIR` (Standard `~/poker-backups`) |

Beide Umgebungen laufen gleichzeitig, ohne sich zu stören (eigene Projekte, Netze, Volumes, Ports). Alle Befehle nur über die npm-Skripte – sie fassen ausschließlich `poker-dev` bzw. `poker-prod` an, nie andere Container (z. B. Jarvis).

## dev
```sh
npm run dev:up     # bauen und starten (Hot-Reload)
npm run dev:logs   # Logs folgen
npm run dev:down   # stoppen, Volume poker-dev-db bleibt
```
Details: [README.md](../README.md#entwicklung-starten).

## prod
prod läuft aus einem **eigenen, dauerhaften Git-Worktree auf `main`** (D-017), nicht aus dem Arbeitsordner. Der Arbeitsordner (`~/code/Arthurreuss/poker`) bleibt immer auf `dev`; der Prod-Worktree liegt standardmäßig daneben in `~/code/Arthurreuss/poker-prod` (anderer Pfad: Umgebungsvariable `POKER_PROD_DIR`, absolut). Dort wird nie von Hand gearbeitet – er ändert sich nur durch `npm run release`.

### Prod-Worktree einrichten (Arthur, einmalig)
```sh
npm run prod:setup   # legt ~/code/Arthurreuss/poker-prod an (git worktree add … main), falls nicht vorhanden
```
Danach `.env.prod` **im Prod-Worktree** anlegen (gitignored, nie committen). Liegt schon eine `.env.prod` im Arbeitsordner, wird sie dorthin verschoben (`prod:setup` zeigt den genauen Befehl):
```sh
cp .env.prod.example ~/code/Arthurreuss/poker-prod/.env.prod
# POSTGRES_PASSWORD setzen, z. B. Ausgabe von: openssl rand -hex 24; optional BACKUP_DIR (Standard ~/poker-backups)
```
Solange `main` noch nicht released wurde, fehlt im Prod-Worktree `compose.prod.yml` – die prod-Befehle melden das; dann zuerst `npm run release`.

### Bedienung
Alle `prod:*`-Befehle werden im Arbeitsordner aufgerufen, arbeiten aber mit `compose.prod.yml` und `.env.prod` aus dem Prod-Worktree (fehlt er, kommt ein Hinweis auf `npm run prod:setup`):
```sh
npm run prod:up          # baut die Images aus dem Prod-Worktree (main) und startet db, server, web, backup (ohne Tunnel); wartet auf healthy
npm run prod:smoke       # Smoke-Test: /api/health und WebSocket (401 ohne Session, 403 fremde Origin) über http://localhost:4320
npm run prod:status      # Zustandsbericht (siehe Status)
npm run prod:logs        # Logs folgen
npm run prod:tunnel:up   # wie prod:up, zusätzlich cloudflared (braucht TUNNEL_TOKEN)
npm run prod:down        # alles stoppen inkl. cloudflared, Volume poker-prod-db und Backups bleiben
npm run prod:backup      # sofort ein Backup (siehe Backup)
npm run prod:restore -- <dump.sql.gz> [--yes]   # Restore (siehe Restore)
```
- Ohne `.env.prod` bricht `prod:up` mit Hinweis ab; `prod:tunnel:up` bricht ab, solange `TUNNEL_TOKEN` leer ist.
- Container haben `restart: unless-stopped`: nach einem Neustart von Docker Desktop laufen sie wieder, nach `prod:down` nicht (siehe [Betrieb nach Neustart](#betrieb-nach-neustart)).
- `POSTGRES_PASSWORD` wirkt nur beim **ersten** Start mit leerem Volume. Passwort später ändern = in Postgres ändern (`ALTER USER`) oder – nur ohne echte Daten – Volume löschen: `docker volume rm poker-prod-db`.
- Der Smoke-Test schickt als `Origin` den Wert von `PUBLIC_ORIGIN` aus `.env.prod`; andere Ziele per `SMOKE_URL=… SMOKE_ORIGIN=… npm run prod:smoke`.
- WebSocket ohne Session muss `401` liefern (seit WP-011 braucht `/ws` ein Session-Cookie), fremde Origin `403`. Den vollen Handshake (`hello` → `welcome`) prüft er zusätzlich mit einem Session-Cookie aus dem Browser: `SMOKE_COOKIE='poker_session=…' npm run prod:smoke`.

## Release
`npm run release` (Skript `scripts/release.sh`) – der Arbeitsordner wird dabei **nicht** umgeschaltet:
1. prüft: Arbeitsordner auf `dev` und sauber; Prod-Worktree vorhanden, auf `main`, ohne lokale Änderungen, mit `.env.prod`
2. `npm run check` im Arbeitsordner
3. Merge im Prod-Worktree: `git -C ~/code/Arthurreuss/poker-prod merge --no-ff dev` (Merge-Commit „Release: merge dev → main“; ein Merge löst den Pre-Commit-Hook nicht aus). Schlägt der Merge fehl, wird er abgebrochen und `main` bleibt unverändert.
4. `git push origin main dev`
5. prod aus dem Prod-Worktree neu bauen und starten: `prod:tunnel:up`, wenn `TUNNEL_TOKEN` gesetzt ist, sonst `prod:up`
6. `prod:smoke`

Vorher dev lokal per Docker getestet haben (D-005). Schlägt der Smoke-Test fehl, steht main schon auf dem neuen Stand: Fehler auf dev beheben und erneut releasen.

## Cloudflare-Tunnel einrichten (Arthur, einmalig)
Poker bekommt einen **eigenen** Tunnel mit eigenem `cloudflared`-Container im Projekt `poker-prod` (D-014). Der Jarvis-Tunnel und sein Container bleiben unberührt – nichts davon anfassen oder umkonfigurieren.

1. https://one.dash.cloudflare.com → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Typ **Cloudflared** wählen, Name `poker`, speichern.
3. Bei „Install and run a connector“ eine beliebige Umgebung (z. B. Docker) wählen und aus dem angezeigten Befehl **nur das Token** kopieren (die lange Zeichenkette nach `--token`). Den Befehl selbst **nicht** ausführen.
4. Token in `.env.prod` im Prod-Worktree eintragen: `TUNNEL_TOKEN=<token>` (die Datei ist gitignored; Token nirgends sonst ablegen).
5. Im Tunnel unter **Public Hostname** (bzw. „Published application routes“) → **Add**:
   - Subdomain `poker`, Domain `arthur-reuss.de`, Pfad leer
   - Service: Typ `HTTP`, URL `web:8080` (also `http://web:8080` – der Web-Container im Compose-Netz, nicht `localhost`)
6. Im Cloudflare-Dashboard der Domain `arthur-reuss.de` → **Network** → **WebSockets** muss **an** sein (Standard).
7. `PUBLIC_ORIGIN=https://poker.arthur-reuss.de` in `.env.prod` prüfen (exakt so, ohne Slash am Ende).
8. `npm run prod:tunnel:up`, dann `npm run prod:logs` – cloudflared meldet „Registered tunnel connection“; im Dashboard steht der Tunnel auf **Healthy**.
9. https://poker.arthur-reuss.de öffnen; Prüfen gegen die echte Domain: `SMOKE_URL=https://poker.arthur-reuss.de npm run prod:smoke`.

Tunnel stoppen: `npm run prod:down` (stoppt die ganze prod-Umgebung). Token erneuern: im Dashboard „Refresh token“, `.env.prod` aktualisieren, `npm run prod:tunnel:up`.

## Backup
Der Dienst `backup` (Image `prodrigestivill/postgres-backup-local:16`) in `compose.prod.yml` sichert die prod-DB automatisch per `pg_dump` (Plain-SQL, gzip) in einen **Host-Ordner außerhalb von Docker-Volumes** – auch ein gelöschtes Volume `poker-prod-db` lässt sich so wiederherstellen.

- **Ordner:** `BACKUP_DIR` in `.env.prod`, leer = `~/poker-backups`. Absoluter Pfad oder mit `~/` beginnend; die npm-Skripte lösen `~` auf und legen den Ordner an (Compose selbst kann `~` nicht expandieren – deshalb prod immer über die npm-Skripte starten). Externe Platte: z. B. `/Volumes/Backup/poker-backups` (muss beim Start eingehängt sein).
- **Zeitplan:** `BACKUP_SCHEDULE` (Standard `@daily` = 00:00 in `BACKUP_TZ`, Standard `Europe/Berlin`). Schläft der Mac zu dieser Zeit, fällt das Backup des Tages aus – deshalb Mac wach halten (siehe [Betrieb nach Neustart](#betrieb-nach-neustart)); `prod:status` meldet Backups, die älter als 26 h sind.
- **Aufbewahrung:** 7 tägliche, 4 wöchentliche, 6 monatliche Stände. Unterordner:

  | Ordner | Inhalt |
  |---|---|
  | `last/` | jeder einzelne Lauf `poker-JJJJMMTT-HHMMSS.sql.gz` (24 h aufbewahrt), `poker-latest.sql.gz` zeigt auf den neuesten |
  | `daily/`, `weekly/`, `monthly/` | ein Stand pro Tag/Kalenderwoche/Monat (Hardlinks, kein doppelter Platz) |
  | `pre-restore/` | Sicherungs-Dumps, die `prod:restore` vor dem Überschreiben anlegt (nicht automatisch gelöscht) |

- **Sofort sichern:** `npm run prod:backup` – gleicher Ablauf wie der tägliche Lauf (inkl. Rotation), gibt Datei und Größe aus. Sinnvoll vor riskanten Änderungen.
- **Healthcheck:** der Dienst meldet über den eingebauten Scheduler-Endpunkt `healthy`; Fehler stehen in `docker logs poker-prod-backup-1`.
- Off-Site-Kopien sind noch nicht drin (später); bis dahin den Backup-Ordner z. B. per Time Machine mitsichern.

## Restore
```sh
npm run prod:status                                   # welche Backups gibt es?
ls ~/poker-backups/daily ~/poker-backups/last
npm run prod:restore -- ~/poker-backups/daily/poker-20261008.sql.gz   # fragt nach: "restore" eintippen
npm run prod:restore -- <dump> --yes                  # ohne Rückfrage
```
Ablauf (`scripts/restore.sh`), prod muss laufen (`prod:up`):
1. Dump prüfen (`gzip -t`), Sicherheitsabfrage (`restore` eintippen) bzw. `--yes`.
2. Sicherungs-Dump des aktuellen Stands nach `BACKUP_DIR/pre-restore/` (falls die DB existiert) – so ist auch ein versehentlicher Restore umkehrbar.
3. `server` stoppen (web bleibt an und liefert solange `502` für `/api`).
4. Datenbank löschen (`DROP DATABASE … WITH (FORCE)`) und leer neu anlegen.
5. Dump in **einer** Transaktion einspielen (`psql --single-transaction`, `ON_ERROR_STOP`).
6. `server` starten und auf healthy warten (neuere Migrationen laufen dabei automatisch).

Schlägt Schritt 4 oder 5 fehl, bleibt der Server **bewusst gestoppt** (er würde sonst auf einer leeren DB frisch migrieren und ohne Daten weiterlaufen): Ursache klären, Restore wiederholen oder mit dem Dump aus `pre-restore/` zurück, dann `npm run prod:up`.

Ist das Volume `poker-prod-db` verloren: `npm run prod:up` (legt eine leere DB an, der Server migriert sie), dann `npm run prod:restore -- <dump> --yes` – das ersetzt die leere DB durch den Backup-Stand.

**Restore-Test:** `npm run prod:test-restore` (`scripts/test-restore.sh`) fährt eine isolierte Kopie der prod-Umgebung aus dem aktuellen Checkout hoch (Projekt `poker-restoretest`, eigenes Volume, keine Host-Ports, temporärer Backup-Ordner – echte prod-Daten bleiben unberührt), legt Testnutzer an, zieht ein Backup, ändert die Daten, stellt per `restore.sh` wieder her (einmal in die bestehende, einmal in eine gelöschte und neu angelegte DB), prüft die Daten und räumt danach alles weg. Laufzeit ca. 1–2 min (baut das Server-Image).

## Status
`npm run prod:status` (`scripts/status.sh`) zeigt und prüft:
- Container `db`, `server`, `web`, `backup` (und `cloudflared`, wenn `TUNNEL_TOKEN` gesetzt ist): läuft + healthy
- letztes Backup: Zeitpunkt, Größe, Alter (Fehler ab 26 h, anpassbar per `MAX_BACKUP_AGE_HOURS`), Anzahl Dateien, Größe des Ordners
- freier Speicher auf dem Laufwerk des Backup-Ordners (Fehler unter 1 GB)
- `GET /api/health` lokal über `http://localhost:4320` und – mit Tunnel – über `PUBLIC_ORIGIN`

Exit-Code `0` = alles in Ordnung, `1` = mindestens ein Problem (✗-Zeilen).

### Externer Uptime-Check (optional, Arthur)
Ein Dienst außerhalb des Macs merkt auch, wenn der Mac selbst aus ist. Zu prüfen ist `https://poker.arthur-reuss.de/api/health` (Antwort `200` mit `{"status":"ok","db":"ok"}`; bei DB-Problem `503`).
- **Kostenloser Uptime-Dienst** (z. B. UptimeRobot, Better Stack): neuen HTTP(S)-Monitor anlegen, URL oben, Intervall 5 min, optional Keyword `"status":"ok"`; Benachrichtigung per E-Mail oder App.
- **Cloudflare Health Checks** (Dashboard der Domain → Traffic → Health Checks): gleiche URL, erwarteter Code `200`, Benachrichtigung unter Notifications einrichten. Je nach Tarif kostenpflichtig – dann den Uptime-Dienst nehmen.

## Betrieb nach Neustart
Ziel: Nach einem Neustart oder Stromausfall läuft poker-prod ohne Eingreifen wieder. Docker startet beim Hochfahren alle Container mit `restart: unless-stopped` neu (gilt für alle prod-Dienste, abgesichert durch `scripts/test/compose-prod.test.mjs`) – außer sie wurden vorher mit `prod:down` gestoppt. Dafür muss Docker Desktop laufen, und das setzt eine angemeldete Benutzersitzung voraus.

Einmalig einzurichten (Arthur, macOS-Systemeinstellungen – nicht automatisiert):
1. **Docker Desktop beim Anmelden starten:** Docker Desktop → Settings → General → „Start Docker Desktop when you sign in to your computer“ aktivieren. Ist die Option gesperrt („operation is not permitted when registering app service“), Docker stattdessen als klassisches Anmeldeobjekt eintragen (so auf Arthurs Mac eingerichtet):
   `osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Docker.app", hidden:true}'`
   Prüfen: `osascript -e 'tell application "System Events" to get the path of every login item'` bzw. Systemeinstellungen → Allgemein → Anmeldeobjekte → „Beim Anmelden öffnen“.
2. **Automatische Anmeldung:** Systemeinstellungen → Benutzer:innen & Gruppen → „Automatisch anmelden als“ → eigener Benutzer. Hinweis: Mit aktivem **FileVault** bietet macOS das nicht an – nach einem Neustart muss dann einmal das Passwort eingegeben werden, erst danach starten Docker und poker-prod. Ob FileVault aus bleiben soll, ist Arthurs Abwägung (Sicherheit vs. unbeaufsichtigter Neustart).
3. **Energie:** Systemeinstellungen → Energie (Mac mini/iMac) bzw. Batterie → Optionen (MacBook):
   - „Automatischen Ruhezustand verhindern, wenn der Bildschirm aus ist“ (bei Netzbetrieb) **an**
   - „Nach Stromausfall automatisch starten“ **an** (nur bei Desktop-Macs vorhanden)
   - „Für Netzwerkzugriff aufwachen“ an (schadet nicht)
   - Der Bildschirm darf ausgehen; nur der Ruhezustand des Systems stoppt Docker.
4. **Alternativ/zusätzlich wach halten mit `caffeinate`:** im Terminal `caffeinate -s -i` (läuft, bis das Fenster geschlossen wird). Dauerhaft als LaunchAgent: Vorlage [`ops/launchd/de.arthur-reuss.poker.caffeinate.plist.example`](../ops/launchd/de.arthur-reuss.poker.caffeinate.plist.example) – Installation und Entfernen stehen in der Datei (ohne `sudo`, nur für den eigenen Benutzer).
5. Prod einmal mit `npm run prod:up` bzw. `prod:tunnel:up` starten (nicht mit `prod:down` beenden).

**Prüfen (Arthur):** Mac neu starten, (ggf. anmelden,) ca. 2 min warten, dann `npm run prod:status` – alle Container `running, healthy`, Health ok. Wer ganz sicher gehen will, testet auch „Stromkabel ziehen“ (Desktop-Mac).

## Feedback lesen
Spieler schicken Feedback über den Knopf „Feedback“ in der App (Bug, Idee, Sonstiges; WP-024). Es landet in der Tabelle `feedback` (Aufbau: [ARCHITECTURE.md](ARCHITECTURE.md), „Datenmodell“ → „Feedback“).

- **Im Browser:** als Admin unter `/admin/feedback` (Menü „Admin“ → „Feedback“), z. B. https://poker.arthur-reuss.de/admin/feedback. Filter Neu/Gelesen/Erledigt/Alle; den Status je Eintrag über die Auswahl „Status“ ändern. Admin-Flag setzen: README, Abschnitt „Admin“.
- **Im Terminal (prod):** die CLI ist im Server-Image gebündelt:
  ```sh
  docker compose -p poker-prod exec server node cli/feedback.mjs                 # die 20 neuesten, alle Status
  docker compose -p poker-prod exec server node cli/feedback.mjs --status new    # nur neue
  docker compose -p poker-prod exec server node cli/feedback.mjs --status done --limit 50
  ```
  dev: `DATABASE_URL=postgres://poker:poker@localhost:4312/poker npm run admin:feedback -w @poker/server -- --status new`.
- Jeder Eintrag zeigt Nummer, Zeit, Status, Kategorie, Absender (bei gelöschtem Account „gelöschter Account“), den Text und den Kontext: Seite, Tisch, App-Version (Commit, auf dem der Spieler war), Ausrichtung und User-Agent.
- Den Status setzt nur die Admin-Ansicht; die CLI liest nur.
- Rate-Limit: 5 Feedbacks pro Stunde und Spieler (`FEEDBACK_RATE_LIMIT_MAX`, `FEEDBACK_RATE_LIMIT_WINDOW_SECONDS` in der Server-Umgebung).
- Wird ein Account gelöscht, bleibt sein Feedback ohne Absender und ohne User-Agent erhalten.

## Security-Checkliste
Grundschutz der öffentlichen Seite (WP-022). Vor jedem Release mit Änderungen an nginx, Abhängigkeiten oder Datenverarbeitung durchgehen.

**Automatisch (in `npm run check`):**
- [ ] `scripts/test/nginx-headers.test.mjs`: jede `location` bindet `docker/nginx/security-headers.conf` ein, CSP ohne `unsafe-inline`/`unsafe-eval`, keine Inline-Skripte in `index.html`, PWA-Registrierung als eigene Datei.

**Security-Header (nginx, prod):** Wortlaut in `docker/nginx/security-headers.conf`:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss://$host; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()
Cross-Origin-Opener-Policy: same-origin
```
Braucht die App etwas Neues (fremde Bilder, Schriftarten, Sensoren …), wird die Policy im selben Commit angepasst – und die Datenschutzerklärung, falls Dritte ins Spiel kommen.

**Manuell gegen ein gebautes Web-Image** (ohne prod anzufassen; Ports 4324/4325 sind dafür frei):
```sh
docker build -f docker/web.Dockerfile -t poker-headertest-web .
docker run -d --name poker-headertest -p 127.0.0.1:4324:8080 -e API_UPSTREAM=127.0.0.1:9 poker-headertest-web
curl -sI http://127.0.0.1:4324/ | grep -iE 'content-security|x-frame|x-content|referrer|permissions|cross-origin'
curl -sI http://127.0.0.1:4324/api/health   # 502 (kein Server), Header trotzdem da
# Browser: http://127.0.0.1:4324 öffnen, DevTools-Konsole: keine „Content Security Policy“-Meldungen (502 der API sind ok)
docker rm -f poker-headertest && docker rmi poker-headertest-web
```
Gegen die echte Domain: `curl -sI https://poker.arthur-reuss.de/ | grep -iE 'strict-transport|content-security'`.

**HSTS über Cloudflare (Arthur, einmalig):** nginx sieht hinter dem Tunnel nur `http`, deshalb setzt Cloudflare HSTS.
1. Cloudflare-Dashboard → Domain `arthur-reuss.de` → **SSL/TLS** → **Edge Certificates**.
2. **Always Use HTTPS** an.
3. **HTTP Strict Transport Security (HSTS)** → **Enable HSTS**: Status an, `Max Age` zunächst 1 Monat (später 6–12 Monate), **Include subdomains** nur, wenn *alle* Subdomains von `arthur-reuss.de` HTTPS können (sonst aus lassen), **Preload** aus, **No-Sniff** an.
4. Prüfen: `curl -sI https://poker.arthur-reuss.de/ | grep -i strict-transport` → `strict-transport-security: max-age=…`.
5. Optional unter **SSL/TLS** → **Edge Certificates**: **Minimum TLS Version** 1.2.

**Abhängigkeiten:**
- [ ] `npm audit` ohne `high`/`critical` (Stand 2026-10-08: 0 Schwachstellen). Treffer: `npm audit fix` bzw. Version anheben; nicht behebbare mit Begründung im WP-Log dokumentieren.
- [ ] Basis-Images (`node:22-alpine`, `nginxinc/nginx-unprivileged`, `postgres:16-alpine`, `cloudflared`) gelegentlich auf neue Patch-Versionen heben.

**Anwendung:**
- [ ] Passwörter nur als argon2id-Hash, Session-Token nur als SHA-256 in der DB, Cookie `HttpOnly`, `SameSite=Lax`, in prod `Secure` (D-011, D-014).
- [ ] Rate-Limit auf Login, Registrierung und Konto löschen; WebSocket prüft `Origin` und Session.
- [ ] Logs enthalten keine Passwörter, Tokens oder Request-Bodies (Test in `auth.db.test.ts`).
- [ ] Konto löschen anonymisiert (siehe ARCHITECTURE.md, „Auth“ → „Konto löschen“); neue Tabellen mit `user_id` dort einbinden.
- [ ] DB ohne Host-Port in prod, Netz `backend` `internal`; `.env.prod` und `TUNNEL_TOKEN` nie im Git.

**Rechtliches:**
- [ ] Impressum und Datenschutz unter `/impressum`, `/datenschutz` erreichbar (ohne Login), Footer auf allen Seiten, am Tisch im Tisch-Menü.
- [ ] Datenschutzerklärung (`apps/web/src/legal/content/datenschutz.tsx`) beschreibt die aktuelle Datenverarbeitung; keine offenen Platzhalter (gelb markiert).
- [ ] Wird ein Backup eingespielt (`prod:restore`), Konten, die seit dem Backup gelöscht wurden, erneut löschen (die Datenschutzerklärung sagt das zu). Die IDs stehen im Server-Log (`Konto gelöscht (anonymisiert)`, `userId`); erneut anonymisieren z. B. per `UPDATE users SET username = NULL, password_hash = NULL, is_admin = false, deleted_at = now() WHERE id = …` plus `DELETE FROM sessions WHERE user_id = …`.

## Fehlersuche
- `npm run prod:logs` bzw. `docker compose -p poker-prod ps` (Status inkl. Healthchecks).
- Server direkt: `curl http://localhost:4321/api/health`.
- WebSocket-Upgrade mit `403`: `Origin` passt nicht zu `PUBLIC_ORIGIN`.
- WebSocket-Upgrade mit `401`: kein gültiges Session-Cookie (nicht eingeloggt, Session abgelaufen); `500`: Session-Prüfung fehlgeschlagen (DB nicht erreichbar).
- Nach einem Server-Neustart sind alle Tische weg: Tische und laufende Runden leben nur im Speicher; beim Start werden laufende Runden `aborted` und offene/laufende Tische `closed` (siehe ARCHITECTURE.md, „Game-Server: Protokoll und Tische“).
- Server startet nicht, Log „password authentication failed“: Volume `poker-prod-db` wurde mit einem anderen Passwort angelegt (siehe oben).
- `backup` nicht healthy oder kein neues Backup: `docker logs poker-prod-backup-1`; häufig ist `BACKUP_DIR` nicht beschreibbar oder (externe Platte) nicht eingehängt.
