-- WP-024: Feedback der Spieler (Bug, Idee, Sonstiges) mit automatisch erfasstem Kontext.
-- Beschreibung und API: docs/ARCHITECTURE.md, Abschnitt „Datenmodell“ → „Feedback“.
--
-- Löschverhalten (Account-Löschung, WP-022): Feedback bleibt erhalten, wird aber anonymisiert.
-- - user_id ist ON DELETE SET NULL (abweichend vom RESTRICT der übrigen Verweise auf users): Feedback darf
--   eine harte Löschung des Accounts nie blockieren.
-- - Die Trigger feedback_anonymize_on_user_* leeren beim Anonymisieren des Accounts (deleted_at wird gesetzt)
--   und beim harten Löschen user_id UND user_agent: Der User-Agent ist zusammen mit Zeitpunkt und Freitext ein
--   Merkmal, über das sich ein Gerät bzw. eine Person wiedererkennen lässt. Seite, Tisch, App-Version und
--   Ausrichtung bleiben (für die Fehlersuche nötig, ohne User nicht personenbezogen).

CREATE TABLE feedback (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL = Account gelöscht/anonymisiert.
  user_id      integer REFERENCES users (id) ON DELETE SET NULL,
  category     text NOT NULL,
  message      text NOT NULL,
  -- Kontext, vom Client mitgeschickt (page, table_id, app_version, orientation) bzw. vom Server (user_agent).
  page         text,
  -- Nur zur Information, bewusst ohne Fremdschlüssel (der Client meldet ihn, er muss nicht existieren).
  table_id     integer,
  app_version  text,
  user_agent   text,
  orientation  text,
  status       text NOT NULL DEFAULT 'new',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_category CHECK (category IN ('bug', 'idea', 'other')),
  CONSTRAINT feedback_status CHECK (status IN ('new', 'read', 'done')),
  CONSTRAINT feedback_message_length CHECK (char_length(message) BETWEEN 1 AND 2000),
  CONSTRAINT feedback_page_length CHECK (char_length(page) <= 200),
  CONSTRAINT feedback_app_version_length CHECK (char_length(app_version) <= 100),
  CONSTRAINT feedback_user_agent_length CHECK (char_length(user_agent) <= 500),
  CONSTRAINT feedback_orientation CHECK (orientation IN ('auto', 'portrait', 'landscape'))
);

-- Admin-Liste: neueste zuerst, optional nach Status gefiltert.
CREATE INDEX feedback_status_created_idx ON feedback (status, created_at DESC);
CREATE INDEX feedback_created_idx ON feedback (created_at DESC);
-- Anonymisieren beim Löschen eines Accounts.
CREATE INDEX feedback_user_id_idx ON feedback (user_id);

-- search_path wird beim Anlegen festgehalten (Tests nutzen eigene Schemas, siehe ARCHITECTURE.md „Migrationen“).
CREATE FUNCTION feedback_anonymize_user() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path FROM CURRENT
AS $$
BEGIN
  UPDATE feedback SET user_id = NULL, user_agent = NULL WHERE user_id = OLD.id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_anonymize_on_user_delete
  BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION feedback_anonymize_user();

CREATE TRIGGER feedback_anonymize_on_user_soft_delete
  AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION feedback_anonymize_user();
