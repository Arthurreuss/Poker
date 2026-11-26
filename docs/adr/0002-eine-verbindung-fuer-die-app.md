# ADR 0002 — Eine WebSocket-Verbindung für die ganze App

Status: aktiv
Bereich: Frontend

## Kontext
D-026 hat Lobby und Tisch je eine eigene WebSocket-Verbindung gegeben und die gemeinsame Verbindung
auf später verschoben. Folgen: Beim Wechsel Lobby → Tisch baute der Browser neu auf (ca. 100–300 ms),
und wer die Tischseite verließ, war für den Server getrennt. Man erfuhr außerhalb des Tisches nicht,
dass man dran ist, und lief nach der kurzen Gnadenfrist in Auto-Check bzw. Auto-Fold (#8).

## Entscheidung
Ersetzt in D-026 den Punkt „Lobby und Tisch haben vorerst je eine eigene WebSocket-Verbindung“; die
übrigen Punkte von D-026 gelten weiter.
1. **Eine Verbindung je angemeldetem Konto:** `ConnectionProvider` (`game/ConnectionProvider.tsx`)
   liegt über allen Routen und hält eine `GameConnection`, solange jemand angemeldet ist. Abmelden oder
   ein anderes Konto beendet sie. Wiederverbinden, Heartbeat, Single-Tab-Regel (4001), Versionsprüfung
   (4000) und Zeitabgleich bleiben in `GameConnection` wie bisher.
2. **Abos je Seite:** Die Lobby sendet beim Öffnen `lobby.subscribe` (auch nach jedem Wiederverbinden),
   beim Verlassen `lobby.unsubscribe`. Tische beobachtet die App mit Zählung (`watchTable`/`unwatchTable`):
   jeder Beobachter schickt `table.join` und bekommt sofort den Zustand; geht der letzte, sendet die
   Verbindung das neue `table.unwatch`.
3. **`table.unwatch`** ist eine neue Client-Nachricht: nicht mehr beobachten, ohne zu verlassen. Der
   Server behandelt sie wie einen Verbindungsabbruch für diesen Tisch (kein Aufstehen, Leerlauf-Frist
   von 10 Minuten statt sofortigem Aufräumen). `table.leave` („Tisch verlassen“) bleibt das bewusste
   Verlassen für die ganze App. Die Protokollversion bleibt 1, weil nur eine Nachricht dazukommt.
4. **„Du bist dran“ überall:** `TurnWatcher` hält jeden Tisch, an dem man sitzt und dessen Runde nicht
   beendet ist, auf der Verbindung, auch wenn die Tischseite zu ist; man gilt damit als verbunden. Ist
   man am Zug, zeigt die App-Shell (Lobby, Rangliste, Einstellungen …) ein Banner mit „Zum Tisch“,
   spielt den Zug-Ton und vibriert nach den Einstellungen „Ton am Tisch“ (Ton und Vibration je einzeln
   abschaltbar) und lässt den Tab-Titel blinken. Aufstehen, Rundenende, `table.closed`,
   `table.left` oder `TABLE_NOT_FOUND` geben den Tisch frei.
5. **Nicht dabei:** Web-Push bei geschlossener App. Ob es das geben soll, ist eine Frage an Arthur
   (#26); bis dahin wirkt der Hinweis nur bei offener App.

## Konsequenzen
- Der Wechsel Lobby ↔ Tisch baut keine Verbindung mehr auf; wer am Tisch sitzt und die Seite verlässt,
  bleibt verbunden, bekommt keine verkürzte Zugzeit und sieht seinen Zug auf jeder Seite der App.
- Wer sitzt und bei offener App nicht reagiert, verbraucht Zugzeit und Zeitbank wie am Tisch, statt
  nach 3 s automatisch zu handeln.
- Nach einem Neuladen außerhalb des Tisches kennt die App die Tische, an denen man sitzt, erst wieder,
  wenn man einen davon öffnet (der Server meldet sie nicht von sich aus).
- Tests: `game/appConnection.test.tsx` (gleiche Verbindung über Lobby → Tisch → Lobby, Banner auf der
  Rangliste mit Sprung an den Tisch, Vibration abschaltbar), `game/turnWatcher.test.ts`,
  `game/connection.test.ts` (Zählung), `lobby/client.test.ts`, Server `game/lifecycle.test.ts`
  (`table.unwatch`).
