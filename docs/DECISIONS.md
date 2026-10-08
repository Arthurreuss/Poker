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

## D-016: Keine Antes, Setz-Detailregeln nach TDA
- **Status:** akzeptiert
- **Kontext:** WP-006 hat Antes optional implementiert und einige Grenzfälle nach TDA ausgelegt (siehe WP-006-Log).
- **Entscheidung:** Es gibt nur Small und Big Blind, keine Antes (weder pro Spieler noch Big-Blind-Ante). Die TDA-Auslegungen aus WP-006 gelten, insbesondere: Big Blind All-in für weniger → andere callen trotzdem den vollen Big Blind; ein unvollständiger All-in-Raise öffnet die Setzrunde für bereits agierte Spieler (auch nach Check) nicht wieder.
- **Konsequenzen:** Tisch- und Rundenkonfiguration (WP-008, WP-015) bieten kein Ante an. Die optionale Ante-Unterstützung der Engine bleibt ungenutzt und kann später entfernt werden.

## D-017: Prod läuft aus eigenem Worktree auf main
- **Status:** akzeptiert
- **Kontext:** Das Release-Skript hat main im Arbeitsordner ausgecheckt; dev (Bind-Mount) sah dabei kurz den main-Stand.
- **Entscheidung:** main liegt dauerhaft in einem eigenen Git-Worktree (Standard `~/code/Arthurreuss/poker-prod`, `POKER_PROD_DIR`). Prod wird nur von dort gebaut und betrieben, `.env.prod` liegt dort. Der Arbeitsordner bleibt immer auf dev. Einrichtung einmalig per `npm run prod:setup`.
- **Konsequenzen:** `release` mergt dev → main im Prod-Worktree, pusht und startet prod von dort. Umsetzung in WP-021.

## D-018: Geteilte Platzierungen bei gleichzeitigem Ausscheiden
- **Status:** akzeptiert
- **Kontext:** Scheiden mehrere Spieler in derselben Hand aus, ist ihre Reihenfolge nicht eindeutig. Das Schema aus WP-009 erzwang `UNIQUE (round_id, placement)`.
- **Entscheidung:** Gleichzeitig Ausgeschiedene teilen sich die Platzierung. Ihre Punkte sind der **abgerundete** Durchschnitt der Punkte der belegten Plätze (so werden nie mehr Punkte verteilt als ohne Gleichstand). Beispiel: Zwei Spieler teilen sich bei 4 Spielern die Plätze 3 und 4 → (1 + 0) / 2 = 0,5 → je 0 Punkte. Die Unique-Bedingung auf die Platzierung entfällt (neue Migration, D-015).
- **Konsequenzen:** Rangliste und Statistiken (WP-019) müssen geteilte Plätze darstellen können.

## D-019: Server-Neustart bricht laufende Runden ohne Punkte ab
- **Status:** akzeptiert
- **Kontext:** Tische und Runden leben im Speicher des Servers (WP-011). Nach einem Neustart oder Absturz lässt sich eine laufende Runde nicht fortsetzen.
- **Entscheidung:** Beim Start werden laufende Runden `aborted` und offene oder laufende Tische `closed`. Für abgebrochene Runden gibt es keine Punkte. Bereits gespeicherte Hände bleiben in der Historie.
- **Konsequenzen:** Releases während laufender Runden kosten diese Runde. Releases deshalb möglichst dann machen, wenn niemand spielt.

## D-020: Tisch-Defaults, Grenzen und „Nochmal“
- **Status:** akzeptiert
- **Kontext:** D-012/D-013 legen Rundenmodell und Zeiten fest, aber keinen Startstack und keine Grenzen für die Tisch-Einstellungen. Nach WP-011 wird ein Tisch nach einer Runde geschlossen.
- **Entscheidung:** Startstack-Default 1.500 Chips. Zugzeit einstellbar 10–120 s, Zeitbank 0–300 s (Defaults 20 s/60 s nach D-013). Nach Rundenende kann der Ersteller mit „Nochmal“ eine neue Runde am selben Tisch mit derselben Besetzung starten.
- **Konsequenzen:** Umsetzung in WP-015 (Formular, Server-Validierung, „Nochmal“).

## D-021: Erzwungenes Layout wird eingepasst, nicht gedreht
- **Status:** akzeptiert
- **Kontext:** WP-017: Wählt man „Quer“, während das Gerät hochkant steht (oder umgekehrt), passt nicht alles in den Bildschirm.
- **Entscheidung:** Der Tisch wird im gewählten Layout verkleinert eingepasst und nicht per CSS um 90° gedreht. Standard ist „Auto“ (D-009).
- **Konsequenzen:** Keine Sonderfälle für Drehrichtung oder Desktop. Bei erzwungenem Layout gegen die Gerätelage wird es eng.

## D-022: Verbindungsabbrüche, verwaiste Runden, ein aktiver Tab
- **Status:** akzeptiert
- **Kontext:** WP-012 musste D-012 („getrennte Spieler werden automatisch gecheckt/gefoldet“) konkret auslegen.
- **Entscheidung:**
  - Ist ein Spieler am Zug getrennt, wartet der Server 3 s (Gnadenfrist), dann checkt oder foldet er automatisch. Die Frist kostet keine Zeitbank.
  - Ist an einem laufenden Tisch 10 Minuten lang kein Spieler verbunden, wird die Runde abgebrochen, ohne Punkte (wie D-019).
  - Pro User ist nur eine Verbindung aktiv: Die neuere übernimmt, die ältere wird mit Close-Code 4001 getrennt und zeigt einen Hinweis.
- **Konsequenzen:** Der Abbruch verwaister Runden wird in WP-015 umgesetzt. Hände abgebrochener Runden bleiben in der Historie, zählen aber nicht in Statistiken (WP-019).

## D-023: Zweite Domain `poker.deinemudda.win` neben `poker.arthur-reuss.de`
- **Status:** akzeptiert
- **Kontext:** Arthur hat eine zweite Domain gekauft. Wer sie eingibt, soll sie auch in der Adresszeile sehen, also keine Weiterleitung.
- **Entscheidung:** Beide Domains liefern die App über denselben Tunnel aus (zweiter Public Hostname → `web:8080`). `PUBLIC_ORIGIN` darf mehrere, kommagetrennte Origins enthalten. Der WebSocket-Origin-Check (D-014) akzeptiert jede davon. Die erste ist die Hauptadresse (Smoke-Test, Status). Alles andere bleibt relativ (eine Origin pro Aufruf).
- **Konsequenzen:** Login, PWA-Installation und lokale Einstellungen gelten pro Domain getrennt; Accounts und Punkte sind gemeinsam. Impressum und Datenschutz gelten für beide Domains. HSTS muss pro Domain in Cloudflare eingeschaltet werden.

## D-024: Tisch-, Zugangs- und Statistikregeln (Abnahme WP-015/WP-019)
- **Status:** akzeptiert
- **Kontext:** Offene Detailfragen aus WP-015 (Lobby) und WP-019 (Statistiken).
- **Entscheidung:**
  - Ein Tisch ohne Spieler und Beobachter wird nach 10 Minuten geschlossen.
  - „Nochmal“: Es spielen nur Spieler mit, die gerade verbunden sind; getrennte Spieler stehen automatisch auf.
  - Wer einmal per Einladungscode an einem privaten Tisch war, darf ihn danach per Tisch-ID wieder betreten (Server merkt sich das im Speicher).
  - Ergebnisse und Hände privater Tische sehen nur deren Teilnehmer; bei öffentlichen Tischen sieht jeder Eingeloggte das Ergebnis, Hände nur die Teilnehmer.
  - Hände, in denen ein Spieler abwesend war (erste eigene Aktion automatisch), zählen nicht in seine Quoten (VPIP, PFR, WTSD, W$SD).
  - Die Rangliste zeigt nur Spieler mit mindestens einer beendeten Runde; Punktgleichheit ergibt denselben Platz.
- **Konsequenzen:** Umsetzung der Abweichungen vom Ist-Stand in WP-026.

## D-025: Speicherdauern (Datenschutz)
- **Status:** akzeptiert
- **Kontext:** Die Datenschutzerklärung (WP-022) braucht feste Speicherdauern.
- **Entscheidung:** Server-Logs (enthalten IP-Adressen) werden höchstens 14 Tage aufbewahrt. Erledigtes Feedback wird 30 Tage nach dem Erledigen gelöscht, jedes Feedback spätestens 1 Jahr nach dem Absenden. Einträge im Admin-Protokoll (WP-028, D-029) werden 1 Jahr nach dem Anlegen gelöscht. Backups liegen nur lokal auf dem Mac (Aufbewahrung 7/4/6). Cloudflare ist Auftragsverarbeiter (DPA im Dashboard akzeptiert).
- **Konsequenzen:** Umsetzung in WP-022: Request-Logs mit IP schreiben server und nginx in Dateien, die der Dienst `logrotate` täglich rotiert und nach 12 Tagen löscht; Container-Logs enthalten keine IPs und rotieren nach Größe. Ein Server-Job löscht Feedback nach den Fristen, ein zweiter das Admin-Protokoll (WP-028). Der Backup-Ordner wird nicht in Time Machine oder eine Cloud gesichert (sonst gälten längere Fristen).

## D-026: Spiel-UI-Details (Abnahme WP-018)
- **Status:** akzeptiert
- **Kontext:** Offene Fragen aus WP-018.
- **Entscheidung:**
  - „Platz nehmen“, „Aufstehen“ und „Runde starten“ liegen vor dem Start in der Aktionsleiste.
  - Der Client berechnet die Pots der laufenden Hand selbst mit `calculatePots` aus der Engine (Engine im Web-Bundle ist ok).
  - Lobby und Tisch haben vorerst je eine eigene WebSocket-Verbindung; eine gemeinsame Verbindung für die ganze App ist eine spätere Verbesserung.
  - Die Server-Uhrzeit für den Timer-Abgleich kommt nur aus `table.state` (`serverNowMs`).
- **Konsequenzen:** Beim Wechsel Lobby → Tisch baut der Browser eine neue Verbindung auf (ca. 100–300 ms).

## D-027: Admin darf verdeckte Karten aufdecken (WP-033)
- **Status:** akzeptiert
- **Kontext:** Arthur möchte als Admin am Tisch die verdeckten Karten der Mitspieler per Tipp umdrehen und zurückdrehen können.
- **Entscheidung:**
  - Nur Admins (`users.is_admin`) können fremde verdeckte Karten anfordern, nur für den Tisch, an dem sie gerade sitzen. Der Server schickt sie nur auf ausdrückliche Anfrage und nur an diese eine Verbindung, nie im normalen `table.state`.
  - Jedes Aufdecken wird in der Datenbank protokolliert (wer, welcher Tisch/welche Hand, welcher Spieler, wann).
  - Die Mitspieler sehen davon nichts: kein Hinweis am Tisch, keine Anzeige im Spiel.
- **Konsequenzen:** Ein Admin hat am Tisch einen Informationsvorteil; Admin-Rechte nur an Vertrauenspersonen vergeben. Das Protokoll macht Missbrauch im Nachhinein nachvollziehbar. Die Datenschutzerklärung nennt das Protokoll als Admin-Protokoll.

## D-028: (reserviert für WP-020 – E2E gegen prod)
- **Status:** Platzhalter
- **Kontext:** Die Nummer ist auf `dev` bereits von WP-020 belegt; dieser Platzhalter hält nur die Nummerierung in `wp/WP-028` fortlaufend.
- **Entscheidung:** Beim Merge nach `dev` durch den echten Eintrag aus WP-020 ersetzen.
- **Konsequenzen:** –

## D-029: Rollenmodell und Admin-Protokoll (WP-028)
- **Status:** akzeptiert
- **Kontext:** Admins sollen Spieler sperren, Sessions beenden, Passwörter zurücksetzen und Tische schließen können (WP-028); WP-033 protokolliert zusätzlich das Aufdecken von Karten (D-027). Missbrauch muss nachvollziehbar sein, gleichzeitig gelten Datenschutz und Speicherdauern (D-025).
- **Entscheidung:**
  - Zwei Rollen: Spieler und Admin (`users.is_admin`). Keine feineren Rechte. Das Admin-Flag setzt/entzieht nur die CLI (`admin:make-admin`), es gibt keine API dafür – damit kann sich auch kein Admin selbst oder gegenseitig entadminen.
  - Ein allgemeiner Server-Guard prüft jede Anfrage auf `/api/admin/*` an der Wurzel der App (ohne Session 401, ohne Flag 403), auch für unbekannte Pfade. Die Prüfung im Browser (`RequireAdmin`) ist nur Komfort.
  - Sperre über `users.banned_at`: beendet alle Sessions und WebSockets (Close-Code 4002), Login meldet die Sperre nur bei richtigem Passwort (`403 account_banned`). Admins und man selbst sind nicht sperrbar.
  - Passwort-Reset durch Admin erzeugt ein Zufallspasswort, das genau einmal in der Antwort steht und nirgends gespeichert oder protokolliert wird.
  - Admin schließt einen Tisch: laufende Runde wird wie bei D-019 ohne Punkte abgebrochen.
  - Jede Admin-Aktion (API, CLI, später WebSocket) steht in `admin_audit_log` (wer, Aktion als `bereich.aktion`, Ziel-User/-Tisch, Details als JSON, Quelle, Zeitpunkt); Nutzeraktionen atomar in derselben SQL-Anweisung. Lesende Admin-Zugriffe werden nicht protokolliert. Details enthalten keine Namen oder Passwörter, Freitext nur als Begründung (`reason`).
  - Konto-Löschung: Einträge bleiben, verlieren aber per Trigger den Bezug zum gelöschten Account (Admin wie Ziel); die Begründung wird bei gelöschtem Ziel entfernt. Speicherdauer 1 Jahr (D-025).
- **Konsequenzen:** WP-029 (Dashboard) baut nur auf diese API; WP-033 schreibt `table.reveal_cards` mit `writeAudit`. Ein gesperrter Spieler kann sich unter neuem Namen neu registrieren (offene Registrierung, D-011) – bewusst hingenommen. Die Datenschutzerklärung nennt Sperre und Admin-Protokoll.
