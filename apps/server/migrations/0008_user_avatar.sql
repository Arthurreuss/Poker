-- WP-032: Avatar aus einer festen Auswahl (AVATAR_IDS in @poker/engine/protocol, Prüfung in der App).
-- NULL = kein Avatar gewählt. Die DB prüft nur das Format, damit neue Avatare keine Migration brauchen.
-- Ein gelöschter (anonymisierter) Account hat keinen Avatar (anonymizeAccount setzt ihn zurück, WP-022).
ALTER TABLE users
  ADD COLUMN avatar text,
  ADD CONSTRAINT users_avatar_format CHECK (avatar ~ '^[a-z][a-z0-9-]{0,31}$'),
  ADD CONSTRAINT users_deleted_has_no_avatar CHECK (deleted_at IS NULL OR avatar IS NULL);
