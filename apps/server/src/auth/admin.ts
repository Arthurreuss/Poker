// Admin-Operationen für die CLI-Skripte in src/cli/ (D-011: kein Passwort-Reset per Mail, Reset über Admin).
import type { Queryable } from '../db';
import { hashPassword } from './password';
import { checkPassword } from './validation';

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
       DELETE FROM sessions WHERE user_id IN (SELECT id FROM updated)
     )
     SELECT id FROM updated`,
    [username, passwordHash],
  );
  return rows.length > 0;
}

/** Setzt oder entzieht das Admin-Flag; `false`, wenn der User nicht existiert. */
export async function setAdmin(db: Queryable, username: string, isAdmin: boolean): Promise<boolean> {
  const { rowCount } = await db.query(
    'UPDATE users SET is_admin = $2 WHERE lower(username) = lower($1) AND deleted_at IS NULL',
    [username, isAdmin],
  );
  return (rowCount ?? 0) > 0;
}
