// Admin-Protokoll (WP-028, D-029): jede Admin-Aktion landet in `admin_audit_log` (Migration 0007).
// Schreiben: `writeAudit` (eigene Anweisung) oder – wenn Aktion und Protokoll atomar sein sollen – als CTE in der
// Anweisung der Aktion (siehe admin/users.ts, auth/admin.ts). Speicherdauer 1 Jahr (D-025), Löschjob unten.
import type { FastifyBaseLogger } from 'fastify';
import { displayNameSql } from '../auth/account';
import type { Queryable } from '../db';
import type { AdminAuditLogRow, Json } from '../db/types';
import { startPeriodicJob, type PeriodicJob } from '../periodic-job';

/**
 * Erlaubte Aktionen (Format `bereich.aktion`, DB-Check in 0007). Neue Admin-Aktionen ergänzen hier ihren Code.
 * `table.reveal_cards` (WP-033, D-027): Quelle `ws`, Ziel = Tisch und Spieler, Details `{ roundId, handNumber, seat }`
 * (geschrieben von `admin/reveal.ts`).
 */
export type AuditAction =
  | 'user.ban'
  | 'user.unban'
  | 'user.sessions_revoke'
  | 'user.password_reset'
  | 'user.admin_grant'
  | 'user.admin_revoke'
  | 'table.close'
  | 'table.reveal_cards';

/** Weg, über den die Aktion kam. */
export type AuditSource = 'api' | 'cli' | 'ws';

/**
 * Details einer Aktion. Keine Benutzernamen und keine Passwörter (Namen kommen per Join aus `users`, damit eine
 * Konto-Löschung sie mitnimmt). Freitext nur unter `reason` – wird beim Löschen des Ziel-Accounts entfernt.
 */
export type AuditDetails = Record<string, Json>;

export interface AuditInput {
  /** `null` = CLI. */
  adminId: number | null;
  action: AuditAction;
  targetUserId?: number | null;
  targetTableId?: number | null;
  details?: AuditDetails;
  source?: AuditSource;
}

/** Schreibt einen Eintrag ins Admin-Protokoll. */
export async function writeAudit(db: Queryable, input: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_user_id, target_table_id, details, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      input.adminId,
      input.action,
      input.targetUserId ?? null,
      input.targetTableId ?? null,
      JSON.stringify(input.details ?? {}),
      input.source ?? 'api',
    ],
  );
}

/** Eintrag in API-Antworten. `admin`/`targetUser` `null` = CLI bzw. Account gelöscht. */
export interface AuditEntry {
  id: number;
  createdAt: string;
  action: string;
  source: AuditSource;
  admin: { id: number; username: string } | null;
  targetUser: { id: number; username: string } | null;
  targetTableId: number | null;
  details: AuditDetails;
}

export const AUDIT_LIST_DEFAULT_LIMIT = 100;
export const AUDIT_LIST_MAX_LIMIT = 500;

export interface AuditListOptions {
  limit?: number;
  /** Nur Einträge mit kleinerer id (Blättern: id des letzten Eintrags der vorigen Seite). */
  beforeId?: number | null;
  action?: string | null;
  /** Einträge, in denen dieser User Admin **oder** Ziel ist. */
  userId?: number | null;
  tableId?: number | null;
}

/** Protokoll, neueste zuerst. */
export async function listAudit(db: Queryable, options: AuditListOptions = {}): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(1, options.limit ?? AUDIT_LIST_DEFAULT_LIMIT), AUDIT_LIST_MAX_LIMIT);
  const { rows } = await db.query<AdminAuditLogRow & { admin_name: string | null; target_name: string | null }>(
    `SELECT l.*,
            CASE WHEN a.id IS NULL THEN NULL ELSE ${displayNameSql('a.username')} END AS admin_name,
            CASE WHEN t.id IS NULL THEN NULL ELSE ${displayNameSql('t.username')} END AS target_name
       FROM admin_audit_log l
       LEFT JOIN users a ON a.id = l.admin_id
       LEFT JOIN users t ON t.id = l.target_user_id
      WHERE ($2::bigint IS NULL OR l.id < $2)
        AND ($3::text IS NULL OR l.action = $3)
        AND ($4::int IS NULL OR l.admin_id = $4 OR l.target_user_id = $4)
        AND ($5::int IS NULL OR l.target_table_id = $5)
      ORDER BY l.id DESC
      LIMIT $1`,
    [limit, options.beforeId ?? null, options.action ?? null, options.userId ?? null, options.tableId ?? null],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    createdAt: r.created_at.toISOString(),
    action: r.action,
    source: r.source,
    admin: r.admin_id === null || r.admin_name === null ? null : { id: r.admin_id, username: r.admin_name },
    targetUser:
      r.target_user_id === null || r.target_name === null ? null : { id: r.target_user_id, username: r.target_name },
    targetTableId: r.target_table_id,
    details: r.details,
  }));
}

// ---------------------------------------------------------------------------
// Speicherdauer (D-025): Einträge werden 1 Jahr nach dem Anlegen gelöscht.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Frist laut D-025 bzw. Datenschutzerklärung (Abschnitt „Konto“) – bei Änderung beide anpassen. */
export const AUDIT_RETENTION_DAYS = 365;

/** Löscht Einträge, die älter als `retentionDays` sind (Stichtag `now`); liefert die Anzahl. */
export async function purgeExpiredAudit(
  db: Queryable,
  now: Date,
  retentionDays: number = AUDIT_RETENTION_DAYS,
): Promise<number> {
  const { rowCount } = await db.query('DELETE FROM admin_audit_log WHERE created_at <= $1', [
    new Date(now.getTime() - retentionDays * DAY_MS),
  ]);
  return rowCount ?? 0;
}

export interface AuditPurgeJobOptions {
  db: Queryable;
  log: Pick<FastifyBaseLogger, 'info' | 'error'>;
  now?: () => Date;
  /** Standard: täglich. */
  intervalMs?: number;
  retentionDays?: number;
}

/** Löschjob: beim Start und danach täglich (wie Feedback, `startPeriodicJob`). */
export function startAuditPurgeJob({
  db,
  log,
  now = () => new Date(),
  intervalMs = DAY_MS,
  retentionDays = AUDIT_RETENTION_DAYS,
}: AuditPurgeJobOptions): PeriodicJob {
  return startPeriodicJob({
    intervalMs,
    run: async () => {
      const deleted = await purgeExpiredAudit(db, now(), retentionDays);
      if (deleted > 0) log.info({ deleted }, 'Admin-Protokoll: abgelaufene Einträge gelöscht (D-025)');
    },
    onError: (err) => {
      log.error({ err }, 'Admin-Protokoll: Löschen abgelaufener Einträge fehlgeschlagen');
    },
  });
}
