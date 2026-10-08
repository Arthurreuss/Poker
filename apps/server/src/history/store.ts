// Hand-Historie in Postgres (WP-013, Tabellen `hands`, `hand_actions`, Migration 0003). Beide Schreibvorgänge
// sind genau eine SQL-Anweisung und idempotent (ON CONFLICT), damit ein Retry nach einem Fehler nichts doppelt
// schreibt. Lesefunktionen für Replay, Tests und spätere Anzeigen (WP-019).
import type { Card } from '@poker/engine';
import type { Queryable } from '../db';
import type { HandActionRow, HandRow } from '../db/types';
import type { HandRecord, StoredHandPlayer, StoredHandResult } from './records';

export interface HandHistoryStore {
  /** Hand zu Beginn anlegen (Spieler, Hole Cards, Deck, Blinds); existiert sie schon, passiert nichts. */
  saveHandStarted(record: HandRecord): Promise<void>;
  /** Beendete Hand speichern: Zeile anlegen oder ergänzen (Board, Ergebnis, Ende) und alle Aktionen. */
  saveHandCompleted(record: HandRecord): Promise<void>;
}

export function createPgHandHistoryStore(db: Queryable): HandHistoryStore {
  return {
    async saveHandStarted(r: HandRecord): Promise<void> {
      await db.query(
        `INSERT INTO hands (round_id, hand_number, button_seat, small_blind, big_blind,
                            small_blind_seat, big_blind_seat, deck, players)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (round_id, hand_number) DO NOTHING`,
        [
          r.roundId,
          r.handNumber,
          r.buttonSeat,
          r.smallBlind,
          r.bigBlind,
          r.smallBlindSeat,
          r.bigBlindSeat,
          r.deck,
          JSON.stringify(r.players),
        ],
      );
    },

    async saveHandCompleted(r: HandRecord): Promise<void> {
      if (r.result === null) throw new Error('Hand ohne Ergebnis kann nicht als beendet gespeichert werden');
      const a = r.actions;
      await db.query(
        `WITH h AS (
           INSERT INTO hands (round_id, hand_number, button_seat, small_blind, big_blind,
                              small_blind_seat, big_blind_seat, deck, players, board, result, finished_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
           ON CONFLICT (round_id, hand_number) DO UPDATE
             SET board = EXCLUDED.board, result = EXCLUDED.result, finished_at = EXCLUDED.finished_at
           RETURNING id
         )
         INSERT INTO hand_actions (hand_id, seq, user_id, street, action, amount, is_all_in)
         SELECT h.id, x.seq, x.user_id, x.street, x.action, x.amount, x.is_all_in
           FROM h, unnest($12::int[], $13::int[], $14::text[], $15::text[], $16::int[], $17::bool[])
                AS x(seq, user_id, street, action, amount, is_all_in)
         ON CONFLICT (hand_id, seq) DO NOTHING`,
        [
          r.roundId,
          r.handNumber,
          r.buttonSeat,
          r.smallBlind,
          r.bigBlind,
          r.smallBlindSeat,
          r.bigBlindSeat,
          r.deck,
          JSON.stringify(r.players),
          r.board,
          JSON.stringify(r.result),
          a.map((x) => x.seq),
          a.map((x) => x.userId),
          a.map((x) => x.street),
          a.map((x) => x.action),
          a.map((x) => x.amount),
          a.map((x) => x.isAllIn),
        ],
      );
    },
  };
}

/** Gespeicherte Hand mit DB-Metadaten. */
export interface LoadedHand extends HandRecord {
  id: number;
  startedAt: Date;
  /** `null` = Hand wurde nicht beendet (z. B. Server-Neustart mitten in der Hand). */
  finishedAt: Date | null;
}

/** Alle gespeicherten Hände einer Runde nach Handnummer (inkl. Aktionen). */
export async function loadRoundHands(db: Queryable, roundId: number): Promise<LoadedHand[]> {
  const { rows } = await db.query<HandRow>('SELECT * FROM hands WHERE round_id = $1 ORDER BY hand_number', [roundId]);
  return loadWithActions(db, rows);
}

/** Eine gespeicherte Hand per ID; `null`, wenn es sie nicht gibt. */
export async function loadHand(db: Queryable, handId: number): Promise<LoadedHand | null> {
  const { rows } = await db.query<HandRow>('SELECT * FROM hands WHERE id = $1', [handId]);
  return (await loadWithActions(db, rows))[0] ?? null;
}

async function loadWithActions(db: Queryable, hands: HandRow[]): Promise<LoadedHand[]> {
  if (hands.length === 0) return [];
  const { rows } = await db.query<HandActionRow>(
    'SELECT * FROM hand_actions WHERE hand_id = ANY($1::int[]) ORDER BY hand_id, seq',
    [hands.map((h) => h.id)],
  );
  return hands.map((h) => {
    if (h.deck === null || h.big_blind_seat === null) {
      throw new Error(`Hand ${String(h.id)} wurde vor WP-013 gespeichert (ohne Deck/Blind-Sitze)`);
    }
    return {
      id: h.id,
      roundId: h.round_id,
      handNumber: h.hand_number,
      buttonSeat: h.button_seat,
      smallBlind: h.small_blind,
      bigBlind: h.big_blind,
      smallBlindSeat: h.small_blind_seat,
      bigBlindSeat: h.big_blind_seat,
      deck: h.deck as Card[],
      players: h.players as unknown as StoredHandPlayer[],
      board: h.board as Card[],
      result: h.result as unknown as StoredHandResult | null,
      actions: rows
        .filter((a) => a.hand_id === h.id)
        .map((a) => ({
          seq: a.seq,
          userId: a.user_id,
          street: a.street,
          action: a.action,
          amount: a.amount,
          isAllIn: a.is_all_in,
        })),
      startedAt: h.started_at,
      finishedAt: h.finished_at,
    };
  });
}

export interface UserPoints {
  userId: number;
  /** Summe der Punkte aller beendeten Runden (D-012); abgebrochene Runden zählen nicht (Punkte `NULL`). */
  points: number;
  /** Anzahl gewerteter Runden. */
  rounds: number;
}

/**
 * Punktestand der Accounts: Summe über `round_players.points` (Index `round_players_user_points_idx`). Es gibt
 * bewusst keine Punkte-Spalte am Account – die Summe ist immer konsistent mit den Runden. Users ohne Runde: 0.
 */
export async function loadUserPoints(db: Queryable, userIds: readonly number[]): Promise<UserPoints[]> {
  const { rows } = await db.query<{ user_id: number; points: number; rounds: number }>(
    `SELECT u.id AS user_id, coalesce(sum(rp.points), 0)::int AS points, count(rp.points)::int AS rounds
       FROM users u LEFT JOIN round_players rp ON rp.user_id = u.id
      WHERE u.id = ANY($1::int[])
      GROUP BY u.id ORDER BY u.id`,
    [userIds],
  );
  return rows.map((r) => ({ userId: r.user_id, points: r.points, rounds: r.rounds }));
}
