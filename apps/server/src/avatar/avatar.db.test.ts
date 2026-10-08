// Avatar (WP-032) gegen die Test-DB (nur mit TEST_DATABASE_URL): speichern über PUT /api/me/avatar, Anzeige in
// /api/me, Login, Rangliste, Profil und am Tisch (echter WebSocket), Zurücksetzen beim Löschen des Kontos.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeededRng } from '@poker/engine';
import type { TableCreatedMessage } from '@poker/engine/protocol';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import { SESSION_COOKIE } from '../auth/session';
import { createPgDatabase } from '../db';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import { TestClient } from '../game/ws-test-client';
import { toAvatarId, validateAvatarInput } from './avatar';

const ORIGIN = 'http://localhost:4310';
const AUTH: AuthConfig = {
  secureCookies: false,
  trustCfConnectingIp: false,
  sessionTtlMs: 86_400_000,
  rateLimit: null,
};
const PASSWORD = 'richtig-geheim';

describe('Avatar-Eingabe (ohne DB)', () => {
  it('akzeptiert bekannte IDs und null, sonst Fehler', () => {
    expect(validateAvatarInput({ avatar: 'fox' })).toEqual({ ok: true, avatar: 'fox' });
    expect(validateAvatarInput({ avatar: null })).toEqual({ ok: true, avatar: null });
    for (const body of [{}, null, 'fox', { avatar: 'unbekannt' }, { avatar: 3 }, { avatar: 'Fox' }]) {
      expect(validateAvatarInput(body).ok).toBe(false);
    }
  });

  it('unbekannte DB-Werte gelten als kein Avatar', () => {
    expect(toAvatarId('owl')).toBe('owl');
    expect(toAvatarId('entfernt')).toBeNull();
    expect(toAvatarId(null)).toBeNull();
  });
});

describe.skipIf(testDatabaseUrl === undefined)('Avatar (Test-DB)', () => {
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
      'TRUNCATE users, sessions, tables, rounds, round_players, hands, hand_actions RESTART IDENTITY CASCADE',
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
      game: { handPauseMs: 0, rng: createSeededRng(3) },
    });
    return app;
  }

  function cookieOf(res: LightMyRequestResponse): string {
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (cookie === undefined) throw new Error('kein Session-Cookie');
    return `${SESSION_COOKIE}=${cookie.value}`;
  }

  async function register(a: FastifyInstance, username: string): Promise<{ id: number; cookie: string }> {
    const res = await a.inject({ method: 'POST', url: '/api/register', payload: { username, password: PASSWORD } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ user: { avatar: null } });
    return { id: res.json<{ user: { id: number } }>().user.id, cookie: cookieOf(res) };
  }

  function putAvatar(a: FastifyInstance, cookie: string | undefined, payload: unknown) {
    return a.inject({
      method: 'PUT',
      url: '/api/me/avatar',
      headers: cookie === undefined ? {} : { cookie },
      payload: payload as object,
    });
  }

  it('speichert den Avatar; /api/me und Login liefern ihn; null entfernt ihn', async () => {
    const a = start();
    const alice = await register(a, 'Alice');

    const res = await putAvatar(a, alice.cookie, { avatar: 'fox' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: alice.id, username: 'Alice', isAdmin: false, avatar: 'fox' } });
    const me = await a.inject({ method: 'GET', url: '/api/me', headers: { cookie: alice.cookie } });
    expect(me.json()).toMatchObject({ user: { avatar: 'fox' } });
    const login = await a.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', password: PASSWORD },
    });
    expect(login.json()).toMatchObject({ user: { avatar: 'fox' } });

    expect((await putAvatar(a, alice.cookie, { avatar: null })).json()).toMatchObject({ user: { avatar: null } });
    const { rows } = await s.pool.query<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [
      alice.id,
    ]);
    expect(rows[0]?.avatar).toBeNull();
  });

  it('ohne Session 401, unbekannter Avatar 400 – nichts wird geändert', async () => {
    const a = start();
    const alice = await register(a, 'Alice');
    expect((await putAvatar(a, undefined, { avatar: 'fox' })).statusCode).toBe(401);
    const bad = await putAvatar(a, alice.cookie, { avatar: 'unbekannt' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'invalid_request' });
    expect((await putAvatar(a, alice.cookie, { bild: 'fox' })).statusCode).toBe(400);
    const { rows } = await s.pool.query<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [
      alice.id,
    ]);
    expect(rows[0]?.avatar).toBeNull();
  });

  it('Rangliste und Profil zeigen den Avatar', async () => {
    const a = start();
    const alice = await register(a, 'Alice');
    const bob = await register(a, 'Bob');
    await putAvatar(a, alice.cookie, { avatar: 'owl' });
    const { rows: t } = await s.pool.query<{ id: number }>(
      `INSERT INTO tables (created_by, name, is_public, invite_code, starting_stack, small_blind, big_blind,
                           blind_structure, status, closed_at)
       VALUES ($1, 'T', true, 'code1', 600, 10, 20, '{}', 'closed', now()) RETURNING id`,
      [alice.id],
    );
    const { rows: r } = await s.pool.query<{ id: number }>(
      `INSERT INTO rounds (table_id, status, finished_at) VALUES ($1, 'finished', now()) RETURNING id`,
      [t[0]?.id],
    );
    await s.pool.query(
      `INSERT INTO round_players (round_id, user_id, seat, placement, points) VALUES ($1, $2, 0, 1, 2), ($1, $3, 1, 2, 0)`,
      [r[0]?.id, alice.id, bob.id],
    );

    const board = await a.inject({ method: 'GET', url: '/api/leaderboard', headers: { cookie: bob.cookie } });
    expect(board.json<{ players: { name: string; avatar: string | null }[] }>().players).toMatchObject([
      { name: 'Alice', avatar: 'owl' },
      { name: 'Bob', avatar: null },
    ]);
    const profile = await a.inject({ method: 'GET', url: '/api/players/alice/stats', headers: { cookie: bob.cookie } });
    expect(profile.json()).toMatchObject({ player: { id: alice.id, name: 'Alice', avatar: 'owl' } });
  });

  it('Kontolöschung setzt den Avatar zurück', async () => {
    const a = start();
    const alice = await register(a, 'Alice');
    await putAvatar(a, alice.cookie, { avatar: 'rocket' });
    const del = await a.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: { cookie: alice.cookie },
      payload: { password: PASSWORD },
    });
    expect(del.statusCode).toBe(204);
    const { rows } = await s.pool.query<{ avatar: string | null; deleted_at: Date | null }>(
      'SELECT avatar, deleted_at FROM users WHERE id = $1',
      [alice.id],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();
    expect(rows[0]?.avatar).toBeNull();
  });

  it('am Tisch: Sitz zeigt den Avatar, eine Änderung kommt sofort bei allen an', async () => {
    const a = start();
    const alice = await register(a, 'Alice');
    const bob = await register(a, 'Bob');
    await putAvatar(a, alice.cookie, { avatar: 'panda' });
    await a.listen({ host: '127.0.0.1', port: 0 });
    const url = `ws://127.0.0.1:${String((a.server.address() as AddressInfo).port)}/ws`;
    const ca = await TestClient.connect(url, ORIGIN, alice.cookie, alice.id);
    const cb = await TestClient.connect(url, ORIGIN, bob.cookie, bob.id);
    clients.push(ca, cb);

    ca.send({ type: 'table.create', settings: { name: 'Avatare' } });
    const { tableId } = await ca.next<TableCreatedMessage>((m) => m.type === 'table.created');
    ca.send({ type: 'table.sit', tableId, seat: 0 });
    cb.send({ type: 'table.join', tableId });
    cb.send({ type: 'table.sit', tableId, seat: 1 });
    const seated = await ca.nextState((t) => t.seats.length === 2);
    expect(seated.table.seats.map((seat) => seat.avatar)).toEqual(['panda', null]);

    expect((await putAvatar(a, bob.cookie, { avatar: 'frog' })).statusCode).toBe(200);
    await ca.nextState((t) => t.seats[1]?.avatar === 'frog');
    await cb.nextState((t) => t.seats[1]?.avatar === 'frog');

    // Reaktion über den echten Transport: erscheint bei beiden.
    cb.send({ type: 'table.react', tableId, reaction: 'thumbs-up' });
    for (const c of [ca, cb]) {
      expect(await c.next((m) => m.type === 'table.reaction')).toEqual({
        type: 'table.reaction',
        tableId,
        seat: 1,
        userId: bob.id,
        reaction: 'thumbs-up',
      });
    }
  });
});
