// Admin deckt Karten auf (WP-033, D-027) gegen die Test-DB (nur mit TEST_DATABASE_URL, sonst übersprungen): echte
// Sessions, Admin-Flag aus der DB, Eintrag `table.reveal_cards` im Admin-Protokoll, Rechteentzug greift sofort.
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
import type { AuditEntry } from './audit';
import { recordCardReveal } from './reveal';

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

type AdminCards = Extract<ServerMessage, { type: 'admin.cards' }>;

describe.skipIf(testDatabaseUrl === undefined)('Admin: Karten aufdecken (Test-DB)', () => {
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
      `TRUNCATE users, sessions, tables, rounds, round_players, hands, hand_actions, admin_audit_log
       RESTART IDENTITY CASCADE`,
    );
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    clients = [];
    await app?.close();
    app = undefined;
  });

  async function start(): Promise<{ a: FastifyInstance; url: string }> {
    const a = buildApp({
      db: createPgDatabase({ ...s.config, max: 3 }),
      publicOrigin: ORIGIN,
      auth: AUTH,
      game: { handPauseMs: 60_000, rng: createSeededRng(21) },
    });
    app = a;
    await a.listen({ host: '127.0.0.1', port: 0 });
    return { a, url: `ws://127.0.0.1:${String((a.server.address() as AddressInfo).port)}/ws` };
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

  async function connect(url: string, acc: Account): Promise<TestClient> {
    const c = await TestClient.connect(url, ORIGIN, acc.cookie, acc.id);
    clients.push(c);
    return c;
  }

  async function audit(a: FastifyInstance, admin: Account): Promise<AuditEntry[]> {
    const res = await a.inject({ method: 'GET', url: '/api/admin/audit', headers: { cookie: admin.cookie } });
    expect(res.statusCode).toBe(200);
    return res.json<{ entries: AuditEntry[] }>().entries;
  }

  /** Admin auf Sitz 0, Spielerin auf Sitz 4; Runde gestartet. */
  async function running() {
    const { a, url } = await start();
    const adminAcc = await register(a, 'chefin', true);
    const playerAcc = await register(a, 'spieler');
    const admin = await connect(url, adminAcc);
    const player = await connect(url, playerAcc);
    expect(admin.messages[0]).toMatchObject({ type: 'welcome', isAdmin: true });
    expect(player.messages[0]).toMatchObject({ type: 'welcome', isAdmin: false });
    admin.send({ type: 'table.create', settings: { name: 'Aufdecken' } });
    const id = (await admin.next<Extract<ServerMessage, { type: 'table.created' }>>((m) => m.type === 'table.created'))
      .tableId;
    admin.send({ type: 'table.sit', tableId: id, seat: 0 });
    await admin.nextState((t) => t.seats.length === 1);
    player.send({ type: 'table.join', tableId: id });
    player.send({ type: 'table.sit', tableId: id, seat: 4 });
    await player.nextState((t) => t.seats.length === 2);
    admin.send({ type: 'table.start', tableId: id });
    await admin.nextState((t) => t.round?.hand?.phase === 'betting');
    await player.nextState((t) => t.round?.hand?.phase === 'betting');
    return { a, adminAcc, playerAcc, admin, player, id };
  }

  it('Aufdecken: Karten an den Admin, Eintrag im Admin-Protokoll, einmal pro Hand und Platz', async () => {
    const { a, adminAcc, playerAcc, admin, player, id } = await running();
    admin.send({ type: 'admin.revealCards', tableId: id, seat: 4, requestId: 'r' });
    const cards = await admin.next<AdminCards>((m) => m.type === 'admin.cards');
    const real = a.game.getTable(id)?.round?.hand?.players.find((p) => p.id === String(playerAcc.id))?.holeCards;
    expect(cards).toMatchObject({ requestId: 'r', tableId: id, handNumber: 1, seat: 4 });
    expect(cards.cards).toEqual(real);
    admin.send({ type: 'admin.revealCards', tableId: id, seat: 4 });
    await admin.next((m) => m.type === 'admin.cards');

    const entries = await audit(a, adminAcc);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'table.reveal_cards',
      source: 'ws',
      admin: { id: adminAcc.id, username: 'chefin' },
      targetUser: { id: playerAcc.id, username: 'spieler' },
      targetTableId: id,
      details: { roundId: 1, handNumber: 1, seat: 4 },
    });
    // Die Mitspielerin hat davon nichts mitbekommen.
    expect(player.messages.some((m) => m.type === 'admin.cards')).toBe(false);
    expect(JSON.stringify(player.messages)).not.toContain('reveal');
  });

  it('Nicht-Admin → FORBIDDEN, nichts protokolliert', async () => {
    const { a, adminAcc, player, id } = await running();
    player.send({ type: 'admin.revealCards', tableId: id, seat: 0 });
    expect(await player.nextError()).toMatchObject({ code: 'FORBIDDEN', tableId: id });
    expect(await audit(a, adminAcc)).toEqual([]);
  });

  it('Admin-Flag entzogen (offene Verbindung mit alter Session) → FORBIDDEN, nichts protokolliert', async () => {
    const { adminAcc, admin, id } = await running();
    await s.pool.query('UPDATE users SET is_admin = false WHERE id = $1', [adminAcc.id]);
    admin.send({ type: 'admin.revealCards', tableId: id, seat: 4 });
    expect(await admin.nextError()).toMatchObject({ code: 'FORBIDDEN' });
    expect(admin.messages.some((m) => m.type === 'admin.cards')).toBe(false);
    const { rows } = await s.pool.query('SELECT count(*)::int AS n FROM admin_audit_log');
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('recordCardReveal: schreibt nur für aktive Admins', async () => {
    const { a } = await start();
    const adminAcc = await register(a, 'chefin', true);
    const other = await register(a, 'andere');
    const { rows: t } = await s.pool.query<{ id: number }>(
      `INSERT INTO tables (name, created_by, invite_code, is_public, max_seats, starting_stack, small_blind, big_blind,
                           blind_structure, turn_time_seconds, time_bank_seconds)
       VALUES ('T', $1, 'code', true, 9, 1500, 10, 20, '{"type":"fixed","level":{"smallBlind":10,"bigBlind":20}}', 20, 60)
       RETURNING id`,
      [adminAcc.id],
    );
    const tableId = t[0]?.id ?? 0;
    const entry = { tableId, targetUserId: other.id, roundId: 7, handNumber: 3, seat: 2 };
    expect(await recordCardReveal(s.pool, { ...entry, adminId: other.id })).toBe(false);
    expect(await recordCardReveal(s.pool, { ...entry, adminId: adminAcc.id })).toBe(true);
    await s.pool.query('UPDATE users SET banned_at = now() WHERE id = $1', [adminAcc.id]);
    expect(await recordCardReveal(s.pool, { ...entry, adminId: adminAcc.id })).toBe(false);
    const { rows } = await s.pool.query(
      'SELECT admin_id, action, target_user_id, target_table_id, details, source FROM admin_audit_log',
    );
    expect(rows).toEqual([
      {
        admin_id: adminAcc.id,
        action: 'table.reveal_cards',
        target_user_id: other.id,
        target_table_id: tableId,
        details: { roundId: 7, handNumber: 3, seat: 2 },
        source: 'ws',
      },
    ]);
  });
});
