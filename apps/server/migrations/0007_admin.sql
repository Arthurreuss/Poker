-- WP-028: Admin-Rolle (D-029) – Sperre von Spielern und Admin-Protokoll (Audit-Log).
-- Beschreibung und API: docs/ARCHITECTURE.md, Abschnitt „Admin (WP-028)“.

-- Sperre: NULL = nicht gesperrt. Gesperrte User können sich nicht einloggen, ihre Sessions werden beim Sperren
-- gelöscht und gelten auch sonst nicht mehr (auth/session.ts), WebSocket-Upgrades scheitern mit 401.
ALTER TABLE users ADD COLUMN banned_at timestamptz;

-- Ein gelöschter (anonymisierter) Account ist auch nicht gesperrt (anonymizeAccount leert banned_at).
ALTER TABLE users DROP CONSTRAINT users_deleted_is_anonymized;
ALTER TABLE users
  ADD CONSTRAINT users_deleted_is_anonymized CHECK (
    deleted_at IS NULL OR (username IS NULL AND password_hash IS NULL AND NOT is_admin AND banned_at IS NULL)
  );

-- Admin-Protokoll: jede Admin-Aktion (API, CLI, später WebSocket z. B. „Karten aufdecken“, WP-033).
-- - admin_id: wer (NULL = über die CLI ausgeführt oder Account des Admins inzwischen gelöscht).
-- - action: fester Code „bereich.aktion“ (z. B. user.ban, table.close) – bewusst kein Enum, damit neue Aktionen
--   ohne Migration dazukommen; die erlaubten Codes stehen in admin/audit.ts (AuditAction).
-- - target_user_id / target_table_id: Ziel, falls vorhanden.
-- - details: weitere Angaben als JSON-Objekt. Keine Benutzernamen und keine Passwörter hineinschreiben (Namen kommen
--   per Join aus users). Einzige Ausnahme für Freitext ist der Schlüssel „reason“ (Begründung des Admins); er wird
--   beim Löschen des Ziel-Accounts entfernt.
-- - source: Weg der Aktion (api, cli, ws).
-- Speicherdauer: 1 Jahr (D-025), Löschjob in admin/audit.ts.
CREATE TABLE admin_audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id        integer REFERENCES users (id) ON DELETE SET NULL,
  action          text NOT NULL,
  target_user_id  integer REFERENCES users (id) ON DELETE SET NULL,
  target_table_id integer REFERENCES tables (id) ON DELETE SET NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  source          text NOT NULL DEFAULT 'api',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_log_action CHECK (action ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$' AND char_length(action) <= 64),
  CONSTRAINT admin_audit_log_details_object CHECK (jsonb_typeof(details) = 'object'),
  CONSTRAINT admin_audit_log_source CHECK (source IN ('api', 'cli', 'ws'))
);

-- Liste (neueste zuerst, Blättern per id) und Löschjob.
CREATE INDEX admin_audit_log_created_idx ON admin_audit_log (created_at);
-- Filter und Anonymisieren beim Löschen eines Accounts.
CREATE INDEX admin_audit_log_admin_idx ON admin_audit_log (admin_id);
CREATE INDEX admin_audit_log_target_user_idx ON admin_audit_log (target_user_id);

-- Account-Löschung (WP-022): Einträge bleiben (Nachvollziehbarkeit der Aktion), verlieren aber den Bezug zum
-- gelöschten Account – wie beim Feedback. Als Ziel: zusätzlich die Freitext-Begründung entfernen.
-- search_path wird beim Anlegen festgehalten (Tests nutzen eigene Schemas, siehe ARCHITECTURE.md „Migrationen“).
CREATE FUNCTION admin_audit_log_anonymize_user() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path FROM CURRENT
AS $$
BEGIN
  UPDATE admin_audit_log SET admin_id = NULL WHERE admin_id = OLD.id;
  UPDATE admin_audit_log SET target_user_id = NULL, details = details - 'reason' WHERE target_user_id = OLD.id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_audit_log_anonymize_on_user_delete
  BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_anonymize_user();

CREATE TRIGGER admin_audit_log_anonymize_on_user_soft_delete
  AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION admin_audit_log_anonymize_user();
