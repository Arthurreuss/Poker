// Integrationstests „Konto löschen“ (WP-022) gegen die Test-DB (nur mit TEST_DATABASE_URL, sonst übersprungen):
// DELETE /api/me mit Passwort-Bestätigung, Anonymisierung, Sessions, WebSocket, Hand-Historie anderer Spieler.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeededRng } from '@poker/engine';
import type { ServerMessage } from '@poker/engine/protocol';
import { buildApp } from '../app';
import { createPgDatabase } from '../db';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import type { RoundPlayerRow, UserRow } from '../db/types';
import { TestClient, attachBot } from '../game/ws-test-client';
import { CLOSE_ACCOUNT_DELETED } from '../ws';
import { DELETED_USER_NAME, anonymizeAccount, displayNameSql } from './account';
import type { AuthConfig } from './config';
import { SESSION_COOKIE } from './session';

const ORIGIN = 'http://localhost:4310';
const AUTH: AuthConfig = {
  secureCookies: false,
  trustCfConnectingIp: false,
  sessionTtlMs: 86_400_000,
  rateLimit: null,
};
const PASSWORD = 'richtig-geheim';
const CHECK_VIOLATION = '23514';

interface Account {
  id: number;
  cookie: string;
}

describe.skipIf(testDatabaseUrl === undefined)('Konto löschen (Test-DB)', () => {
  let s: TestSchema;
  let app: FastifyInstance | undefined;
  let clients: TestClient[] = [];

  beforeAll(async () => {
    s = await createTestSchema(testDatabaseUrl ?? '');
    await runMigrations(s.config);
    // Stellvertreter für die Feedback-Tabelle aus WP-024 (gleiche Verweis-Art), damit der Lösch-Weg sie mitnimmt.
    await s.pool.query(`CREATE TABLE feedback (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id integer REFERENCES users (id) ON DELETE SET NULL,
      text text NOT NULL)`);
  });

  afterAll(async () => {
    await s.drop();
  });

  beforeEach(async () => {
    await s.pool.query(
      'TRUNCATE users, sessions, tables, rounds, round_players, hands, hand_actions, feedback RESTART IDENTITY CASCADE',
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
      game: { handPauseMs: 0, disconnectGraceMs: 0, rng: createSeededRng(7) },
    });
    return app;
  }

  function cookieOf(res: LightMyRequestResponse): string {
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (cookie === undefined) throw new Error('kein Session-Cookie');
    return `${SESSION_COOKIE}=${cookie.value}`;
  }

  async function register(a: FastifyInstance, username: string): Promise<Account> {
    const res = await a.inject({ method: 'POST', url: '/api/register', payload: { username, password: PASSWORD } });
    expect(res.statusCode).toBe(201);
    return { id: res.json<{ user: { id: number } }>().user.id, cookie: cookieOf(res) };
  }

  async function login(a: FastifyInstance, username: string, password = PASSWORD) {
    return a.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
  }

  function deleteAccount(a: FastifyInstance, cookie: string | undefined, payload: object | undefined) {
    return a.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: cookie === undefined ? {} : { cookie },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function userRow(id: number): Promise<UserRow | undefined> {
    return (await s.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])).rows[0];
  }

  async function sessionCount(id: number): Promise<number> {
    const { rows } = await s.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [
      id,
    ]);
    return rows[0]?.n ?? -1;
  }

  it('ohne Session 401, ohne Passwort 400, falsches Passwort 403 – Konto bleibt unverändert', async () => {
    const a = start();
    const alice = await register(a, 'Alice');

    expect((await deleteAccount(a, undefined, { password: PASSWORD })).statusCode).toBe(401);
    const missing = await deleteAccount(a, alice.cookie, {});
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'invalid_request' });
    const wrong = await deleteAccount(a, alice.cookie, { password: 'falsches-passwort' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ error: 'invalid_credentials' });

    expect(await userRow(alice.id)).toMatchObject({ username: 'Alice', deleted_at: null });
    const me = await a.inject({ method: 'GET', url: '/api/me', headers: { cookie: alice.cookie } });
    expect(me.statusCode).toBe(200);
  });

  it('anonymisiert den Account, löscht alle Sessions, gibt den Namen frei und lässt andere Accounts in Ruhe', async () => {
    const a = start();
    const alice = await register(a, 'Alice');
    const bob = await register(a, 'Bob');
    // Zweite Session (anderes Gerät) und Admin-Recht – beides muss weg.
    expect((await login(a, 'alice')).statusCode).toBe(200);
    await s.pool.query('UPDATE users SET is_admin = true WHERE id = $1', [alice.id]);
    await s.pool.query('INSERT INTO feedback (user_id, text) VALUES ($1, $2), ($3, $4)', [
      alice.id,
      'Idee von Alice',
      bob.id,
      'Bug von Bob',
    ]);
    expect(await sessionCount(alice.id)).toBe(2);

    const res = await deleteAccount(a, alice.cookie, { password: PASSWORD });
    expect(res.statusCode).toBe(204);
    const cleared = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cleared?.value).toBe('');

    const row = await userRow(alice.id);
    expect(row).toMatchObject({ id: alice.id, username: null, password_hash: null, is_admin: false });
    expect(row?.deleted_at).toBeInstanceOf(Date);
    expect(await sessionCount(alice.id)).toBe(0);
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: { cookie: alice.cookie } })).statusCode).toBe(401);
    expect((await login(a, 'Alice')).statusCode).toBe(401);

    // Feedback bleibt, ist aber nicht mehr dem Account zugeordnet; fremdes Feedback unverändert.
    const { rows: feedback } = await s.pool.query<{ user_id: number | null; text: string }>(
      'SELECT user_id, text FROM feedback ORDER BY id',
    );
    expect(feedback).toEqual([
      { user_id: null, text: 'Idee von Alice' },
      { user_id: bob.id, text: 'Bug von Bob' },
    ]);

    // Bob ist nicht betroffen.
    expect(await userRow(bob.id)).toMatchObject({ username: 'Bob', deleted_at: null });
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: { cookie: bob.cookie } })).statusCode).toBe(200);

    // Der Name ist wieder frei (neuer Account, neue ID).
    const again = await register(a, 'alice');
    expect(again.id).not.toBe(alice.id);

    // Zweiter Aufruf auf den schon anonymisierten Account ist ein No-Op.
    expect(await anonymizeAccount(s.pool, alice.id)).toBe(false);
  });

  it('DB-Bedingung: ein gelöschter Account kann keinen Namen, Hash oder Adminrechte behalten', async () => {
    const a = start();
    const alice = await register(a, 'Alice');
    await expect(s.pool.query('UPDATE users SET deleted_at = now() WHERE id = $1', [alice.id])).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
    await expect(
      s.pool.query('UPDATE users SET username = NULL, password_hash = NULL, is_admin = true, deleted_at = now()'),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('während einer laufenden Runde: Verbindung wird getrennt, die Runde läuft weiter, die Historie bleibt konsistent', async () => {
    const a = start();
    await a.listen({ host: '127.0.0.1', port: 0 });
    const url = `ws://127.0.0.1:${String((a.server.address() as AddressInfo).port)}/ws`;
    const accounts = [await register(a, 'Alice'), await register(a, 'Bob'), await register(a, 'Carol')];
    const [alice, bob, carol] = accounts as [Account, Account, Account];
    const [ca, cb, cc] = await Promise.all(
      accounts.map(async (acc) => {
        const c = await TestClient.connect(url, ORIGIN, acc.cookie, acc.id);
        clients.push(c);
        return c;
      }),
    );
    if (ca === undefined || cb === undefined || cc === undefined) throw new Error('Client fehlt');

    cb.send({
      type: 'table.create',
      settings: {
        name: 'Löschtisch',
        startingStack: 200,
        blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
      },
    });
    const { tableId } = await cb.next<Extract<ServerMessage, { type: 'table.created' }>>(
      (m) => m.type === 'table.created',
    );
    for (const [seat, cl] of [ca, cb, cc].entries()) {
      cl.send({ type: 'table.join', tableId });
      cl.send({ type: 'table.sit', tableId, seat });
      await cl.nextState((t) => t.you.seat === seat);
    }
    attachBot(cb, tableId, 3);
    attachBot(cc, tableId, 4);
    cb.send({ type: 'table.start', tableId });
    await ca.nextState((t) => t.round !== null);

    // Alice löscht ihr Konto mitten in der Runde (z. B. aus einem zweiten Tab).
    const res = await deleteAccount(a, alice.cookie, { password: PASSWORD });
    expect(res.statusCode).toBe(204);
    await expect.poll(() => ca.closeCode, { timeout: 5_000 }).toBe(CLOSE_ACCOUNT_DELETED);

    // Ihr Sitz wird automatisch gecheckt/gefoldet (D-022); Bob und Carol spielen die Runde zu Ende.
    await cb.next((m) => m.type === 'table.roundFinished', 30_000);
    await a.game.idle();

    const { rows: players } = await s.pool.query<RoundPlayerRow>(
      'SELECT rp.* FROM round_players rp JOIN rounds r ON r.id = rp.round_id WHERE r.table_id = $1 ORDER BY seat',
      [tableId],
    );
    expect(players.map((p) => p.user_id)).toEqual([alice.id, bob.id, carol.id]);
    expect(players.every((p) => p.placement !== null && p.points !== null)).toBe(true);

    // Hände und Aktionen der Runde verweisen weiter auf Alices (anonymisierte) ID; Anzeige als „Gelöschter Spieler“.
    const { rows: actions } = await s.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM hand_actions WHERE user_id = $1',
      [alice.id],
    );
    expect(actions[0]?.n).toBeGreaterThan(0);
    const { rows: names } = await s.pool.query<{ name: string }>(
      `SELECT ${displayNameSql('u.username')} AS name
         FROM round_players rp JOIN users u ON u.id = rp.user_id JOIN rounds r ON r.id = rp.round_id
        WHERE r.table_id = $1 ORDER BY rp.seat`,
      [tableId],
    );
    expect(names.map((n) => n.name)).toEqual([DELETED_USER_NAME, 'Bob', 'Carol']);

    // Eine neue WebSocket-Verbindung mit dem alten Cookie wird abgelehnt.
    await expect(TestClient.connect(url, ORIGIN, alice.cookie, alice.id)).rejects.toThrow(/401/);
  }, 45_000);
});
