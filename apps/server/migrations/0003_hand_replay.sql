-- WP-013: Hand-Historie vollständig für das Replay speichern. Beschreibung: docs/ARCHITECTURE.md,
-- Abschnitt „Datenmodell“ → „Persistenz“.
--
-- - deck: Kartenreihenfolge des Decks zu Handbeginn (52 Karten, erstes Element = oberste Karte). Mit Spielern,
--   Button, Blind-Sitzen und den Aktionen spielt die Engine die Hand exakt nach (`replayHand`). Enthält auch
--   nie aufgedeckte Karten – nur serverseitig verwenden, nie an Clients geben (D-003).
-- - small_blind_seat / big_blind_seat: Blind-Sitze der Hand; nicht immer aus dem Button ableitbar
--   (Dead Small Blind, Heads-up-Übergang, WP-008). small_blind_seat NULL = kein Small Blind in dieser Hand.
-- - hand_actions.is_automatic: Aktion hat der Server ausgeführt (Zeitablauf oder getrennter Spieler → Check,
--   sonst Fold, D-013), nicht der Spieler selbst. Für Anzeige und Statistik (WP-019).
-- Die Spalten in hands sind nullable, damit die Migration auch auf Datenbanken mit Altzeilen läuft; der Server
-- füllt sie ab WP-013 immer (big_blind_seat und deck zusammen).
ALTER TABLE hands
  ADD COLUMN small_blind_seat smallint,
  ADD COLUMN big_blind_seat   smallint,
  ADD COLUMN deck             text[],
  ADD CONSTRAINT hands_blind_seats CHECK (
    (small_blind_seat IS NULL OR small_blind_seat BETWEEN 0 AND 8)
    AND (big_blind_seat IS NULL OR big_blind_seat BETWEEN 0 AND 8)
  ),
  ADD CONSTRAINT hands_deck CHECK (deck IS NULL OR cardinality(deck) = 52);

ALTER TABLE hand_actions
  ADD COLUMN is_automatic boolean NOT NULL DEFAULT false;
