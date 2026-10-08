// Feedback in Postgres (Tabelle `feedback`, migrations/0004_feedback.sql) – genutzt von API und CLI (WP-024).
import type { Queryable } from '../db';
import type { FeedbackRow } from '../db/types';
import type { FeedbackCategory, FeedbackInput, FeedbackOrientation, FeedbackStatus } from './validation';

/** Ein Feedback-Eintrag, wie ihn die Admin-API und die CLI liefern. */
export interface FeedbackItem {
  id: number;
  /** `null` = Account gelöscht/anonymisiert. */
  userId: number | null;
  /** `null` = Account gelöscht/anonymisiert. */
  username: string | null;
  category: FeedbackCategory;
  message: string;
  page: string | null;
  tableId: number | null;
  appVersion: string | null;
  userAgent: string | null;
  orientation: FeedbackOrientation | null;
  status: FeedbackStatus;
  createdAt: string;
}

export type FeedbackCounts = Record<FeedbackStatus, number>;

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

type FeedbackRowWithUser = FeedbackRow & { username: string | null };

const SELECT_WITH_USER = `SELECT f.*, u.username FROM feedback f LEFT JOIN users u ON u.id = f.user_id`;

function toItem(row: FeedbackRowWithUser): FeedbackItem {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    category: row.category,
    message: row.message,
    page: row.page,
    tableId: row.table_id,
    appVersion: row.app_version,
    userAgent: row.user_agent,
    orientation: row.orientation,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertFeedback(
  db: Queryable,
  userId: number,
  input: FeedbackInput,
  userAgent: string | null,
): Promise<{ id: number; createdAt: string }> {
  const { rows } = await db.query<{ id: number; created_at: Date }>(
    `INSERT INTO feedback (user_id, category, message, page, table_id, app_version, user_agent, orientation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
    [userId, input.category, input.message, input.page, input.tableId, input.appVersion, userAgent, input.orientation],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Feedback konnte nicht gespeichert werden');
  return { id: row.id, createdAt: row.created_at.toISOString() };
}

/** Neueste zuerst; `status` = `null` → alle. */
export async function listFeedback(
  db: Queryable,
  { status = null, limit = DEFAULT_LIST_LIMIT }: { status?: FeedbackStatus | null; limit?: number } = {},
): Promise<FeedbackItem[]> {
  const { rows } = await db.query<FeedbackRowWithUser>(
    `${SELECT_WITH_USER}
      WHERE ($1::text IS NULL OR f.status = $1)
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT $2`,
    [status, Math.min(Math.max(1, Math.trunc(limit)), MAX_LIST_LIMIT)],
  );
  return rows.map(toItem);
}

/** Anzahl je Status (für die Filter der Admin-Ansicht). */
export async function countFeedback(db: Queryable): Promise<FeedbackCounts> {
  const { rows } = await db.query<{ status: FeedbackStatus; count: number }>(
    'SELECT status, count(*)::int AS count FROM feedback GROUP BY status',
  );
  const counts: FeedbackCounts = { new: 0, read: 0, done: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/** Setzt den Status; `null`, wenn es den Eintrag nicht gibt. */
export async function updateFeedbackStatus(
  db: Queryable,
  id: number,
  status: FeedbackStatus,
): Promise<FeedbackItem | null> {
  const { rows } = await db.query<FeedbackRowWithUser>(
    `WITH updated AS (UPDATE feedback SET status = $2 WHERE id = $1 RETURNING *)
     SELECT f.*, u.username FROM updated f LEFT JOIN users u ON u.id = f.user_id`,
    [id, status],
  );
  const row = rows[0];
  return row === undefined ? null : toItem(row);
}
