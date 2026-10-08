// Integrationstests der Dashboard-Lese-Endpunkte (WP-029) gegen die Test-DB (nur mit TEST_DATABASE_URL):
// Übersicht (Tische, Spieler online, Runden heute/Woche, Feedback, Health) und Tischliste. Zugriff (401/403) prüft
// der Guard-Test in admin.db.test.ts für alle /api/admin/*-Routen.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeededRng } from '@poker/engine';
import type { ServerMessage } from '@poker/engine/protocol';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import { SESSION_COOKIE } from '../auth/session';
import { createPgDatabase } from '../db';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import { TestClient } from '../game/ws-test-client';
import { countRounds, loadOverview, type AdminOverview, type AdminTable } from './overview';

const ORIGIN = 'http://localhost:4310';
const AUTH: AuthConfig = {
  secureCookies: false,
  trustCfConnectingIp: false,
  sessionTtlMs: 86_400_000,
  rateLimit: null,
};
const PASSWORD = 'richtig-geheim';

interface Account {
  id: number;
  cookie: string;
}

type TableCreated = Extract<ServerMessage, { type: 'table.created' }>;

describe.skipIf(testDatabaseUrl === undefined)('Admin-Dashboard (Test-DB)', () => {
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
    await s.pool.query(
      `TRUNCATE users, sessions, tables, rounds, round_players, hands, hand_actions, feedback, admin_audit_log
       RESTART IDENTITY CASCADE`,
    );
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    clients = [];
    await app?.close();
    app = undefined;
  });

  function start(): FastifyInstance {
    app = buildApp({
      db: createPgDatabase({ ...s.config, max: 3 }),
      publicOrigin: ORIGIN,
      auth: AUTH,
      game: { handPauseMs: 0, disconnectGraceMs: 0, rng: createSeededRng(5) },
    });
    return app;
  }

  async function listen(a: FastifyInstance): Promise<string> {
    await a.listen({ host: '127.0.0.1', port: 0 });
    return `ws://127.0.0.1:${String((a.server.address() as AddressInfo).port)}/ws`;
  }

  async function connect(url: string, acc: Account): Promise<TestClient> {
    const c = await TestClient.connect(url, ORIGIN, acc.cookie, acc.id);
    clients.push(c);
    return c;
  }

  function cookieOf(res: LightMyRequestResponse): string {
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (cookie === undefined) throw new Error('kein Session-Cookie');
    return `${SESSION_COOKIE}=${cookie.value}`;
  }

  async function register(a: FastifyInstance, username: string, admin = false): Promise<Account> {
    const res = await a.inject({ method: 'POST', url: '/api/register', payload: { username, password: PASSWORD } });
    expect(res.statusCode).toBe(201);
    if (admin) await s.pool.query('UPDATE users SET is_admin = true WHERE lower(username) = lower($1)', [username]);
    return { id: res.json<{ user: { id: number } }>().user.id, cookie: cookieOf(res) };
  }

  const get = (a: FastifyInstance, url: string, acc: Account) =>
    a.inject({ method: 'GET', url, headers: { cookie: acc.cookie } });

  /** Tisch in der DB (ohne Spiel im Speicher), für Runden mit festen Zeitpunkten. */
  async function dbTable(userId: number): Promise<number> {
    const { rows } = await s.pool.query<{ id: number }>(
      `INSERT INTO tables (created_by, name, is_public, invite_code, starting_stack, small_blind, big_blind,
                           blind_structure)
       VALUES ($1, 'Alt', true, 'code', 1000, 10, 20, '{"type":"fixed"}') RETURNING id`,
      [userId],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('kein Tisch');
    return id;
  }

  async function round(tableId: number, startedAt: string, status: 'running' | 'finished' | 'aborted') {
    await s.pool.query(
      `INSERT INTO rounds (table_id, started_at, status, finished_at)
       VALUES ($1, $2, $3, CASE WHEN $3 = 'running' THEN NULL ELSE $2::timestamptz END)`,
      [tableId, startedAt, status],
    );
  }

  it('Runden heute (Europe/Berlin) und in den letzten 7 Tagen, nach Status', async () => {
    const a = start();
    const root = await register(a, 'Root', true);
    const tableId = await dbTable(root.id);
    // now = 2026-10-08 10:00 Berlin (08:00 UTC, Sommerzeit). Mitternacht Berlin = 2026-10-07 22:00 UTC.
    const now = new Date('2026-10-08T08:00:00Z');
    await round(tableId, '2026-10-07T22:30:00Z', 'finished'); // heute 00:30 Berlin
    await round(tableId, '2026-10-08T07:00:00Z', 'aborted'); // heute
    await round(tableId, '2026-10-08T07:30:00Z', 'running'); // heute, läuft
    await round(tableId, '2026-10-07T21:30:00Z', 'finished'); // gestern 23:30 Berlin
    await round(tableId, '2026-10-01T09:00:00Z', 'finished'); // vor 6 Tagen 23 h
    await round(tableId, '2026-10-01T07:00:00Z', 'finished'); // vor mehr als 7 Tagen
    await round(tableId, '2026-10-08T09:00:00Z', 'finished'); // nach `now` – zählt nicht

    expect(await countRounds(s.pool, now)).toEqual({
      today: { started: 3, finished: 1, aborted: 1, running: 1 },
      week: { started: 5, finished: 3, aborted: 1, running: 1 },
    });
    // Ohne Runden: alles 0 (keine NULL-Zeile).
    await s.pool.query('TRUNCATE rounds CASCADE');
    expect(await countRounds(s.pool, now)).toEqual({
      today: { started: 0, finished: 0, aborted: 0, running: 0 },
      week: { started: 0, finished: 0, aborted: 0, running: 0 },
    });
  });

  it('Übersicht und Tischliste: Tische im Speicher, Spieler online, Feedback neu, Health', async () => {
    const a = start();
    const url = await listen(a);
    const root = await register(a, 'Root', true);
    const bob = await register(a, 'Bob');
    const carol = await register(a, 'Carol');
    await register(a, 'Dora'); // nicht verbunden
    const [cb, cc] = [await connect(url, bob), await connect(url, carol)];

    cb.send({
      type: 'table.create',
      settings: {
        name: 'Dashboardtisch',
        startingStack: 2000,
        blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
      },
    });
    const { tableId } = await cb.next<TableCreated>((m) => m.type === 'table.created');
    for (const [seat, cl] of [cb, cc].entries()) {
      cl.send({ type: 'table.join', tableId });
      cl.send({ type: 'table.sit', tableId, seat });
      await cl.nextState((t) => t.you.seat === seat);
    }
    cb.send({ type: 'table.start', tableId });
    await cb.nextState((t) => t.round !== null);
    await s.pool.query(
      `INSERT INTO feedback (user_id, category, message, status, done_at)
       VALUES ($1, 'bug', 'a', 'new', NULL), ($1, 'idea', 'b', 'new', NULL), ($1, 'other', 'c', 'done', now())`,
      [bob.id],
    );

    const res = await get(a, '/api/admin/overview', root);
    expect(res.statusCode).toBe(200);
    const { overview } = res.json<{ overview: AdminOverview }>();
    expect(overview).toMatchObject({
      tables: { total: 1, open: 0, running: 1, seatedPlayers: 2 },
      onlineUsers: 2,
      feedbackNew: 2,
      rounds: {
        today: { started: 1, running: 1 },
        week: { started: 1, running: 1 },
        timeZone: 'Europe/Berlin',
        weekDays: 7,
      },
      health: { db: 'ok', nodeVersion: process.version },
    });
    expect(overview.health.dbLatencyMs).toEqual(expect.any(Number));
    expect(overview.health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(overview.health.memoryMb).toBeGreaterThan(0);

    const list = await get(a, '/api/admin/tables', root);
    expect(list.statusCode).toBe(200);
    const { tables } = list.json<{ tables: AdminTable[] }>();
    expect(tables).toEqual([
      {
        id: tableId,
        name: 'Dashboardtisch',
        isPublic: true,
        status: 'running',
        createdBy: { id: bob.id, username: 'Bob' },
        maxSeats: 9,
        players: [
          { seat: 0, id: bob.id, username: 'Bob', connected: true },
          { seat: 1, id: carol.id, username: 'Carol', connected: true },
        ],
        watchers: 2,
        roundId: expect.any(Number) as number,
        handNumber: expect.any(Number) as number,
      },
    ]);
    // Keine Einladungscodes in der Admin-Liste.
    expect(list.body).not.toContain('inviteCode');

    // Carol trennt sich: am Tisch nicht mehr verbunden, nicht mehr online.
    cc.close();
    await expect
      .poll(async () => (await get(a, '/api/admin/overview', root)).json<{ overview: AdminOverview }>().overview)
      .toMatchObject({ onlineUsers: 1 });
    const after = (await get(a, '/api/admin/tables', root)).json<{ tables: AdminTable[] }>().tables;
    expect(after[0]?.players.map((p) => p.connected)).toEqual([true, false]);
  }, 30_000);

  it('Übersicht ohne Datenbank: 200 mit Health-Fehler statt 500', async () => {
    const a = start();
    const root = await register(a, 'Root', true);
    const failing = createPgDatabase({ ...s.config, max: 1 });
    await failing.close();
    // Mit kaputter DB scheitert schon die Session-Prüfung des Guards – deshalb direkt die Kernfunktion prüfen.
    const warnings: string[] = [];
    const overview = await loadOverview({
      db: failing,
      log: { warn: (_obj, msg) => warnings.push(msg) },
      game: a.game,
      onlineUserIds: () => new Set([root.id]),
    });
    expect(overview).toMatchObject({
      onlineUsers: 1,
      rounds: null,
      feedbackNew: null,
      health: { db: 'error', dbLatencyMs: null },
    });
    expect(warnings).toEqual(['Admin-Übersicht: Datenbank nicht erreichbar']);
  });
});
