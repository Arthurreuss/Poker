// Postgres-Implementierung von `TableRepository` (Tabellen `tables`, `rounds`, `round_players`, WP-009).
// Jede Methode ist genau eine SQL-Anweisung (CTEs) und damit atomar, ohne eigene Transaktion.
import type { Queryable } from '../db';
import type { NewTable, RoundResultRecord, RoundSeatRecord, TableRepository } from './repository';

export function createPgTableRepository(db: Queryable): TableRepository {
  return {
    async createTable({ createdBy, settings, inviteCode }: NewTable): Promise<number> {
      const s = settings.blindStructure;
      const first = s.type === 'fixed' ? s.level : s.levels[0];
      if (first === undefined) throw new Error('Blind-Struktur ohne Level');
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO tables (created_by, name, is_public, invite_code, max_seats, starting_stack,
                             small_blind, big_blind, blind_structure, turn_time_seconds, time_bank_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          createdBy,
          settings.name,
          settings.isPublic,
          inviteCode,
          settings.maxSeats,
          settings.startingStack,
          first.smallBlind,
          first.bigBlind,
          JSON.stringify(s),
          settings.turnTimeSeconds,
          settings.timeBankSeconds,
        ],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error('Tisch konnte nicht angelegt werden');
      return id;
    },

    async startRound(tableId: number, players: readonly RoundSeatRecord[]): Promise<number> {
      const { rows } = await db.query<{ id: number }>(
        `WITH t AS (UPDATE tables SET status = 'running', closed_at = NULL WHERE id = $1),
              r AS (INSERT INTO rounds (table_id) VALUES ($1) RETURNING id),
              p AS (INSERT INTO round_players (round_id, user_id, seat)
                    SELECT r.id, x.user_id, x.seat FROM r, unnest($2::int[], $3::int[]) AS x(user_id, seat))
         SELECT id FROM r`,
        [tableId, players.map((p) => p.userId), players.map((p) => p.seat)],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error('Runde konnte nicht angelegt werden');
      return id;
    },

    async finishRound(tableId: number, roundId: number, results: readonly RoundResultRecord[]): Promise<void> {
      await db.query(
        `WITH r AS (UPDATE rounds SET status = 'finished', finished_at = now() WHERE id = $2),
              p AS (UPDATE round_players rp SET placement = x.placement, points = x.points
                      FROM unnest($3::int[], $4::int[], $5::int[]) AS x(user_id, placement, points)
                     WHERE rp.round_id = $2 AND rp.user_id = x.user_id)
         UPDATE tables SET status = 'closed', closed_at = now() WHERE id = $1`,
        [tableId, roundId, results.map((r) => r.userId), results.map((r) => r.placement), results.map((r) => r.points)],
      );
    },

    async abortRound(tableId: number, roundId: number): Promise<void> {
      await db.query(
        `WITH r AS (UPDATE rounds SET status = 'aborted', finished_at = greatest(now(), started_at)
                     WHERE id = $2 AND status = 'running')
         UPDATE tables SET status = 'closed', closed_at = now() WHERE id = $1 AND status <> 'closed'`,
        [tableId, roundId],
      );
    },

    async closeTable(tableId: number): Promise<void> {
      await db.query(`UPDATE tables SET status = 'closed', closed_at = now() WHERE id = $1 AND status <> 'closed'`, [
        tableId,
      ]);
    },
  };
}

/**
 * Tische und Runden leben nur im Speicher des Prozesses. Nach einem Neustart sind laufende Runden verloren:
 * sie werden `aborted` (ohne Punkte), offene und laufende Tische `closed`. Aufruf beim Serverstart (`main.ts`).
 * Bereits gespeicherte Hände der Runde bleiben (D-019, getestet in `history/history.db.test.ts`).
 */
export async function closeOrphanedTables(db: Queryable): Promise<{ rounds: number; tables: number }> {
  const { rows } = await db.query<{ rounds: number; tables: number }>(
    `WITH r AS (UPDATE rounds SET status = 'aborted', finished_at = greatest(now(), started_at)
                 WHERE status = 'running' RETURNING id),
          t AS (UPDATE tables SET status = 'closed', closed_at = now() WHERE status <> 'closed' RETURNING id)
     SELECT (SELECT count(*) FROM r)::int AS rounds, (SELECT count(*) FROM t)::int AS tables`,
  );
  return rows[0] ?? { rounds: 0, tables: 0 };
}
