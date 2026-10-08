# Fortschritt

## Arbeitspakete
<!-- BEGIN GENERATED: npm run docs:sync — nicht von Hand editieren -->
| MS | ID | Titel | Status | Abhängig von |
|---|---|---|---|---|
| M0 | [WP-000](work-packages/WP-000.md) | Arbeitsweise und Doku-System | done | — |
| M1 | [WP-001](work-packages/WP-001.md) | Monorepo-Grundgerüst und Tooling | done | WP-000 |
| M1 | [WP-002](work-packages/WP-002.md) | Docker-Entwicklungsumgebung (dev, localhost) | done | WP-001 |
| M1 | [WP-003](work-packages/WP-003.md) | Prod-Setup und Cloudflare-Tunnel vorbereiten | in-progress | WP-002 |
| M2 | [WP-004](work-packages/WP-004.md) | Engine: Karten, Deck, Mischen | done | WP-001 |
| M2 | [WP-005](work-packages/WP-005.md) | Engine: Handbewertung | in-progress | WP-004 |
| M2 | [WP-006](work-packages/WP-006.md) | Engine: Setzrunden | in-progress | WP-004 |
| M2 | [WP-007](work-packages/WP-007.md) | Engine: Side Pots und Showdown | todo | WP-005, WP-006 |
| M2 | [WP-008](work-packages/WP-008.md) | Engine: Freezeout-Runde mit Blind-Leveln und Punkten | todo | WP-007 |
| M3 | [WP-009](work-packages/WP-009.md) | Datenbankschema und Migrationen | todo | WP-002 |
| M3 | [WP-010](work-packages/WP-010.md) | Accounts: Registrierung, Login, Sessions | todo | WP-009 |
| M3 | [WP-011](work-packages/WP-011.md) | Game-Server: WebSocket-Protokoll und Tische | todo | WP-008, WP-010 |
| M3 | [WP-012](work-packages/WP-012.md) | Zeitlimit, Zeitbank und Reconnect | todo | WP-011 |
| M3 | [WP-013](work-packages/WP-013.md) | Persistenz: Runden und Hand-Historie | todo | WP-011 |
| M4 | [WP-014](work-packages/WP-014.md) | Web-Grundgerüst: PWA, Routing, Login | todo | WP-002, WP-010 |
| M4 | [WP-015](work-packages/WP-015.md) | Lobby: Tische erstellen und beitreten | todo | WP-011, WP-014 |
| M4 | [WP-016](work-packages/WP-016.md) | Tischansicht Hochformat | todo | WP-014 |
| M4 | [WP-017](work-packages/WP-017.md) | Tischansicht Querformat und Umschalter | todo | WP-016 |
| M4 | [WP-018](work-packages/WP-018.md) | Spielablauf im UI: Aktionen, Timer, Showdown | todo | WP-011, WP-016 |
| M4 | [WP-019](work-packages/WP-019.md) | Rangliste und Statistiken | todo | WP-013, WP-014 |
| M5 | [WP-020](work-packages/WP-020.md) | E2E-Smoke-Test | todo | WP-015, WP-018 |
| M5 | [WP-021](work-packages/WP-021.md) | Backups und Betrieb | todo | WP-003, WP-009 |
| M5 | [WP-022](work-packages/WP-022.md) | Rechtliches und Security-Check | todo | WP-014 |
| M5 | [WP-023](work-packages/WP-023.md) | Go-Live: main auf poker.arthur-reuss.de | todo | WP-003, WP-012, WP-020, WP-021, WP-022 |
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

## Parallelisierung
- Nach WP-001 können drei Stränge parallel laufen: **Infra** (002 → 003, 009 → 010), **Engine** (004 → 005/006 → 007 → 008), später **Frontend** (014 → 016 → 017).
- Strang-Zusammenführung bei WP-011 (Engine + Accounts) und WP-018 (Server + UI).

## Nächster Schritt
Parallel in Arbeit: WP-003 (Prod/Cloudflare), WP-005 (Handbewertung), WP-006 (Setzrunden). Danach WP-007, WP-009, WP-014.

## Log
Neueste Einträge oben. Pro Session 1–3 Zeilen.

- 2026-10-08: WP-002 done – `npm run dev:up` → http://localhost:4310 (Vite), Server 4311, Postgres 4312; Health inkl. DB ok, Hot-Reload ok. WP-003 gestartet.
- 2026-10-08: WP-004 done (Karten als Strings `"As"`, Fisher-Yates, seeded RNG für Tests, `@poker/engine/crypto-rng` für Prod). WP-005 und WP-006 gestartet.
- 2026-10-08: WP-001 done (Monorepo, TS, ESLint, Prettier, Vitest; `format:check` in `check` aufgenommen). WP-002 und WP-004 gestartet.
- 2026-10-08: Alle Entscheidungen D-004–D-014 getroffen, 23 Arbeitspakete (WP-001–WP-023) angelegt.
- 2026-10-08: WP-000 – Arbeitsweise, Doku-System und Drift-Check aufgesetzt.
