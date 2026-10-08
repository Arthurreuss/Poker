// Abfragen für Rangliste, Statistiken und Hand-Historie (WP-019). Gewertet werden nur Runden mit Status
// `finished` und darin nur beendete Hände (D-019, D-022). Definitionen: docs/ARCHITECTURE.md, „Statistiken“.
// Gelöschte Accounts (WP-022): Name `null`, egal ob die User-Zeile anonymisiert oder ganz weg ist.
import type { Card } from '@poker/engine';
import type { Queryable } from '../db';
import type { HandActionType, RoundStatus, Street } from '../db/types';
import type { StoredAction, StoredHandPlayer, StoredHandResult } from '../history/records';
import { aggregateHandStats, type HandStats, type PlayerAction, type PlayerHand } from './stats';
import type { HistoryHand, NameLookup } from './view';

export interface LeaderboardEntry {
  /** Platz nach Punkten; gleiche Punkte = gleicher Platz (1, 1, 3 …). */
  rank: number;
  userId: number;
  name: string;
  points: number;
  /** Gewertete (beendete) Runden. */
  rounds: number;
  /** Runden auf Platz 1. */
  wins: number;
}

/**
 * Rangliste aller aktiven Accounts mit mindestens einer beendeten Runde (D-024). Gelöschte Accounts erscheinen
 * nicht. Reihenfolge: Punkte, dann Siege, dann Runden, dann Name – der Platz hängt nur an den Punkten.
 */
export async function loadLeaderboard(db: Queryable): Promise<LeaderboardEntry[]> {
  const { rows } = await db.query<{
    rank: number;
    user_id: number;
    name: string;
    points: number;
    rounds: number;
    wins: number;
  }>(
    `SELECT rank() OVER (ORDER BY coalesce(sum(rp.points), 0) DESC)::int AS rank,
            u.id AS user_id, u.username AS name,
            coalesce(sum(rp.points), 0)::int AS points,
            count(rp.round_id)::int AS rounds,
            count(*) FILTER (WHERE rp.placement = 1)::int AS wins
       FROM users u
       JOIN round_players rp ON rp.user_id = u.id
       JOIN rounds r ON r.id = rp.round_id AND r.status = 'finished'
      WHERE u.deleted_at IS NULL AND u.username IS NOT NULL
      GROUP BY u.id
      ORDER BY points DESC, wins DESC, rounds DESC, lower(u.username), u.id`,
  );
  return rows.map((r) => ({
    rank: r.rank,
    userId: r.user_id,
    name: r.name,
    points: r.points,
    rounds: r.rounds,
    wins: r.wins,
  }));
}

/** Aktiver Account per Name (case-insensitive); `null`, wenn unbekannt oder gelöscht. */
export async function findActiveUser(db: Queryable, name: string): Promise<{ id: number; name: string } | null> {
  const { rows } = await db.query<{ id: number; username: string }>(
    'SELECT id, username FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL',
    [name],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, name: row.username };
}

/**
 * Sicht eines Spielers auf alle gewerteten Hände (Eingabe für `aggregateHandStats`). Über den Index
 * `hand_actions (user_id, hand_id)`: Jeder Spieler mit Karten hat in jeder Hand mindestens eine Aktion
 * (Blind oder Entscheidung), siehe ARCHITECTURE.md „Statistiken“.
 */
export async function loadPlayerHands(db: Queryable, userId: number): Promise<PlayerHand[]> {
  const { rows } = await db.query<{
    board_size: number;
    showdown: boolean;
    won_pot: boolean;
    actions: PlayerAction[];
  }>(
    `SELECT cardinality(h.board)::int AS board_size,
            coalesce((h.result ->> 'showdown')::boolean, false) AS showdown,
            jsonb_path_exists(h.result, '$.pots[*].winnerUserIds[*] ? (@ == $u)', jsonb_build_object('u', $1::int))
              AS won_pot,
            a.actions
       FROM (SELECT hand_id,
                    json_agg(json_build_object('street', street, 'action', action, 'isAutomatic', is_automatic)
                             ORDER BY seq) AS actions
               FROM hand_actions WHERE user_id = $1 GROUP BY hand_id) a
       JOIN hands h ON h.id = a.hand_id AND h.result IS NOT NULL
       JOIN rounds r ON r.id = h.round_id AND r.status = 'finished'`,
    [userId],
  );
  return rows.map((r) => ({ actions: r.actions, boardSize: r.board_size, showdown: r.showdown, wonPot: r.won_pot }));
}

export interface PlayerStats {
  player: { id: number; name: string };
  /** `null` = noch keine beendete Runde, also nicht in der Rangliste (D-024). */
  rank: number | null;
  points: number;
  rounds: number;
  wins: number;
  hands: HandStats;
}

export async function loadPlayerStats(db: Queryable, name: string): Promise<PlayerStats | null> {
  const user = await findActiveUser(db, name);
  if (user === null) return null;
  const [board, hands] = await Promise.all([loadLeaderboard(db), loadPlayerHands(db, user.id)]);
  const entry = board.find((e) => e.userId === user.id);
  return {
    player: user,
    rank: entry?.rank ?? null,
    points: entry?.points ?? 0,
    rounds: entry?.rounds ?? 0,
    wins: entry?.wins ?? 0,
    hands: aggregateHandStats(hands),
  };
}

export interface RoundPlayerSummary {
  /** `null` = gelöschter Spieler. */
  name: string | null;
  seat: number;
  /** `null` bei abgebrochenen Runden; mehrere Spieler können denselben Platz haben (D-018). */
  placement: number | null;
  points: number | null;
  isViewer: boolean;
}

export interface RoundSummary {
  id: number;
  tableName: string;
  status: Exclude<RoundStatus, 'running'>;
  startedAt: string;
  finishedAt: string;
  /** Beendete, gespeicherte Hände. */
  handCount: number;
  /** Betrachter hat mitgespielt (dann darf er die Hände nachlesen). */
  viewerParticipated: boolean;
  /** Öffentlicher Tisch: Ergebnis für alle Eingeloggten, sonst nur für Teilnehmer (D-024). */
  isPublic: boolean;
  /** Nach Platz, dann Sitz. */
  players: RoundPlayerSummary[];
}

interface RoundSummaryRow {
  id: number;
  table_name: string;
  is_public: boolean;
  status: Exclude<RoundStatus, 'running'>;
  started_at: Date;
  finished_at: Date;
  hand_count: number;
  players: {
    userId: number | null;
    name: string | null;
    seat: number;
    placement: number | null;
    points: number | null;
  }[];
}

const ROUND_SUMMARY_SELECT = `
  SELECT r.id, t.name AS table_name, t.is_public, r.status, r.started_at, r.finished_at,
         (SELECT count(*)::int FROM hands h WHERE h.round_id = r.id AND h.result IS NOT NULL) AS hand_count,
         (SELECT coalesce(json_agg(json_build_object(
                   'userId', p.user_id,
                   'name', CASE WHEN u.deleted_at IS NULL THEN u.username END,
                   'seat', p.seat, 'placement', p.placement, 'points', p.points)
                 ORDER BY p.placement NULLS LAST, p.seat), '[]')
            FROM round_players p LEFT JOIN users u ON u.id = p.user_id
           WHERE p.round_id = r.id) AS players
    FROM rounds r JOIN tables t ON t.id = r.table_id`;

function toRoundSummary(row: RoundSummaryRow, viewerId: number): RoundSummary {
  const players = row.players.map((p) => ({
    name: p.name,
    seat: p.seat,
    placement: p.placement,
    points: p.points,
    isViewer: p.userId === viewerId,
  }));
  return {
    id: row.id,
    tableName: row.table_name,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at.toISOString(),
    handCount: row.hand_count,
    viewerParticipated: players.some((p) => p.isViewer),
    isPublic: row.is_public,
    players,
  };
}

/**
 * Letzte beendete oder abgebrochene Runden von `userId` (neueste zuerst), Sicht von `viewerId`. Laufende Runden
 * fehlen, Runden privater Tische nur, wenn `viewerId` mitgespielt hat (D-024). Über den Index
 * `round_players (user_id, round_id)`.
 */
export async function loadRecentRounds(
  db: Queryable,
  userId: number,
  viewerId: number,
  limit: number,
): Promise<RoundSummary[]> {
  const { rows } = await db.query<RoundSummaryRow>(
    `${ROUND_SUMMARY_SELECT}
      WHERE r.id IN (SELECT round_id FROM round_players WHERE user_id = $1) AND r.status <> 'running'
        AND (t.is_public OR EXISTS (SELECT 1 FROM round_players v WHERE v.round_id = r.id AND v.user_id = $3))
      ORDER BY r.finished_at DESC, r.id DESC
      LIMIT $2`,
    [userId, limit, viewerId],
  );
  return rows.map((r) => toRoundSummary(r, viewerId));
}

/** Eine beendete oder abgebrochene Runde; `null`, wenn es sie nicht gibt oder sie noch läuft. */
export async function loadRoundSummary(db: Queryable, roundId: number, viewerId: number): Promise<RoundSummary | null> {
  const { rows } = await db.query<RoundSummaryRow>(
    `${ROUND_SUMMARY_SELECT} WHERE r.id = $1 AND r.status <> 'running'`,
    [roundId],
  );
  const row = rows[0];
  return row === undefined ? null : toRoundSummary(row, viewerId);
}

/** Hat `userId` in der Runde gespielt? */
export async function isRoundParticipant(db: Queryable, roundId: number, userId: number): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM round_players WHERE round_id = $1 AND user_id = $2', [
    roundId,
    userId,
  ]);
  return rows.length > 0;
}

interface HistoryHandRow {
  id: number;
  round_id: number;
  hand_number: number;
  button_seat: number;
  small_blind: number;
  big_blind: number;
  small_blind_seat: number | null;
  big_blind_seat: number | null;
  board: string[];
  players: StoredHandPlayer[];
  result: StoredHandResult;
  started_at: Date;
  actions: {
    seq: number;
    userId: number;
    street: Street;
    action: HandActionType;
    amount: number;
    isAllIn: boolean;
    isAutomatic: boolean;
  }[];
}

// Bewusst ohne `deck` (D-003): Was nicht geladen wird, kann nicht versehentlich ausgeliefert werden.
const HISTORY_HAND_SELECT = `
  SELECT h.id, h.round_id, h.hand_number, h.button_seat, h.small_blind, h.big_blind,
         h.small_blind_seat, h.big_blind_seat, h.board, h.players, h.result, h.started_at,
         coalesce((SELECT json_agg(json_build_object(
                     'seq', a.seq, 'userId', a.user_id, 'street', a.street, 'action', a.action, 'amount', a.amount,
                     'isAllIn', a.is_all_in, 'isAutomatic', a.is_automatic) ORDER BY a.seq)
                     FROM hand_actions a WHERE a.hand_id = h.id), '[]') AS actions
    FROM hands h JOIN rounds r ON r.id = h.round_id`;

function toHistoryHand(row: HistoryHandRow): HistoryHand {
  return {
    id: row.id,
    roundId: row.round_id,
    handNumber: row.hand_number,
    buttonSeat: row.button_seat,
    smallBlind: row.small_blind,
    bigBlind: row.big_blind,
    smallBlindSeat: row.small_blind_seat,
    // Altzeilen vor WP-013 ohne Blind-Sitz: Anzeige ohne BB-Markierung (-1 passt auf keinen Sitz).
    bigBlindSeat: row.big_blind_seat ?? -1,
    board: row.board as Card[],
    players: row.players,
    result: row.result,
    actions: row.actions satisfies StoredAction[],
    startedAt: row.started_at,
  };
}

/** Beendete Hände einer (nicht laufenden) Runde nach Handnummer. */
export async function loadRoundHistory(db: Queryable, roundId: number): Promise<HistoryHand[]> {
  const { rows } = await db.query<HistoryHandRow>(
    `${HISTORY_HAND_SELECT}
      WHERE h.round_id = $1 AND h.result IS NOT NULL AND r.status <> 'running'
      ORDER BY h.hand_number`,
    [roundId],
  );
  return rows.map(toHistoryHand);
}

/** Eine beendete Hand einer nicht laufenden Runde; `null` sonst. */
export async function loadHistoryHand(db: Queryable, handId: number): Promise<HistoryHand | null> {
  const { rows } = await db.query<HistoryHandRow>(
    `${HISTORY_HAND_SELECT} WHERE h.id = $1 AND h.result IS NOT NULL AND r.status <> 'running'`,
    [handId],
  );
  const row = rows[0];
  return row === undefined ? null : toHistoryHand(row);
}

/** Anzeigenamen der Spieler in den Händen; gelöschte oder fehlende Accounts → `null`. */
export async function loadNames(db: Queryable, hands: readonly HistoryHand[]): Promise<NameLookup> {
  const ids = [...new Set(hands.flatMap((h) => h.players.map((p) => p.userId)))];
  const { rows } = await db.query<{ id: number; name: string | null }>(
    'SELECT id, CASE WHEN deleted_at IS NULL THEN username END AS name FROM users WHERE id = ANY($1::int[])',
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}
