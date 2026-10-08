import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from './test-db';
import type { HandActionRow, HandRow, RoundPlayerRow, SessionRow, TableRow, UserRow } from './types';

// Postgres-Fehlercodes
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

describe.skipIf(testDatabaseUrl === undefined)('Schema (Test-DB)', () => {
  let s: TestSchema;

  beforeAll(async () => {
    s = await createTestSchema(testDatabaseUrl ?? '');
    await runMigrations(s.config);
  });

  afterAll(async () => {
    await s.drop();
  });

  beforeEach(async () => {
    await s.pool.query('TRUNCATE users, sessions, tables, rounds, round_players, hands, hand_actions RESTART IDENTITY');
  });

  async function insertUser(username: string): Promise<UserRow> {
    const { rows } = await s.pool.query<UserRow>(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
      [username, '$argon2id$dummy'],
    );
    return rows[0] as UserRow;
  }

  async function insertTable(createdBy: number): Promise<TableRow> {
    const { rows } = await s.pool.query<TableRow>(
      `INSERT INTO tables (created_by, name, is_public, invite_code, starting_stack, small_blind, big_blind, blind_structure)
       VALUES ($1, 'Freitagsrunde', true, $2, 1500, 10, 20, $3) RETURNING *`,
      [createdBy, randomBytes(6).toString('hex'), { type: 'increasing', intervalMinutes: 10 }],
    );
    return rows[0] as TableRow;
  }

  async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
    await expect(promise).rejects.toMatchObject({ code });
  }

  /** Legt eine beendete Runde mit zwei Spielern und einer Hand an. */
  async function seedRound(): Promise<{ alice: UserRow; bob: UserRow; roundId: number; handId: number }> {
    const alice = await insertUser('alice');
    const bob = await insertUser('bob');
    const table = await insertTable(alice.id);
    const round = await s.pool.query<{ id: number }>(
      `INSERT INTO rounds (table_id, status, finished_at) VALUES ($1, 'finished', now()) RETURNING id`,
      [table.id],
    );
    const roundId = round.rows[0]?.id ?? 0;
    await s.pool.query(
      `INSERT INTO round_players (round_id, user_id, seat, placement, points) VALUES ($1, $2, 0, 1, 2), ($1, $3, 1, 2, 0)`,
      [roundId, alice.id, bob.id],
    );
    const hand = await s.pool.query<{ id: number }>(
      `INSERT INTO hands (round_id, hand_number, button_seat, small_blind, big_blind, board, players, result)
       VALUES ($1, 1, 0, 10, 20, $2, $3, $4) RETURNING id`,
      [
        roundId,
        ['As', 'Kd', '7c'],
        JSON.stringify([
          { seat: 0, userId: alice.id, stack: 1500, holeCards: ['Ah', 'Ac'] },
          { seat: 1, userId: bob.id, stack: 1500, holeCards: ['2c', '7d'] },
        ]),
        { pots: [{ amount: 80, winners: [alice.id] }] },
      ],
    );
    const handId = hand.rows[0]?.id ?? 0;
    await s.pool.query(
      `INSERT INTO hand_actions (hand_id, seq, user_id, street, action, amount) VALUES
         ($1, 1, $2, 'preflop', 'small_blind', 10),
         ($1, 2, $3, 'preflop', 'big_blind', 20),
         ($1, 3, $2, 'preflop', 'raise', 40),
         ($1, 4, $3, 'preflop', 'call', 20),
         ($1, 5, $3, 'flop', 'check', 0),
         ($1, 6, $2, 'flop', 'bet', 40),
         ($1, 7, $3, 'flop', 'fold', 0)`,
      [handId, alice.id, bob.id],
    );
    return { alice, bob, roundId, handId };
  }

  describe('users', () => {
    it('Benutzernamen sind case-insensitive eindeutig', async () => {
      await insertUser('Alice');
      await expectPgError(insertUser('alice'), UNIQUE_VIOLATION);
      await expectPgError(insertUser('ALICE'), UNIQUE_VIOLATION);
      await insertUser('Alicia');
    });

    it('liefert typisierte Zeilen mit Defaults', async () => {
      const user = await insertUser('carol');
      expect(user).toMatchObject({ id: 1, username: 'carol', is_admin: false, deleted_at: null });
      expect(user.created_at).toBeInstanceOf(Date);
    });

    it('Benutzername 3–20 Zeichen', async () => {
      await expectPgError(insertUser('ab'), CHECK_VIOLATION);
      await expectPgError(insertUser('a'.repeat(21)), CHECK_VIOLATION);
    });

    it('aktive Accounts brauchen Name und Passwort-Hash, anonymisierte nicht', async () => {
      const user = await insertUser('dave');
      await expectPgError(
        s.pool.query('UPDATE users SET password_hash = NULL WHERE id = $1', [user.id]),
        CHECK_VIOLATION,
      );
      await s.pool.query('UPDATE users SET username = NULL, password_hash = NULL, deleted_at = now() WHERE id = $1', [
        user.id,
      ]);
      // Der Name ist danach wieder frei.
      await insertUser('dave');
    });
  });

  describe('Fremdschlüssel', () => {
    it('ungültige Verweise scheitern', async () => {
      await expectPgError(
        s.pool.query(
          `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, 999, now() + interval '1 day')`,
          [createHash('sha256').update('token').digest()],
        ),
        FOREIGN_KEY_VIOLATION,
      );
      await expectPgError(s.pool.query(`INSERT INTO rounds (table_id) VALUES (999)`), FOREIGN_KEY_VIOLATION);
      await expectPgError(
        s.pool.query(
          `INSERT INTO hands (round_id, hand_number, button_seat, small_blind, big_blind) VALUES (999, 1, 0, 1, 2)`,
        ),
        FOREIGN_KEY_VIOLATION,
      );
      const { handId } = await seedRound();
      await expectPgError(
        s.pool.query(
          `INSERT INTO hand_actions (hand_id, seq, user_id, street, action) VALUES ($1, 99, 999, 'river', 'check')`,
          [handId],
        ),
        FOREIGN_KEY_VIOLATION,
      );
    });

    it('ein User mit Historie kann nicht hart gelöscht werden (Anonymisierung statt Kaskade)', async () => {
      const { bob, handId } = await seedRound();

      await expectPgError(s.pool.query('DELETE FROM users WHERE id = $1', [bob.id]), FOREIGN_KEY_VIOLATION);

      const actions = await s.pool.query('SELECT 1 FROM hand_actions WHERE hand_id = $1', [handId]);
      expect(actions.rowCount).toBe(7);
    });

    it('Löschen einer Runde entfernt deren Teilnehmer, Hände und Aktionen', async () => {
      const { roundId } = await seedRound();

      await s.pool.query('DELETE FROM rounds WHERE id = $1', [roundId]);

      for (const table of ['round_players', 'hands', 'hand_actions']) {
        const { rows } = await s.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        expect(rows[0]?.n, table).toBe(0);
      }
    });
  });

  describe('Constraints', () => {
    it('Sitz und Platzierung sind pro Runde eindeutig', async () => {
      const { roundId } = await seedRound();
      const carol = await insertUser('carol');
      await expectPgError(
        s.pool.query('INSERT INTO round_players (round_id, user_id, seat) VALUES ($1, $2, 0)', [roundId, carol.id]),
        UNIQUE_VIOLATION,
      );
      await expectPgError(
        s.pool.query('INSERT INTO round_players (round_id, user_id, seat, placement) VALUES ($1, $2, 2, 1)', [
          roundId,
          carol.id,
        ]),
        UNIQUE_VIOLATION,
      );
    });

    it('Statuswerte und Zeitpunkte müssen zusammenpassen', async () => {
      const alice = await insertUser('alice');
      const table = await insertTable(alice.id);
      await expectPgError(
        s.pool.query(`INSERT INTO rounds (table_id, status) VALUES ($1, 'finished')`, [table.id]),
        CHECK_VIOLATION,
      );
      await expectPgError(
        s.pool.query(`INSERT INTO rounds (table_id, status) VALUES ($1, 'pausiert')`, [table.id]),
        CHECK_VIOLATION,
      );
      await s.pool.query(`INSERT INTO rounds (table_id, status, finished_at) VALUES ($1, 'aborted', now())`, [
        table.id,
      ]);
    });

    it('Tisch-Konfiguration wird geprüft und hat die Standardwerte aus D-013', async () => {
      const alice = await insertUser('alice');
      const table = await insertTable(alice.id);
      expect(table).toMatchObject({ turn_time_seconds: 20, time_bank_seconds: 60, max_seats: 9, status: 'open' });
      expect(table.blind_structure).toEqual({ type: 'increasing', intervalMinutes: 10 });
      await expectPgError(
        s.pool.query(
          `INSERT INTO tables (created_by, name, is_public, invite_code, starting_stack, small_blind, big_blind, blind_structure)
           VALUES ($1, 'x', false, 'code', 1000, 20, 10, '{}')`,
          [alice.id],
        ),
        CHECK_VIOLATION,
      );
      await expectPgError(
        s.pool.query(
          `INSERT INTO tables (created_by, name, is_public, invite_code, starting_stack, small_blind, big_blind, blind_structure)
           VALUES ($1, 'x', false, $2, 1000, 10, 20, '{}')`,
          [alice.id, table.invite_code],
        ),
        UNIQUE_VIOLATION,
      );
    });

    it('Session-Token-Hash muss 32 Byte haben', async () => {
      const alice = await insertUser('alice');
      await expectPgError(
        s.pool.query(
          `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
          [Buffer.from('zu kurz'), alice.id],
        ),
        CHECK_VIOLATION,
      );
      const hash = createHash('sha256').update('token').digest();
      const { rows } = await s.pool.query<SessionRow>(
        `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING *`,
        [hash, alice.id],
      );
      expect(rows[0]?.token_hash.equals(hash)).toBe(true);
    });
  });

  describe('Abfragen für spätere WPs', () => {
    it('Hand mit Aktionen lässt sich typisiert lesen', async () => {
      const { alice, handId } = await seedRound();

      const hand = (await s.pool.query<HandRow>('SELECT * FROM hands WHERE id = $1', [handId])).rows[0];
      const actions = (
        await s.pool.query<HandActionRow>('SELECT * FROM hand_actions WHERE hand_id = $1 ORDER BY seq', [handId])
      ).rows;

      expect(hand?.board).toEqual(['As', 'Kd', '7c']);
      expect(hand?.players).toHaveLength(2);
      expect(hand?.result).toEqual({ pots: [{ amount: 80, winners: [alice.id] }] });
      expect(actions.map((a) => a.action)).toEqual([
        'small_blind',
        'big_blind',
        'raise',
        'call',
        'check',
        'bet',
        'fold',
      ]);
      expect(actions[2]).toMatchObject({ user_id: alice.id, street: 'preflop', amount: 40, is_all_in: false });
    });

    it('Rangliste: Punkte pro User', async () => {
      const { alice, bob } = await seedRound();
      await seedSecondRound(bob.id, alice.id);

      const { rows } = await s.pool.query<{ user_id: number; points: number; rounds: number }>(
        `SELECT user_id, sum(points)::int AS points, count(*)::int AS rounds
           FROM round_players GROUP BY user_id ORDER BY points DESC, user_id`,
      );

      expect(rows).toEqual([
        { user_id: alice.id, points: 2, rounds: 2 },
        { user_id: bob.id, points: 2, rounds: 2 },
      ]);
    });

    it('Hand-Historie pro User über round_players → hands', async () => {
      const { bob, handId } = await seedRound();

      const { rows } = await s.pool.query<Pick<RoundPlayerRow, 'round_id'> & { hand_id: number }>(
        `SELECT rp.round_id, h.id AS hand_id
           FROM round_players rp JOIN hands h ON h.round_id = rp.round_id
          WHERE rp.user_id = $1 ORDER BY h.started_at DESC`,
        [bob.id],
      );

      expect(rows.map((r) => r.hand_id)).toEqual([handId]);
    });

    async function seedSecondRound(winnerId: number, loserId: number): Promise<void> {
      const table = await insertTable(winnerId);
      const { rows } = await s.pool.query<{ id: number }>(
        `INSERT INTO rounds (table_id, status, finished_at) VALUES ($1, 'finished', now()) RETURNING id`,
        [table.id],
      );
      await s.pool.query(
        `INSERT INTO round_players (round_id, user_id, seat, placement, points) VALUES ($1, $2, 0, 1, 2), ($1, $3, 1, 2, 0)`,
        [rows[0]?.id, winnerId, loserId],
      );
    }
  });
});
