-- WP-022: Konto löschen (DSGVO). Accounts werden nicht hart gelöscht, sondern anonymisiert (auth/account.ts,
-- docs/ARCHITECTURE.md „Datenmodell“ → „Löschverhalten“): Die Zeile bleibt als Platzhalter für die Verweise aus
-- Runden, Händen und Aktionen (ON DELETE RESTRICT), enthält aber keine personenbezogenen Daten mehr.
-- Diese Bedingung erzwingt das: Ein gelöschter Account hat keinen Namen, keinen Passwort-Hash und keine Adminrechte.
-- Altbestand mit gesetztem deleted_at (vor WP-022 gab es keinen Löschweg) wird vorher nachträglich anonymisiert.
UPDATE users SET username = NULL, password_hash = NULL, is_admin = false WHERE deleted_at IS NOT NULL;
DELETE FROM sessions s USING users u WHERE s.user_id = u.id AND u.deleted_at IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_deleted_is_anonymized CHECK (
    deleted_at IS NULL OR (username IS NULL AND password_hash IS NULL AND NOT is_admin)
  );
