# Fortschritt

## Arbeitspakete
<!-- BEGIN GENERATED: npm run docs:sync — nicht von Hand editieren -->
| MS | ID | Titel | Status | Abhängig von |
|---|---|---|---|---|
| M0 | [WP-000](work-packages/WP-000.md) | Arbeitsweise und Doku-System | done | — |
| M1 | [WP-001](work-packages/WP-001.md) | Monorepo-Grundgerüst und Tooling | done | WP-000 |
| M1 | [WP-002](work-packages/WP-002.md) | Docker-Entwicklungsumgebung (dev, localhost) | done | WP-001 |
| M1 | [WP-003](work-packages/WP-003.md) | Prod-Setup und Cloudflare-Tunnel vorbereiten | done | WP-002 |
| M2 | [WP-004](work-packages/WP-004.md) | Engine: Karten, Deck, Mischen | done | WP-001 |
| M2 | [WP-005](work-packages/WP-005.md) | Engine: Handbewertung | done | WP-004 |
| M2 | [WP-006](work-packages/WP-006.md) | Engine: Setzrunden | done | WP-004 |
| M2 | [WP-007](work-packages/WP-007.md) | Engine: Side Pots und Showdown | done | WP-005, WP-006 |
| M2 | [WP-008](work-packages/WP-008.md) | Engine: Freezeout-Runde mit Blind-Leveln und Punkten | done | WP-007 |
| M3 | [WP-009](work-packages/WP-009.md) | Datenbankschema und Migrationen | done | WP-002 |
| M3 | [WP-010](work-packages/WP-010.md) | Accounts: Registrierung, Login, Sessions | done | WP-009 |
| M3 | [WP-011](work-packages/WP-011.md) | Game-Server: WebSocket-Protokoll und Tische | done | WP-008, WP-010 |
| M3 | [WP-012](work-packages/WP-012.md) | Zeitlimit, Zeitbank und Reconnect | done | WP-011 |
| M3 | [WP-013](work-packages/WP-013.md) | Persistenz: Runden und Hand-Historie | done | WP-011 |
| M4 | [WP-014](work-packages/WP-014.md) | Web-Grundgerüst: PWA, Routing, Login | done | WP-002, WP-010 |
| M4 | [WP-015](work-packages/WP-015.md) | Lobby: Tische erstellen und beitreten | done | WP-011, WP-014 |
| M4 | [WP-016](work-packages/WP-016.md) | Tischansicht Hochformat | done | WP-002 |
| M4 | [WP-017](work-packages/WP-017.md) | Tischansicht Querformat und Umschalter | done | WP-016 |
| M4 | [WP-018](work-packages/WP-018.md) | Spielablauf im UI: Aktionen, Timer, Showdown | done | WP-011, WP-016 |
| M4 | [WP-019](work-packages/WP-019.md) | Rangliste und Statistiken | done | WP-013, WP-014 |
| M5 | [WP-020](work-packages/WP-020.md) | E2E-Smoke-Test | done | WP-015, WP-018 |
| M5 | [WP-021](work-packages/WP-021.md) | Backups und Betrieb | done | WP-003, WP-009 |
| M5 | [WP-022](work-packages/WP-022.md) | Rechtliches und Security-Check | done | WP-014 |
| M5 | [WP-023](work-packages/WP-023.md) | Go-Live: main auf poker.arthur-reuss.de | todo | WP-003, WP-012, WP-020, WP-021, WP-022, WP-024 |
| M4 | [WP-024](work-packages/WP-024.md) | Feedback-Button | done | WP-010, WP-014 |
| M5 | [WP-025](work-packages/WP-025.md) | Zweite Domain poker.deinemudda.win | done | WP-003 |
| M5 | [WP-026](work-packages/WP-026.md) | Nacharbeiten aus der Abnahme (Tische, Zugang, Rangliste) | done | WP-015, WP-019 |
| M6 | [WP-027](work-packages/WP-027.md) | Gemeinsame WebSocket-Verbindung für die ganze App | todo | WP-026 |
| M6 | [WP-028](work-packages/WP-028.md) | Admin-Rolle und Berechtigungen | done | WP-026 |
| M6 | [WP-029](work-packages/WP-029.md) | Admin-Dashboard | done | WP-028 |
| M6 | [WP-030](work-packages/WP-030.md) | Einladungslink teilen mit Vorschau | review | WP-026 |
| M6 | [WP-031](work-packages/WP-031.md) | Sounds und Animationen am Tisch | review | WP-026 |
| M6 | [WP-032](work-packages/WP-032.md) | Avatare und Emoji-Reaktionen | done | WP-026 |
| M6 | [WP-033](work-packages/WP-033.md) | Admin: verdeckte Karten aufdecken | done | WP-028 |
<!-- END GENERATED -->

## Meilensteine
| MS | Inhalt | Ergebnis |
|---|---|---|
| M0 | Arbeitsweise | Doku-System, Drift-Check |
| M1 | Fundament | Monorepo, Docker dev (localhost:4310), Prod-/Tunnel-Setup vorbereitet |
| M2 | Engine | Komplette Poker-Logik als getestete Bibliothek |
| M3 | Server | Accounts, WebSocket-Tische, Timer, Reconnect, Persistenz |
| M4 | Frontend | Spielbare mobile App (Hoch/Quer), Lobby, Rangliste → **Prototyp** |
| M5 | Go-Live | E2E, Backups, Rechtliches, öffentlich unter poker.arthur-reuss.de |
| M6 | Ausbau | Eine Verbindung mit „Du bist dran“, Admin-Rechte und -Dashboard, Teilen, Sounds/Animationen, Avatare/Emojis |

## Parallelisierung
- Nach WP-001 können drei Stränge parallel laufen: **Infra** (002 → 003, 009 → 010), **Engine** (004 → 005/006 → 007 → 008), später **Frontend** (014 → 016 → 017).
- Strang-Zusammenführung bei WP-011 (Engine + Accounts) und WP-018 (Server + UI).

## Nächster Schritt
Parallel in Arbeit (max. 5): WP-011 (Game-Server/WebSocket), WP-014 (Web-Grundgerüst), WP-016 (Tischansicht Hochformat). WP-021 in review (Arthur: Mac-Neustart-Test). Danach WP-011, WP-017, WP-024, WP-022.

## Log
Neueste Einträge oben. Pro Session 1–3 Zeilen.

- 2026-10-08: WP-008 done – komplette Freezeout-Runde (Blind-Level, Dead Button nach TDA, Platzierungen, Punkte), 760 simulierte Runden. Engine-Reinheit per ESLint abgesichert. Offen: geteilte Plätze vs. DB-Constraint. WP-011 gestartet.
- 2026-10-08: WP-021 review – tägliche Backups (7/4/6), Restore-Test grün, `prod:status`, Prod-Worktree + Release-Skript (D-017). Offen: Neustart-Test durch Arthur.
- 2026-10-08: WP-010 done – Registrierung/Login/Sessions (argon2id, httpOnly-Cookie, Rate-Limit), Admin-CLIs auch im Prod-Image gebündelt. Merge-Fix mit WP-003 (`buildApp`-Optionen). Limit paralleler WPs auf 5 erhöht (Arthur). WP-014 gestartet.
- 2026-10-08: WP-007 done – Side Pots, Showdown wird in `applyAction` direkt aufgelöst (keine Phase `showdown` mehr), Property-Test über 1.500 Hände. Flush-Text nennt alle fünf Karten (Arthur). D-017 Prod-Worktree, WP-024 Feedback-Button neu. WP-008 gestartet.
- 2026-10-08: WP-003 done – `poker-prod` (nginx 4320, Server, Postgres, cloudflared-Profil), Release-/Smoke-Skripte, docs/OPERATIONS.md. Merge-Fix: Prod-Image enthält Migrationen (`MIGRATIONS_DIR`); Prod-Lauf mit Smoke-Test und Migration verifiziert. D-016: keine Antes.
- 2026-10-08: WP-009 done – eigener Migrations-Runner (D-015), Schema mit 7 Tabellen, 27 DB-Tests (`npm run test:db -w @poker/server`). WP-010 gestartet.
- 2026-10-08: WP-006 done – Setzrunden als reine Zustandsmaschine (TDA-Auslegungen im WP-Log), Property-Test über 400 Hände. Merge-Fix: `HandResult` (Setzrunden) → `ActionResult`. Offen für Arthur: Antes pro Spieler vs. Big-Blind-Ante. WP-007 gestartet.
- 2026-10-08: WP-005 done – Handbewertung per Bitmasken, alle 2.598.960 Hände verifiziert (1,3 s), ~0,6 µs pro 7-Karten-Hand. WP-009 gestartet.
- 2026-10-08: WP-002 done – `npm run dev:up` → http://localhost:4310 (Vite), Server 4311, Postgres 4312; Health inkl. DB ok, Hot-Reload ok. WP-003 gestartet.
- 2026-10-08: WP-004 done (Karten als Strings `"As"`, Fisher-Yates, seeded RNG für Tests, `@poker/engine/crypto-rng` für Prod). WP-005 und WP-006 gestartet.
- 2026-10-08: WP-001 done (Monorepo, TS, ESLint, Prettier, Vitest; `format:check` in `check` aufgenommen). WP-002 und WP-004 gestartet.
- 2026-10-08: Alle Entscheidungen D-004–D-014 getroffen, 23 Arbeitspakete (WP-001–WP-023) angelegt.
- 2026-10-08: WP-000 – Arbeitsweise, Doku-System und Drift-Check aufgesetzt.
