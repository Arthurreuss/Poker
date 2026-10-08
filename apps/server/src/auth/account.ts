// Konto löschen (WP-022, DSGVO): Der Account wird anonymisiert statt hart gelöscht, damit die Hand-Historie
// der anderen Spieler vollständig bleibt (alle Verweise auf `users` sind ON DELETE RESTRICT).
// Ablauf und Begründung: docs/ARCHITECTURE.md, „Datenmodell“ → „Löschverhalten“ und „Auth“ → „Konto löschen“.
import type { Queryable } from '../db';

/** Anzeigename für anonymisierte Accounts (`users.username IS NULL`) – in Historie, Rangliste, Statistik. */
export const DELETED_USER_NAME = 'Gelöschter Spieler';

/**
 * SQL-Ausdruck für den Anzeigenamen eines Users, z. B. `displayNameSql('u.username')` →
 * `coalesce(u.username, 'Gelöschter Spieler')`. Jede Abfrage, die Namen aus `users` liest, nutzt ihn.
 */
export function displayNameSql(usernameColumn: string): string {
  return `coalesce(${usernameColumn}, '${DELETED_USER_NAME}')`;
}

/**
 * Tabellen anderer Arbeitspakete mit `user_id`-Verweis, deren Zeilen beim Löschen vom Account gelöst werden
 * (`user_id → NULL`), aber erhalten bleiben. Fehlt eine Tabelle (Migration noch nicht da), wird sie übersprungen.
 * `feedback`: WP-024 (Feedback bleibt, ohne Bezug zum Account).
 */
export const DETACHED_USER_TABLES = ['feedback'] as const;

/**
 * Anonymisiert einen aktiven Account in **einer** SQL-Anweisung (atomar): `username`, `password_hash` → `NULL`,
 * `is_admin` → `false`, `deleted_at` setzen; alle Sessions löschen; Zeilen in {@link DETACHED_USER_TABLES}
 * vom Account lösen. Runden, Hände und Aktionen behalten die `user_id` (Anzeige: {@link DELETED_USER_NAME}).
 * Liefert `false`, wenn es keinen aktiven Account mit dieser ID gibt.
 */
export async function anonymizeAccount(db: Queryable, userId: number): Promise<boolean> {
  const { rows: existing } = await db.query<{ name: string }>(
    'SELECT t AS name FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL',
    [DETACHED_USER_TABLES],
  );
  // Tabellennamen stammen aus der Konstante oben, nicht aus Eingaben.
  const detach = existing.map(
    ({ name }, i) => `, d${String(i)} AS (UPDATE ${name} SET user_id = NULL WHERE user_id IN (SELECT id FROM u))`,
  );
  const { rows } = await db.query<{ count: number }>(
    `WITH u AS (UPDATE users
                   SET username = NULL, password_hash = NULL, is_admin = false, deleted_at = now()
                 WHERE id = $1 AND deleted_at IS NULL
             RETURNING id),
          s AS (DELETE FROM sessions WHERE user_id IN (SELECT id FROM u))${detach.join('')}
     SELECT count(*)::int AS count FROM u`,
    [userId],
  );
  return (rows[0]?.count ?? 0) > 0;
}
