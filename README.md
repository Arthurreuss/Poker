# Poker

Texas Hold'em für Freunde – **nur Spielgeld**, läuft per Docker auf dem eigenen Rechner.

## Start
```sh
npm run setup   # einmalig: aktiviert den Pre-Commit-Hook
npm run check   # Doku-Konsistenz + Tests
```

| Branch | Umgebung |
|---|---|
| `dev` | lokal testen, http://localhost:4310 |
| `main` | Release, später öffentlich über Cloudflare Tunnel |

Arbeitsweise, Stand und Entscheidungen: [CLAUDE.md](CLAUDE.md) → [docs/WORKFLOW.md](docs/WORKFLOW.md), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md).
