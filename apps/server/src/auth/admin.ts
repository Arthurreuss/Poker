// Admin-Operationen für die CLI-Skripte in src/cli/ (D-011: kein Passwort-Reset per Mail, Reset über Admin).
// Jede Änderung steht im Admin-Protokoll (WP-028, D-029) mit `source = 'cli'` und ohne Admin (`admin_id` NULL),
// geschrieben in derselben SQL-Anweisung wie die Änderung.
import { randomBytes } from 'node:crypto';
import type { Queryable } from '../db';
import { hashPassword } from './password';
import { checkPassword } from './validation';

/** Zufälliges Passwort für Resets (CLI und Admin-API): 12 Zufallsbytes als base64url = 16 Zeichen. */
export function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Setzt ein neues Passwort und löscht in derselben Anweisung alle Sessions des Users.
 * Liefert `false`, wenn es keinen aktiven User mit diesem Namen (case-insensitive) gibt; wirft bei ungültigem Passwort.
 */
export async function resetPassword(db: Queryable, username: string, newPassword: string): Promise<boolean> {
  const error = checkPassword(newPassword);
  if (error !== null) throw new Error(error);
  const passwordHash = await hashPassword(newPassword);
  const { rows } = await db.query<{ id: number }>(
    `WITH updated AS (
       UPDATE users SET password_hash = $2
        WHERE lower(username) = lower($1) AND deleted_at IS NULL
        RETURNING id
     ), removed AS (
       DELETE FROM sessions WHERE user_id IN (SELECT id FROM updated) RETURNING 1
     ), audit AS (
       INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, source)
       SELECT NULL, 'user.password_reset', id, jsonb_build_object('sessions', (SELECT count(*) FROM removed)), 'cli'
         FROM updated
     )
     SELECT id FROM updated`,
    [username, passwordHash],
  );
  return rows.length > 0;
}

/**
 * Setzt oder entzieht das Admin-Flag; `false`, wenn der User nicht existiert. Protokolliert wird nur eine echte
 * Änderung. Admin-Rechte gibt es bewusst nur per CLI, nicht über die API (D-029).
 */
export async function setAdmin(db: Queryable, username: string, isAdmin: boolean): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    `WITH target AS (
       SELECT id, is_admin FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL
     ), updated AS (
       UPDATE users SET is_admin = $2 FROM target WHERE users.id = target.id RETURNING users.id
     ), audit AS (
       INSERT INTO admin_audit_log (admin_id, action, target_user_id, source)
       SELECT NULL, CASE WHEN $2 THEN 'user.admin_grant' ELSE 'user.admin_revoke' END, id, 'cli'
         FROM target WHERE is_admin <> $2
     )
     SELECT id FROM updated`,
    [username, isAdmin],
  );
  return rows.length > 0;
}
