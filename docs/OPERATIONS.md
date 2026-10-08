# Betrieb

Wie dev und prod gestartet, gestoppt und released werden, wie der Cloudflare-Tunnel eingerichtet wird, Backup, Restore, Status, Logs, Betrieb nach Neustart und die Security-Checkliste. Aufbau der Umgebungen: [ARCHITECTURE.md](ARCHITECTURE.md); Begründungen: D-002, D-005, D-006, D-010, D-014, D-017, D-028 in [DECISIONS.md](DECISIONS.md).

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
npm run prod:up          # baut die Images aus dem Prod-Worktree (main) und startet db, server, web, backup, logrotate (ohne Tunnel); wartet auf healthy
npm run prod:smoke       # Smoke-Test: /api/health und WebSocket (401 ohne Session, 403 fremde Origin) über http://localhost:4320
npm run prod:e2e         # E2E-Smoke-Test im Browser: zwei Test-Konten spielen eine Runde, danach gelöscht (siehe Release)
npm run prod:status      # Zustandsbericht (siehe Status)
npm run prod:logs        # Container-Logs folgen (Request-Logs von server/web: siehe Logs)
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
3. merkt sich den bisherigen `main`-Stand (Ziel eines Rollbacks), dann Merge im Prod-Worktree: `git -C ~/code/Arthurreuss/poker-prod merge --no-ff dev` (Merge-Commit „Release: merge dev → main“; ein Merge löst den Pre-Commit-Hook nicht aus). Schlägt der Merge fehl, wird er abgebrochen und `main` bleibt unverändert.
4. `git push origin main dev`
5. prod aus dem Prod-Worktree neu bauen und starten: `prod:tunnel:up`, wenn `TUNNEL_TOKEN` gesetzt ist, sonst `prod:up`
6. Prüfung des neuen prod (`scripts/release-verify.sh`): erst `prod:smoke`, dann `prod:e2e`. Schlägt einer fehl, bricht der Release mit Exit-Code 1 ab und gibt die Rollback-Befehle aus (siehe unten).

Vorher dev lokal per Docker getestet haben (D-005), am besten auch mit dem E2E-Test: `npm run test:e2e -w @poker/web` (gegen http://localhost:4310).

### E2E-Smoke-Test (WP-020)
Playwright-Test `apps/web/e2e-game/smoke.pw.ts`: zwei Spieler registrieren sich über `/register` (Namen `e2e_<Zeitstempel>…`), A erstellt über die Lobby einen **privaten** Tisch „E2E-Test …“ (2 Plätze, Stack 200, feste Blinds), B tritt über den Einladungslink bei, beide nehmen Platz, A startet, beide gehen All-in, bis bei beiden der Dialog „Runde beendet“ mit zwei Platzierungen und demselben Sieger steht. Danach werden beide Konten per `DELETE /api/me` gelöscht – auch wenn der Test scheitert. Dauer: wenige Sekunden; greift das Auth-Rate-Limit (10 pro Minute und IP), wartet der Test es ab.
```sh
npm run test:e2e -w @poker/web                      # gegen dev-Docker (http://localhost:4310)
npm run prod:e2e                                    # gegen prod (http://localhost:4320 über den Origin-Proxy)
E2E_BASE_URL=https://poker.arthur-reuss.de npm run prod:e2e   # gegen die echte Domain (über Cloudflare, ohne Proxy)
npm run test:e2e -w @poker/web -- --repeat-each=10  # Stabilität prüfen
```
- **Warum ein Proxy (D-028):** Der prod-WebSocket nimmt nur Origins aus `PUBLIC_ORIGIN` an. `prod:e2e` startet deshalb für die Dauer des Tests `scripts/e2e-origin-proxy.mjs` auf `localhost:4318`, der alles an `http://127.0.0.1:4320` weiterreicht und nur den `Origin`-Header durch die erste `PUBLIC_ORIGIN` ersetzt. prod braucht dafür keine Konfigurationsänderung. Andere Werte: `E2E_ORIGIN`, `E2E_PROXY_PORT`, `E2E_BASE_URL`.
- Playwright läuft aus dem Arbeitsordner (der Prod-Worktree hat keine `node_modules`); Chromium einmalig: `npx playwright install chromium` in `apps/web`.
- **Spuren in prod:** zwei gelöschte (anonymisierte) Konten und eine private Runde, die nur ihre (gelöschten) Teilnehmer sehen dürften – nicht in Lobby, Rangliste, Profilen oder Rundenlisten (D-024, D-028). Fehlerbericht und Trace: `apps/web/node_modules/.cache/playwright-game-results/` (`npx playwright show-trace …/trace.zip`).

### Release abgebrochen – Rollback
Schlägt Smoke-Test oder E2E fehl, steht `main` schon auf dem neuen Stand (gepusht) und prod läuft damit. Das Skript nennt den vorherigen Stand `<vorher>` und die Befehle:
1. Erst prüfen, ob der Fehler bleibt: `npm run prod:e2e` bzw. `npm run prod:smoke` (Fehlerbericht siehe oben).
2. Zurückrollen – prod aus dem vorherigen Commit neu bauen:
   ```sh
   git -C ~/code/Arthurreuss/poker-prod checkout --detach <vorher>
   npm run prod:tunnel:up     # bzw. prod:up ohne Tunnel
   npm run prod:smoke
   ```
3. Fehler auf dev beheben. Vor dem nächsten Release den Prod-Worktree zurück auf `main` setzen (`release` verlangt das): `git -C ~/code/Arthurreuss/poker-prod checkout main`, dann `npm run release`.
4. Hat der neue Stand Datenbank-Migrationen ausgeführt, läuft der alte Server auf dem neueren Schema. Migrationen sind bisher nur additiv; im Zweifel das letzte Backup einspielen (`npm run prod:restore`, siehe Restore).

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

**Weitere Domain (D-023, z. B. `poker.deinemudda.win`):** Ein Tunnel bedient beliebig viele Hostnamen.
1. Domain in Cloudflare hinzufügen („Add a site“) und beim Registrar die Nameserver auf Cloudflare umstellen; warten, bis die Domain „Active“ ist.
2. Im **bestehenden** Tunnel unter **Public Hostname** → **Add**: Subdomain `poker`, Domain `deinemudda.win`, Service `HTTP` → `web:8080`.
3. In `.env.prod` die Origin anhängen: `PUBLIC_ORIGIN=https://poker.arthur-reuss.de,https://poker.deinemudda.win` (kommagetrennt, ohne Slash; die erste bleibt die Hauptadresse für Smoke-Test und Status).
4. `npm run prod:tunnel:up` (Server neu starten, damit er die Origins liest); prüfen: `SMOKE_URL=https://poker.deinemudda.win SMOKE_ORIGIN=https://poker.deinemudda.win npm run prod:smoke`.
5. HSTS/„Always Use HTTPS“ (Security-Checkliste) auch für die neue Domain einschalten.

Login, Homescreen-App und Einstellungen gelten pro Domain getrennt (Cookies und Speicher hängen am Host); Accounts und Punkte sind dieselben.

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
- **Nur lokal (D-025):** Die Datenschutzerklärung sagt zu, dass Backups nur auf dem Mac liegen und nach 6 Monaten weg sind. Den Backup-Ordner deshalb **nicht** in Time Machine, iCloud oder andere Cloud-/Off-Site-Sicherungen aufnehmen (Time Machine: Systemeinstellungen → Allgemein → Time Machine → Optionen → Ordner ausschließen) – oder vorher Datenschutzerklärung und D-025 anpassen.

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
- Container `db`, `server`, `web`, `backup`, `logrotate` (und `cloudflared`, wenn `TUNNEL_TOKEN` gesetzt ist): läuft + healthy
- letztes Backup: Zeitpunkt, Größe, Alter (Fehler ab 26 h, anpassbar per `MAX_BACKUP_AGE_HOURS`), Anzahl Dateien, Größe des Ordners
- freier Speicher auf dem Laufwerk des Backup-Ordners (Fehler unter 1 GB)
- `GET /api/health` lokal über `http://localhost:4320` und – mit Tunnel – über `PUBLIC_ORIGIN`

Exit-Code `0` = alles in Ordnung, `1` = mindestens ein Problem (✗-Zeilen).

### Externer Uptime-Check (optional, Arthur)
Ein Dienst außerhalb des Macs merkt auch, wenn der Mac selbst aus ist. Zu prüfen ist `https://poker.arthur-reuss.de/api/health` (Antwort `200` mit `{"status":"ok","db":"ok"}`; bei DB-Problem `503`).
- **Kostenloser Uptime-Dienst** (z. B. UptimeRobot, Better Stack): neuen HTTP(S)-Monitor anlegen, URL oben, Intervall 5 min, optional Keyword `"status":"ok"`; Benachrichtigung per E-Mail oder App.
- **Cloudflare Health Checks** (Dashboard der Domain → Traffic → Health Checks): gleiche URL, erwarteter Code `200`, Benachrichtigung unter Notifications einrichten. Je nach Tarif kostenpflichtig – dann den Uptime-Dienst nehmen.

## Logs
Speicherdauer nach D-025: Logs mit IP-Adressen höchstens **14 Tage** (so steht es in der Datenschutzerklärung). Docker rotiert Container-Logs nur nach Größe, nie nach Alter – deshalb zwei Wege:

| Log | Inhalt | Wo | Aufbewahrung |
|---|---|---|---|
| Request-Log `server` (Fastify/pino, JSON) | Client-IP (`remoteAddress`), Methode, URL, Status, Fehler, Meldungen wie „Konto gelöscht“ | Datei `/var/log/poker/server.log` im Volume `poker-prod_server-logs` (`LOG_FILE`) | täglich rotiert, rotierte Dateien nach 12 Tagen gelöscht → max. ~13 Tage |
| Access-Log `web` (nginx) | Client-IP (`CF-Connecting-IP`), Zeit, Request, Status, Größe, Antwortzeit, Referrer, User-Agent; ohne Healthchecks | Datei `/var/log/poker/access.log` im Volume `poker-prod_web-logs` (`NGINX_ACCESS_LOG`) | wie oben |
| Container-Logs aller Dienste (`docker logs`, `prod:logs`) | Start/Stopp, nginx-Fehlerlog, Postgres, Backup, cloudflared (Level `info`: Verbindungen zum Cloudflare-Edge, keine Requests, keine Client-IPs) – keine Client-IPs | Docker, Treiber `local` | nach Größe: 3 × 10 MB je Container; beim Neu-Erstellen des Containers (Release) gelöscht |

- **Rotation:** Dienst `logrotate` (`alpine`, ohne Netz) führt `docker/logrotate/rotate.sh loop` aus: stündliche Prüfung; einmal pro Kalendertag (UTC) wird jede nicht leere `*.log` nach `<datei>.<JJJJMMTT>T<HHMMSS>Z` kopiert und geleert (copytruncate, die Dienste schreiben weiter), rotierte Dateien älter als 12 Tage werden gelöscht. Healthy, solange die letzte Rotation < 26 h her ist. Abgesichert durch `scripts/test/log-rotate.test.mjs` und `scripts/test/compose-prod.test.mjs`.
- **Lesen:**
  ```sh
  docker compose -p poker-prod exec logrotate tail -f /logs/server/server.log    # Server-Requests/Fehler live
  docker compose -p poker-prod exec logrotate tail -f /logs/web/access.log       # nginx-Access-Log live
  docker compose -p poker-prod exec logrotate ls -l /logs/server /logs/web       # rotierte Dateien
  docker compose -p poker-prod exec logrotate grep -h 'Konto gelöscht' /logs/server/server.log /logs/server/server.log.*
  ```
- **Nicht** `cloudflared` auf `--loglevel debug` stellen (schreibt Request-Header inkl. Client-IP in die Container-Logs, die nur nach Größe rotieren) – zum Debuggen nur kurz und danach den Container neu erstellen (`npm run prod:tunnel:up`).
- Lokal ohne `LOG_FILE`/`NGINX_ACCESS_LOG` (dev, Header-Test) loggen server und nginx wie gewohnt nach stdout.

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

- **Im Browser:** als Admin unter `/admin/feedback` (Menü „Admin“ → „Feedback“), z. B. https://poker.arthur-reuss.de/admin/feedback oder https://poker.deinemudda.win/admin/feedback. Filter Neu/Gelesen/Erledigt/Alle; den Status je Eintrag über die Auswahl „Status“ ändern. Admin-Flag setzen: README, Abschnitt „Admin“.
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
- **Automatisches Löschen (D-025, so in der Datenschutzerklärung):** Erledigtes Feedback wird **30 Tage nach dem Erledigen** gelöscht, jedes Feedback **spätestens 1 Jahr nach dem Absenden** – auch ungelesenes. Der Server prüft beim Start und danach täglich (`feedback/retention.ts`, Log „Feedback: abgelaufene Einträge gelöscht“). Wird ein erledigter Eintrag wieder auf Neu/Gelesen gesetzt, beginnt die 30-Tage-Frist beim nächsten „Erledigt“ neu. Was aufgehoben werden soll, vorher selbst notieren (z. B. als Issue).

## Security-Checkliste
Grundschutz der öffentlichen Seite (WP-022). Vor jedem Release mit Änderungen an nginx, Abhängigkeiten oder Datenverarbeitung durchgehen.

**Automatisch (in `npm run check`):**
- [ ] `scripts/test/nginx-headers.test.mjs`: jede `location` bindet `docker/nginx/security-headers.conf` ein, CSP ohne `unsafe-inline`/`unsafe-eval`, keine Inline-Skripte in `index.html`, PWA-Registrierung als eigene Datei.
- [ ] `scripts/test/og-tags.test.mjs`: Open-Graph-Tags, `sub_filter` für die Origin, CSP-Wortlaut unverändert (WP-030).
- [ ] `scripts/test/compose-prod.test.mjs` und `scripts/test/log-rotate.test.mjs`: Log-Rotation nach D-025 (Größen-Rotation aller Container-Logs, Request-Logs in rotierten Dateien, Löschfrist < 14 Tage, cloudflared nicht auf `debug`).

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
Gegen die echten Domains: siehe Prüfschleife unter HSTS.

**HSTS über Cloudflare (Arthur, einmalig, für jede Domain – D-023):** nginx sieht hinter dem Tunnel nur `http`, deshalb setzt Cloudflare HSTS. HSTS gilt pro Zone, also beide Domains getrennt einrichten:

| Zone im Cloudflare-Dashboard | Hostname der App |
|---|---|
| `arthur-reuss.de` | `poker.arthur-reuss.de` |
| `deinemudda.win` | `poker.deinemudda.win` |

Für **jede** der beiden Zonen:
1. Cloudflare-Dashboard → Zone auswählen → **SSL/TLS** → **Edge Certificates** → **Always Use HTTPS** an.
2. **HTTP Strict Transport Security (HSTS)** → **Enable HSTS**: Status an, `Max Age` zunächst 1 Monat (später 6–12 Monate), **Include subdomains** nur, wenn *alle* Subdomains der Zone HTTPS können (sonst aus lassen), **Preload** aus, **No-Sniff** an.
3. Optional: **Minimum TLS Version** 1.2.
4. Prüfen (beide Domains):
   ```sh
   for d in poker.arthur-reuss.de poker.deinemudda.win; do
     echo "$d"; curl -sI "https://$d/" | grep -iE 'strict-transport|content-security'
     curl -sI "http://$d/" | grep -iE '^HTTP|^location'   # 301 auf https://
   done
   ```
   Erwartet je Domain: `strict-transport-security: max-age=…`, die CSP aus nginx und für `http://` eine Weiterleitung auf `https://`.

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
- [ ] Datenschutzerklärung (`apps/web/src/legal/content/datenschutz.tsx`) beschreibt die aktuelle Datenverarbeitung, gilt für beide Domains, „Stand“ aktuell; keine Platzhalter (Test in `legal.test.tsx`).
- [ ] Speicherdauern nach D-025 greifen: `npm run prod:status` zeigt `logrotate` healthy; in `/logs/*/` keine rotierten Dateien älter als 12 Tage (siehe [Logs](#logs)); Feedback-Löschjob ohne Fehler im Server-Log; Backup-Ordner nicht in Time Machine/Cloud.
- [ ] Wird ein Backup eingespielt (`prod:restore`), Konten, die seit dem Backup gelöscht wurden, erneut löschen (die Datenschutzerklärung sagt das zu). **Vor** dem Restore die IDs aus der aktuellen DB holen (das Server-Log reicht nur 14 Tage zurück; notfalls aus dem Dump in `pre-restore/`):
  `docker compose -p poker-prod exec db psql -U poker -d poker -tAc 'SELECT id FROM users WHERE deleted_at IS NOT NULL'`.
  Nach dem Restore die IDs, die im Backup noch nicht gelöscht sind, erneut anonymisieren, z. B. per `UPDATE users SET username = NULL, password_hash = NULL, is_admin = false, deleted_at = now() WHERE id = … AND deleted_at IS NULL` (der Trigger trennt dabei auch ihr Feedback) plus `DELETE FROM sessions WHERE user_id = …`. Abgelaufenes Feedback löscht der Server beim Start nach dem Restore selbst.

## Link-Vorschau
Messenger zeigen für geteilte Links (Startseite, `/join/…`, `/table/…`) Bild und Titel aus den Open-Graph-Tags (WP-030, ARCHITECTURE.md → „Frontend“ → „Link-Vorschau“). nginx setzt dabei die aufgerufene Domain in Bild- und Seiten-URL ein.

**Lokal gegen ein gebautes Web-Image** (Ports 4324/4325, wie bei der Security-Checkliste):
```sh
docker build -f docker/web.Dockerfile -t poker-ogtest-web .
docker run -d --name poker-ogtest -p 127.0.0.1:4324:8080 -e API_UPSTREAM=127.0.0.1:9 poker-ogtest-web
for d in poker.arthur-reuss.de poker.deinemudda.win; do
  curl -s -H "Host: $d" -H 'X-Forwarded-Proto: https' http://127.0.0.1:4324/join/abc | grep -E 'og:(url|image)"'
done   # erwartet https://<domain>/ bzw. https://<domain>/og-image.png
docker rm -f poker-ogtest && docker rmi poker-ogtest-web
```

**Nach dem Release (beide Domains):**
```sh
for d in poker.arthur-reuss.de poker.deinemudda.win; do
  curl -s -A 'WhatsApp/2.23' "https://$d/join/test" | grep -E 'og:(title|url|image)"'
  curl -sI "https://$d/og-image.png" | grep -iE '^HTTP|content-type'   # 200, image/png
done
```
Dann in WhatsApp (und Signal) einen Einladungslink an sich selbst bzw. eine Testgruppe schicken: Vorschau mit Bild und „Poker – Spiel mit Freunden“. Messenger cachen Vorschauen pro URL; nach Änderungen am Bild mit einer neuen URL testen (z. B. anderer Einladungscode). Fehlt die Vorschau, prüfen, ob Cloudflare den Crawler blockt (Security → Events, „Bot Fight Mode“).

## Fehlersuche
- `npm run prod:logs` bzw. `docker compose -p poker-prod ps` (Status inkl. Healthchecks); Requests und Fehler des Servers stehen in der Log-Datei (siehe [Logs](#logs)).
- Server direkt: `curl http://localhost:4321/api/health`.
- WebSocket-Upgrade mit `403`: `Origin` passt nicht zu `PUBLIC_ORIGIN`.
- WebSocket-Upgrade mit `401`: kein gültiges Session-Cookie (nicht eingeloggt, Session abgelaufen); `500`: Session-Prüfung fehlgeschlagen (DB nicht erreichbar).
- Nach einem Server-Neustart sind alle Tische weg: Tische und laufende Runden leben nur im Speicher; beim Start werden laufende Runden `aborted` und offene/laufende Tische `closed` (siehe ARCHITECTURE.md, „Game-Server: Protokoll und Tische“).
- Server startet nicht, Log „password authentication failed“: Volume `poker-prod-db` wurde mit einem anderen Passwort angelegt (siehe oben).
- `backup` nicht healthy oder kein neues Backup: `docker logs poker-prod-backup-1`; häufig ist `BACKUP_DIR` nicht beschreibbar oder (externe Platte) nicht eingehängt.
