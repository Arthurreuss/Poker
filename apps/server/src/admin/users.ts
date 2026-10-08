// Spieler-Verwaltung für Admins (WP-028): Liste, Sperren/Entsperren, Sessions beenden, Passwort zurücksetzen.
// Jede ändernde Funktion schreibt den Protokolleintrag in **derselben** SQL-Anweisung wie die Änderung (CTE) –
// eine Aktion ohne Protokoll gibt es so nicht. Ändert sich nichts (User fehlt, Zustand passt nicht), wird auch
// nichts protokolliert. Prüfungen wie „nicht sich selbst sperren“ macht die Route (admin/routes.ts).
import type { Queryable } from '../db';

/** Spieler in Admin-Antworten. */
export interface AdminUserView {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  /** `null` = nicht gesperrt. */
  bannedAt: string | null;
  /** Anzahl gültiger Sessions (angemeldete Geräte). */
  sessions: number;
}

interface AdminUserRow {
  id: number;
  username: string;
  is_admin: boolean;
  created_at: Date;
  banned_at: Date | null;
  sessions: number;
}

const USER_COLUMNS = `u.id, u.username, u.is_admin, u.created_at, u.banned_at,
  (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now())::int AS sessions`;

function toView(row: AdminUserRow): AdminUserView {
  return {
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin,
    createdAt: row.created_at.toISOString(),
    bannedAt: row.banned_at === null ? null : row.banned_at.toISOString(),
    sessions: row.sessions,
  };
}

export const USER_LIST_DEFAULT_LIMIT = 50;
export const USER_LIST_MAX_LIMIT = 200;

export interface UserListOptions {
  /** Teil des Benutzernamens (case-insensitive). */
  search?: string | null;
  limit?: number;
}

/** Aktive (nicht gelöschte) Accounts, alphabetisch. */
export async function listUsers(db: Queryable, options: UserListOptions = {}): Promise<AdminUserView[]> {
  const limit = Math.min(Math.max(1, options.limit ?? USER_LIST_DEFAULT_LIMIT), USER_LIST_MAX_LIMIT);
  const search = options.search?.trim() ?? '';
  const pattern = search === '' ? null : `%${search.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await db.query<AdminUserRow>(
    `SELECT ${USER_COLUMNS} FROM users u
      WHERE u.deleted_at IS NULL AND ($2::text IS NULL OR lower(u.username) LIKE $2)
      ORDER BY lower(u.username)
      LIMIT $1`,
    [limit, pattern],
  );
  return rows.map(toView);
}

/** Aktiver Account per ID, sonst `null`. */
export async function findUser(db: Queryable, userId: number): Promise<AdminUserView | null> {
  const { rows } = await db.query<AdminUserRow>(
    `SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  const row = rows[0];
  return row === undefined ? null : toView(row);
}

export interface AdminActor {
  adminId: number;
}

/**
 * Sperrt einen aktiven, nicht gesperrten Nicht-Admin und löscht alle seine Sessions (atomar mit Protokoll).
 * Liefert die Anzahl gelöschter Sessions oder `null`, wenn nichts geändert wurde.
 */
export async function banUser(
  db: Queryable,
  { adminId, userId, reason }: AdminActor & { userId: number; reason: string | null },
): Promise<{ sessions: number } | null> {
  const { rows } = await db.query<{ sessions: number }>(
    `WITH u AS (UPDATE users SET banned_at = now()
                 WHERE id = $2 AND deleted_at IS NULL AND banned_at IS NULL AND NOT is_admin AND id <> $1
             RETURNING id),
          s AS (DELETE FROM sessions WHERE user_id IN (SELECT id FROM u) RETURNING 1),
          a AS (INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
                SELECT $1, 'user.ban', id,
                       jsonb_strip_nulls(jsonb_build_object('reason', $3::text, 'sessions', (SELECT count(*) FROM s)))
                  FROM u)
     SELECT (SELECT count(*) FROM s)::int AS sessions FROM u`,
    [adminId, userId, reason],
  );
  return rows[0] ?? null;
}

/** Hebt eine Sperre auf; `false`, wenn der User fehlt oder nicht gesperrt ist. */
export async function unbanUser(db: Queryable, { adminId, userId }: AdminActor & { userId: number }): Promise<boolean> {
  const { rows } = await db.query(
    `WITH u AS (UPDATE users SET banned_at = NULL
                 WHERE id = $2 AND deleted_at IS NULL AND banned_at IS NOT NULL
             RETURNING id),
          a AS (INSERT INTO admin_audit_log (admin_id, action, target_user_id) SELECT $1, 'user.unban', id FROM u)
     SELECT id FROM u`,
    [adminId, userId],
  );
  return rows.length > 0;
}

/** Beendet alle Sessions eines aktiven Users; Anzahl der gelöschten Sessions oder `null`, wenn der User fehlt. */
export async function revokeSessions(
  db: Queryable,
  { adminId, userId }: AdminActor & { userId: number },
): Promise<number | null> {
  const { rows } = await db.query<{ sessions: number }>(
    `WITH u AS (SELECT id FROM users WHERE id = $2 AND deleted_at IS NULL),
          s AS (DELETE FROM sessions WHERE user_id IN (SELECT id FROM u) RETURNING 1),
          a AS (INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
                SELECT $1, 'user.sessions_revoke', id, jsonb_build_object('sessions', (SELECT count(*) FROM s))
                  FROM u)
     SELECT (SELECT count(*) FROM s)::int AS sessions FROM u`,
    [adminId, userId],
  );
  return rows[0]?.sessions ?? null;
}

/**
 * Setzt einen neuen Passwort-Hash und beendet alle Sessions (atomar mit Protokoll; das Passwort selbst wird nie
 * protokolliert). `false`, wenn der User fehlt.
 */
export async function setPasswordHash(
  db: Queryable,
  { adminId, userId, passwordHash }: AdminActor & { userId: number; passwordHash: string },
): Promise<boolean> {
  const { rows } = await db.query(
    `WITH u AS (UPDATE users SET password_hash = $3 WHERE id = $2 AND deleted_at IS NULL RETURNING id),
          s AS (DELETE FROM sessions WHERE user_id IN (SELECT id FROM u) RETURNING 1),
          a AS (INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
                SELECT $1, 'user.password_reset', id, jsonb_build_object('sessions', (SELECT count(*) FROM s))
                  FROM u)
     SELECT id FROM u`,
    [adminId, userId, passwordHash],
  );
  return rows.length > 0;
}
