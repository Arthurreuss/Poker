-- WP-011: Geteilte Plätze speicherbar machen. Die Engine vergibt bei gleichzeitigem Ausscheiden mit
-- gleichem Stack denselben Platz an mehrere Spieler (WP-008, z. B. 1, 2, 3, 3); die Eindeutigkeit von
-- (round_id, placement) aus 0001 würde das Speichern des Rundenergebnisses dann scheitern lassen.
-- Ob geteilte Plätze so bleiben, ist noch offen (Arthur) – der Index bleibt für Abfragen nach Platz erhalten.
ALTER TABLE round_players DROP CONSTRAINT round_players_placement_key;
CREATE INDEX round_players_round_placement_idx ON round_players (round_id, placement);
