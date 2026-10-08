// Admin deckt verdeckte Karten auf (WP-033, D-027): Protokolleintrag `table.reveal_cards` im Admin-Protokoll.
// Die Spiellogik (wer darf was wann) steckt im Game-Server (`game/admin-reveal.ts`); hier nur das Schreiben.
import type { Queryable } from '../db';
import type { CardRevealAudit } from '../game/admin-reveal';

/**
 * Schreibt den Eintrag – aber nur, wenn der Account **jetzt** noch Admin ist (nicht gesperrt, nicht gelöscht). Prüfung
 * und Eintrag stehen in derselben SQL-Anweisung (D-029: atomar), damit ein per CLI entzogenes Admin-Flag sofort
 * greift, auch wenn die WebSocket-Verbindung noch mit der alten Session läuft. `false` = kein Admin (mehr), nichts
 * geschrieben; der Server gibt die Karten dann nicht heraus.
 */
export async function recordCardReveal(db: Queryable, entry: CardRevealAudit): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_user_id, target_table_id, details, source)
     SELECT u.id, 'table.reveal_cards', $2, $3, $4::jsonb, 'ws'
       FROM users u
      WHERE u.id = $1 AND u.is_admin AND u.banned_at IS NULL AND u.deleted_at IS NULL`,
    [
      entry.adminId,
      entry.targetUserId,
      entry.tableId,
      JSON.stringify({ roundId: entry.roundId, handNumber: entry.handNumber, seat: entry.seat }),
    ],
  );
  return (rowCount ?? 0) > 0;
}
