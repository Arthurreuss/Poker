# poker — Vision und Nutzerpfade

Bestand vor der Anbindung an fleet, zusammengefasst aus README und den Entscheidungen D-001 bis
D-039 (`docs/DECISIONS.md`); eine Zielklärung (`.claude/skills/planer/zielklaerung.md`) hat es noch
nicht gegeben. Verträge und Kriterien stehen in den Tickets, nicht hier.

## Vision
Texas Hold'em für Freunde im Browser und als PWA auf dem Handy, nur mit Spielgeld (D-001). Danach
können Freunde ohne Installation und ohne Geldeinsatz zusammen an einem Tisch spielen. Nicht
dazu gehören Echtgeld, Kauf oder Auszahlung, öffentliche Turniere und fremde Grafiken (D-008).

## Nutzerpfade
- **Spieler:** Konto anlegen und anmelden, Tisch öffnen oder per Link beitreten, Hände spielen,
  Punkte und Verlauf ansehen, Feedback senden, Konto löschen.
- **Admin:** Konten und Tische verwalten, Feedback lesen (`docs/OPERATIONS.md` „Admin anlegen und
  Admin-Aktionen“).

## Anspruch je Bereich
Stufen nach `.agents/fleet/anspruch.md`.

| Bereich | Anspruch |
|---|---|
| ganzes Vorhaben | vorläufig Werkzeug (Spiel für einen Freundeskreis); bestätigt der Auftraggeber |

## Fassung
Bestand aus `dev` bei der Anbindung an fleet (fleet-Repo Ticket #153); Pläne stehen in den Issues.
