// Integration Game-Server + Postgres (WP-011): echte Sessions im Cookie, Tische/Runden in der Test-DB.
// Nur mit TEST_DATABASE_URL (sonst übersprungen): `npm run test:db -w @poker/server`.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createSeededRng, type HandState } from '@poker/engine';
import { DEFAULT_TABLE_SETTINGS, type ServerMessage } from '@poker/engine/protocol';
import { buildApp } from '../app';
import { SESSION_COOKIE, createSession } from '../auth/session';
import { createPgDatabase } from '../db';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import type { RoundPlayerRow, RoundRow, TableRow } from '../db/types';
import { closeOrphanedTables, createPgTableRepository } from './pg-repository';
import { TestClient, attachBot, findHoleCardLeaks } from './ws-test-client';

const ORIGIN = 'http://localhost:4310';
const DEV_AUTH = { secureCookies: false, trustCfConnectingIp: false, sessionTtlMs: 86_400_000, rateLimit: null };

describe.skipIf(testDatabaseUrl === undefined)('Game-Server mit Postgres', () => {
  let s: TestSchema;
  let app: FastifyInstance | undefined;
  let clients: TestClient[] = [];

  beforeAll(async () => {
    s = await createTestSchema(testDatabaseUrl ?? '');
    await runMigrations(s.config);
  });

  afterAll(async () => {
    await s.drop();
  });

  beforeEach(async () => {
    await s.pool.query('TRUNCATE users, sessions, tables, rounds, round_players RESTART IDENTITY CASCADE');
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    clients = [];
    await app?.close();
    app = undefined;
  });

  async function user(name: string): Promise<{ id: number; cookie: string }> {
    const { rows } = await s.pool.query<{ id: number }>(
      `INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [name],
    );
    const id = (rows[0] as { id: number }).id;
    const { token } = await createSession(s.pool, id, 3_600_000);
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  }

  async function start(hooks = {}): Promise<string> {
    app = buildApp({
      db: createPgDatabase({ ...s.config, max: 3 }),
      publicOrigin: ORIGIN,
      auth: DEV_AUTH,
      game: { handPauseMs: 0, runoutPauseMs: 0, rng: createSeededRng(11), hooks },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    return `ws://127.0.0.1:${String(port)}/ws`;
  }

  async function connect(url: string, u: { id: number; cookie: string }): Promise<TestClient> {
    const c = await TestClient.connect(url, ORIGIN, u.cookie, u.id);
    clients.push(c);
    return c;
  }

  it('3 registrierte Spieler spielen eine Runde; Tisch, Runde und Platzierungen landen in der DB', async () => {
    const hands = new Map<number, HandState>();
    const url = await start({
      onHandStarted: (e: { handNumber: number; hand: HandState }) => {
        hands.set(e.handNumber, e.hand);
      },
    });
    const users = [await user('alice'), await user('bob'), await user('carol')];
    const [a, b, c] = await Promise.all(users.map((u) => connect(url, u)));
    if (a === undefined || b === undefined || c === undefined) throw new Error('Client fehlt');

    a.send({
      type: 'table.create',
      settings: {
        name: 'DB-Tisch',
        startingStack: 150,
        blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
      },
    });
    const created = await a.next<Extract<ServerMessage, { type: 'table.created' }>>((m) => m.type === 'table.created');
    const tableId = created.tableId;
    const { rows: tableRows } = await s.pool.query<TableRow>('SELECT * FROM tables WHERE id = $1', [tableId]);
    expect(tableRows[0]).toMatchObject({
      created_by: users[0]?.id,
      name: 'DB-Tisch',
      is_public: true,
      invite_code: created.inviteCode,
      max_seats: 9,
      starting_stack: 150,
      small_blind: 10,
      big_blind: 20,
      blind_structure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
      turn_time_seconds: 20,
      time_bank_seconds: 60,
      status: 'open',
    });

    for (const [seat, cl] of [a, b, c].entries()) {
      cl.send({ type: 'table.join', tableId });
      cl.send({ type: 'table.sit', tableId, seat: seat * 2 });
      await cl.nextState((t) => t.you.seat === seat * 2);
      attachBot(cl, tableId, 50 + seat);
    }
    a.send({ type: 'table.start', tableId });
    const finished = await a.next<Extract<ServerMessage, { type: 'table.roundFinished' }>>(
      (m) => m.type === 'table.roundFinished',
      20_000,
    );
    await app?.game.idle();

    const { rows: rounds } = await s.pool.query<RoundRow>('SELECT * FROM rounds WHERE table_id = $1', [tableId]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.status).toBe('finished');
    expect(rounds[0]?.finished_at).toBeInstanceOf(Date);
    const { rows: players } = await s.pool.query<RoundPlayerRow>(
      'SELECT * FROM round_players WHERE round_id = $1 ORDER BY placement, seat',
      [rounds[0]?.id],
    );
    expect(players.map((p) => [p.user_id, p.seat, p.placement, p.points])).toEqual(
      finished.standings.map((st) => [st.user.id, st.seat, st.placement, st.points]),
    );
    expect(finished.standings.map((st) => st.user.username).sort()).toEqual(['alice', 'bob', 'carol']);
    const { rows: closed } = await s.pool.query<TableRow>('SELECT status, closed_at FROM tables WHERE id = $1', [
      tableId,
    ]);
    expect(closed[0]?.status).toBe('closed');
    expect(closed[0]?.closed_at).toBeInstanceOf(Date);

    for (const cl of [a, b, c]) expect(findHoleCardLeaks(cl, hands)).toEqual([]);

    // Hand-Historie (WP-013) ist in buildApp standardmäßig aktiv: jede Hand beendet und mit Aktionen gespeichert.
    const { rows: stored } = await s.pool.query<{ hand_number: number; finished: boolean; actions: number }>(
      `SELECT h.hand_number, h.finished_at IS NOT NULL AND h.result IS NOT NULL AS finished,
              (SELECT count(*)::int FROM hand_actions a WHERE a.hand_id = h.id) AS actions
         FROM hands h WHERE h.round_id = $1 ORDER BY h.hand_number`,
      [rounds[0]?.id],
    );
    expect(stored.map((h) => h.hand_number)).toEqual([...hands.keys()].sort((x, y) => x - y));
    expect(stored.every((h) => h.finished && h.actions >= 2)).toBe(true);
  }, 30_000);

  it('WebSocket-Upgrade ohne, mit unbekannter oder abgelaufener Session → 401', async () => {
    const url = await start();
    const expired = await user('dave');
    await s.pool.query(
      `UPDATE sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'`,
    );
    const status = (cookie?: string) =>
      new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(url, { origin: ORIGIN, ...(cookie === undefined ? {} : { headers: { cookie } }) });
        ws.once('unexpected-response', (_req, res) => {
          resolve(res.statusCode ?? 0);
          ws.terminate();
        });
        ws.once('open', () => {
          reject(new Error('unerwartet verbunden'));
        });
        ws.once('error', () => undefined);
      });
    expect(await status()).toBe(401);
    expect(await status(`${SESSION_COOKIE}=${'b'.repeat(43)}`)).toBe(401);
    expect(await status(expired.cookie)).toBe(401);
  });

  it('geteilte Plätze lassen sich speichern (Migration 0002)', async () => {
    const repo = createPgTableRepository(s.pool);
    const us = [await user('pp1'), await user('pp2'), await user('pp3'), await user('pp4')];
    const tableId = await repo.createTable({
      createdBy: (us[0] as { id: number }).id,
      settings: { ...DEFAULT_TABLE_SETTINGS, name: 'geteilt' },
      inviteCode: 'shared-1',
    });
    const roundId = await repo.startRound(
      tableId,
      us.map((u, seat) => ({ userId: u.id, seat })),
    );
    // Platz 3 geteilt: (4 − 3 + 4 − 4) / 2 → je 0 Punkte (D-012, WP-008).
    const placements = [1, 2, 3, 3];
    const points = [4, 2, 0, 0];
    await repo.finishRound(
      tableId,
      roundId,
      us.map((u, i) => ({ userId: u.id, placement: placements[i] as number, points: points[i] as number })),
    );
    const { rows } = await s.pool.query<RoundPlayerRow>(
      'SELECT placement, points FROM round_players WHERE round_id = $1 ORDER BY seat',
      [roundId],
    );
    expect(rows.map((r) => [r.placement, r.points])).toEqual([
      [1, 4],
      [2, 2],
      [3, 0],
      [3, 0],
    ]);
  });

  it('nach einem Neustart: laufende Runden → aborted, offene und laufende Tische → closed', async () => {
    const repo = createPgTableRepository(s.pool);
    const [u1, u2] = [await user('xx1'), await user('xx2')];
    const settings = { ...DEFAULT_TABLE_SETTINGS, name: 'alt' };
    const open = await repo.createTable({ createdBy: u1.id, settings, inviteCode: 'open-1' });
    const running = await repo.createTable({ createdBy: u1.id, settings, inviteCode: 'run-1' });
    const roundId = await repo.startRound(running, [
      { userId: u1.id, seat: 0 },
      { userId: u2.id, seat: 1 },
    ]);
    expect(await closeOrphanedTables(s.pool)).toEqual({ rounds: 1, tables: 2 });
    const { rows: tables } = await s.pool.query<TableRow>('SELECT id, status FROM tables ORDER BY id');
    expect(tables.map((t) => [t.id, t.status])).toEqual([
      [open, 'closed'],
      [running, 'closed'],
    ]);
    const { rows: rounds } = await s.pool.query<RoundRow>('SELECT status FROM rounds WHERE id = $1', [roundId]);
    expect(rounds[0]?.status).toBe('aborted');
    const { rows: rp } = await s.pool.query<RoundPlayerRow>('SELECT placement, points FROM round_players');
    expect(rp.every((r) => r.placement === null && r.points === null)).toBe(true);
    expect(await closeOrphanedTables(s.pool)).toEqual({ rounds: 0, tables: 0 });
  });
});
