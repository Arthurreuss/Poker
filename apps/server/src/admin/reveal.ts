// Admin-Eingriffe am Tisch im Admin-Protokoll: Karten aufdecken (WP-033, D-027, `table.reveal_cards`) und eigene
// Karten neu ziehen (WP-035, D-032, `table.redraw_cards`). Die Spiellogik (wer darf was wann) steckt im Game-Server
// (`game/admin-reveal.ts`, `GameServer`); hier nur das Schreiben.
import type { Queryable } from '../db';
import type { CardRedrawAudit, CardRevealAudit } from '../game/admin-reveal';
import type { AuditAction } from './audit';

/**
 * Schreibt den Eintrag – aber nur, wenn der Account **jetzt** noch Admin ist (nicht gesperrt, nicht gelöscht). Prüfung
 * und Eintrag stehen in derselben SQL-Anweisung (D-029: atomar), damit ein per CLI entzogenes Admin-Flag sofort
 * greift, auch wenn die WebSocket-Verbindung noch mit der alten Session läuft. `false` = kein Admin (mehr), nichts
 * geschrieben; der Server führt den Eingriff dann nicht aus.
 */
async function recordTableAction(
  db: Queryable,
  action: AuditAction,
  adminId: number,
  targetUserId: number,
  tableId: number,
  details: { roundId: number; handNumber: number; seat: number },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_user_id, target_table_id, details, source)
     SELECT u.id, $5, $2, $3, $4::jsonb, 'ws'
       FROM users u
      WHERE u.id = $1 AND u.is_admin AND u.banned_at IS NULL AND u.deleted_at IS NULL`,
    [adminId, targetUserId, tableId, JSON.stringify(details), action],
  );
  return (rowCount ?? 0) > 0;
}

/** Aufdecken der Karten eines Mitspielers (Ziel = dieser Spieler). */
export function recordCardReveal(db: Queryable, entry: CardRevealAudit): Promise<boolean> {
  const { adminId, targetUserId, tableId, roundId, handNumber, seat } = entry;
  return recordTableAction(db, 'table.reveal_cards', adminId, targetUserId, tableId, { roundId, handNumber, seat });
}

/** Neuziehen der eigenen Karten (Ziel = der Admin selbst). */
export function recordCardRedraw(db: Queryable, entry: CardRedrawAudit): Promise<boolean> {
  const { adminId, tableId, roundId, handNumber, seat } = entry;
  return recordTableAction(db, 'table.redraw_cards', adminId, adminId, tableId, { roundId, handNumber, seat });
}
