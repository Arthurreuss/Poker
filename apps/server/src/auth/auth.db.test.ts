// Integrationstests der Auth-Endpunkte gegen die Test-DB (nur mit TEST_DATABASE_URL, sonst übersprungen).
import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { createPgDatabase } from '../db';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import type { SessionRow, UserRow } from '../db/types';
import { resetPassword, setAdmin } from './admin';
import type { AuthConfig } from './config';
import { SESSION_COOKIE, getUserFromCookieHeader, hashSessionToken } from './session';

const DEV: AuthConfig = {
  secureCookies: false,
  trustCfConnectingIp: false,
  sessionTtlMs: 30 * 86_400_000,
  rateLimit: null,
};
const PROD: AuthConfig = { ...DEV, secureCookies: true, trustCfConnectingIp: true };
const PASSWORD = 'richtig-geheim';

describe.skipIf(testDatabaseUrl === undefined)('Auth-Endpunkte (Test-DB)', () => {
  let s: TestSchema;
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    s = await createTestSchema(testDatabaseUrl ?? '');
    await runMigrations(s.config);
  });

  afterAll(async () => {
    await s.drop();
  });

  beforeEach(async () => {
    await s.pool.query('TRUNCATE users, sessions RESTART IDENTITY CASCADE');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function start(auth: AuthConfig = DEV, logger: Parameters<typeof buildApp>[0]['logger'] = false): FastifyInstance {
    app = buildApp({
      db: createPgDatabase({ ...s.config, max: 2 }),
      publicOrigin: 'http://localhost:4310',
      auth,
      logger,
    });
    return app;
  }

  function post(a: FastifyInstance, url: string, payload?: object, headers: Record<string, string> = {}) {
    return a.inject({ method: 'POST', url, headers, ...(payload === undefined ? {} : { payload }) });
  }

  function sessionCookie(res: LightMyRequestResponse) {
    return res.cookies.find((c) => c.name === SESSION_COOKIE);
  }

  /** Cookie-Header für Folgeanfragen. */
  function cookieHeader(res: LightMyRequestResponse): string {
    const cookie = sessionCookie(res);
    if (cookie === undefined) throw new Error('kein Session-Cookie gesetzt');
    return `${SESSION_COOKIE}=${cookie.value}`;
  }

  function me(a: FastifyInstance, cookie?: string) {
    return a.inject({ method: 'GET', url: '/api/me', headers: cookie === undefined ? {} : { cookie } });
  }

  async function register(a: FastifyInstance, username = 'Alice', password = PASSWORD) {
    const res = await post(a, '/api/register', { username, password });
    expect(res.statusCode).toBe(201);
    return res;
  }

  describe('POST /api/register', () => {
    it('legt den User an und loggt direkt ein', async () => {
      const a = start();
      const res = await register(a);

      expect(res.json()).toEqual({ user: { id: 1, username: 'Alice', isAdmin: false } });
      const meRes = await me(a, cookieHeader(res));
      expect(meRes.statusCode).toBe(200);
      expect(meRes.json()).toEqual({ user: { id: 1, username: 'Alice', isAdmin: false } });
    });

    it('speichert argon2id-Hash statt Klartext und nur den SHA-256 des Tokens', async () => {
      const res = await register(start());
      const token = sessionCookie(res)?.value ?? '';

      const { rows: users } = await s.pool.query<UserRow>('SELECT * FROM users');
      expect(users[0]?.password_hash).toMatch(/^\$argon2id\$/);
      expect(users[0]?.password_hash).not.toContain(PASSWORD);
      const { rows: sessions } = await s.pool.query<SessionRow>('SELECT * FROM sessions');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.token_hash.equals(hashSessionToken(token))).toBe(true);
      expect(sessions[0]?.token_hash.toString('base64url')).not.toBe(token);
      const ttl = (sessions[0]?.expires_at.getTime() ?? 0) - Date.now();
      expect(ttl).toBeGreaterThan(29 * 86_400_000);
      expect(ttl).toBeLessThanOrEqual(30 * 86_400_000);
    });

    it('lehnt einen vergebenen Namen in anderer Schreibweise mit 409 ab', async () => {
      const a = start();
      await register(a, 'Alice');
      const res = await post(a, '/api/register', { username: 'aLiCe', password: PASSWORD });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'username_taken' });
      expect(sessionCookie(res)).toBeUndefined();
    });

    it.each([
      ['zu kurzer Name', { username: 'ab', password: PASSWORD }],
      ['zu langer Name', { username: 'a'.repeat(21), password: PASSWORD }],
      ['ungültige Zeichen', { username: 'Al ice', password: PASSWORD }],
      ['zu kurzes Passwort', { username: 'alice', password: '1234567' }],
      ['zu langes Passwort', { username: 'alice', password: 'x'.repeat(129) }],
      ['fehlendes Passwort', { username: 'alice' }],
      ['falscher Typ', { username: 'alice', password: 12345678 }],
    ])('antwortet 400 bei %s', async (_case, payload) => {
      const res = await post(start(), '/api/register', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string; message: string }>()).toMatchObject({ error: 'invalid_request' });
      expect(res.json<{ message: string }>().message).not.toBe('');
      const { rows } = await s.pool.query('SELECT 1 FROM users');
      expect(rows).toHaveLength(0);
    });

    it('antwortet 400 bei kaputtem JSON', async () => {
      const res = await start().inject({
        method: 'POST',
        url: '/api/register',
        headers: { 'content-type': 'application/json' },
        payload: '{"username":',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_request' });
    });
  });

  describe('POST /api/login', () => {
    it('loggt mit richtigem Passwort ein (Name case-insensitive)', async () => {
      const a = start();
      await register(a, 'Alice');
      const res = await post(a, '/api/login', { username: 'alice', password: PASSWORD });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: { id: 1, username: 'Alice', isAdmin: false } });
      expect((await me(a, cookieHeader(res))).statusCode).toBe(200);
    });

    it('antwortet bei falschem Passwort und unbekanntem Namen identisch mit 401', async () => {
      const a = start();
      await register(a, 'Alice');
      const wrong = await post(a, '/api/login', { username: 'Alice', password: 'falsch-falsch' });
      const unknown = await post(a, '/api/login', { username: 'Bob', password: 'falsch-falsch' });
      const invalidName = await post(a, '/api/login', { username: 'a', password: 'falsch-falsch' });

      for (const res of [wrong, unknown, invalidName]) {
        expect(res.statusCode).toBe(401);
        expect(sessionCookie(res)).toBeUndefined();
      }
      expect(unknown.body).toBe(wrong.body);
      expect(invalidName.body).toBe(wrong.body);
      expect(wrong.json()).toEqual({ error: 'invalid_credentials', message: 'Benutzername oder Passwort ist falsch' });
    });

    it('prüft auch bei unbekanntem Namen einen argon2-Hash (ähnliche Laufzeit)', async () => {
      const a = start();
      await register(a, 'Alice');
      const timed = async (username: string) => {
        const t0 = performance.now();
        await post(a, '/api/login', { username, password: 'falsch-falsch' });
        return performance.now() - t0;
      };
      await timed('Bob'); // Dummy-Hash einmal erzeugen
      const median = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;
      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < 5; i++) {
        known.push(await timed('Alice'));
        unknown.push(await timed('Bob'));
      }
      // Ohne Dummy-Hash wäre „unbekannt“ um Größenordnungen schneller (nur eine DB-Abfrage).
      expect(median(unknown)).toBeGreaterThan(median(known) * 0.5);
    });

    it('antwortet 400 bei fehlenden Feldern', async () => {
      const res = await post(start(), '/api/login', { username: 'Alice' });
      expect(res.statusCode).toBe(400);
    });

    it('findet gelöschte (anonymisierte) Accounts nicht', async () => {
      const a = start();
      await register(a, 'Alice');
      // Gelöschte Accounts sind anonymisiert (WP-022, Constraint aus 0005): kein Name, kein Hash mehr.
      await s.pool.query('UPDATE users SET username = NULL, password_hash = NULL, deleted_at = now()');
      const res = await post(a, '/api/login', { username: 'Alice', password: PASSWORD });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/me und POST /api/logout', () => {
    it('antwortet 401 ohne Cookie und mit unbekanntem Token', async () => {
      const a = start();
      expect((await me(a)).statusCode).toBe(401);
      expect((await me(a)).json()).toEqual({ error: 'unauthorized', message: 'Nicht angemeldet' });
      expect((await me(a, `${SESSION_COOKIE}=${'x'.repeat(43)}`)).statusCode).toBe(401);
      expect((await me(a, `${SESSION_COOKIE}=kaputt`)).statusCode).toBe(401);
    });

    it('Logout löscht die Session und das Cookie; das alte Token gilt nicht mehr', async () => {
      const a = start();
      const cookie = cookieHeader(await register(a));
      const res = await a.inject({ method: 'POST', url: '/api/logout', headers: { cookie } });

      expect(res.statusCode).toBe(204);
      const cleared = sessionCookie(res);
      expect(cleared?.value).toBe('');
      expect(cleared?.expires?.getTime()).toBeLessThan(Date.now());
      expect((await me(a, cookie)).statusCode).toBe(401);
      const { rows } = await s.pool.query('SELECT 1 FROM sessions');
      expect(rows).toHaveLength(0);
    });

    it('Logout ohne Session antwortet trotzdem 204', async () => {
      const res = await post(start(), '/api/logout');
      expect(res.statusCode).toBe(204);
    });

    it('eine abgelaufene Session ergibt 401', async () => {
      const a = start();
      const cookie = cookieHeader(await register(a));
      await s.pool.query(
        "UPDATE sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 second'",
      );
      const res = await me(a, cookie);
      expect(res.statusCode).toBe(401);
      expect(sessionCookie(res)?.value).toBe('');
    });

    it('beim nächsten Login werden abgelaufene Sessions des Users aufgeräumt', async () => {
      const a = start();
      await register(a);
      await s.pool.query(
        "UPDATE sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 second'",
      );
      await post(a, '/api/login', { username: 'Alice', password: PASSWORD });
      const { rows } = await s.pool.query<SessionRow>('SELECT * FROM sessions');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Cookie-Flags', () => {
    it('dev: httpOnly, SameSite=Lax, Path=/, ohne Secure', async () => {
      const cookie = sessionCookie(await register(start(DEV)));
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
      expect(cookie?.secure).toBeUndefined();
      expect(cookie?.expires?.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    });

    it('prod: zusätzlich Secure', async () => {
      const cookie = sessionCookie(await register(start(PROD)));
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', secure: true });
    });
  });

  describe('Rate-Limit', () => {
    it('greift nach N Login-Versuchen pro IP', async () => {
      const a = start({ ...DEV, rateLimit: { max: 3, windowMs: 60_000 } });
      const attempt = (remoteAddress: string) =>
        a.inject({
          method: 'POST',
          url: '/api/login',
          remoteAddress,
          payload: { username: 'x', password: 'falsch-falsch' },
        });
      for (let i = 0; i < 3; i++) expect((await attempt('192.0.2.1')).statusCode).toBe(401);
      const limited = await attempt('192.0.2.1');
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ error: 'rate_limited' });
      expect((await attempt('192.0.2.2')).statusCode).toBe(401);
    });

    it('gilt auch für die Registrierung', async () => {
      const a = start({ ...DEV, rateLimit: { max: 1, windowMs: 60_000 } });
      expect((await post(a, '/api/register', { username: 'a' })).statusCode).toBe(400);
      expect((await post(a, '/api/register', { username: 'Alice', password: PASSWORD })).statusCode).toBe(429);
    });

    it('nutzt in prod CF-Connecting-IP als Schlüssel', async () => {
      const a = start({ ...PROD, rateLimit: { max: 2, windowMs: 60_000 } });
      const attempt = (ip: string) =>
        post(a, '/api/login', { username: 'x', password: 'falsch-falsch' }, { 'cf-connecting-ip': ip });
      expect((await attempt('203.0.113.1')).statusCode).toBe(401);
      expect((await attempt('203.0.113.1')).statusCode).toBe(401);
      expect((await attempt('203.0.113.1')).statusCode).toBe(429);
      expect((await attempt('203.0.113.2')).statusCode).toBe(401);
    });

    it('ignoriert CF-Connecting-IP in dev (sonst ließe sich das Limit umgehen)', async () => {
      const a = start({ ...DEV, rateLimit: { max: 1, windowMs: 60_000 } });
      const attempt = (ip: string) =>
        post(a, '/api/login', { username: 'x', password: 'falsch-falsch' }, { 'cf-connecting-ip': ip });
      expect((await attempt('203.0.113.1')).statusCode).toBe(401);
      expect((await attempt('203.0.113.2')).statusCode).toBe(429);
    });
  });

  it('schreibt Passwörter und Session-Token nie ins Log', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const a = start(DEV, { level: 'trace', stream });
    const token = sessionCookie(await register(a, 'Alice'))?.value ?? '';
    await post(a, '/api/login', { username: 'Alice', password: 'falsch-falsch' });
    await post(a, '/api/register', { username: 'Alice', password: PASSWORD });
    await me(a, `${SESSION_COOKIE}=${token}`);

    const log = lines.join('');
    expect(log).toContain('/api/register');
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain('falsch-falsch');
    expect(log).not.toContain(token);
  });

  describe('getUserFromCookieHeader (für das WebSocket-Upgrade)', () => {
    it('löst den User aus einem rohen Cookie-Header auf', async () => {
      const a = start();
      const token = sessionCookie(await register(a))?.value ?? '';
      const db = createPgDatabase(s.config);
      try {
        expect(await getUserFromCookieHeader(db, `theme=dark; ${SESSION_COOKIE}=${token}`)).toEqual({
          id: 1,
          username: 'Alice',
          isAdmin: false,
        });
        expect(await getUserFromCookieHeader(db, undefined)).toBeNull();
        expect(await getUserFromCookieHeader(db, 'theme=dark')).toBeNull();
        await s.pool.query(
          "UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'",
        );
        expect(await getUserFromCookieHeader(db, `${SESSION_COOKIE}=${token}`)).toBeNull();
      } finally {
        await db.close();
      }
    });
  });

  describe('Admin-Funktionen (CLI)', () => {
    it('resetPassword setzt ein neues Passwort und beendet alle Sessions', async () => {
      const a = start();
      const cookie = cookieHeader(await register(a, 'Alice'));

      expect(await resetPassword(s.pool, 'alice', 'neues-passwort')).toBe(true);

      expect((await me(a, cookie)).statusCode).toBe(401);
      expect((await post(a, '/api/login', { username: 'Alice', password: PASSWORD })).statusCode).toBe(401);
      expect((await post(a, '/api/login', { username: 'Alice', password: 'neues-passwort' })).statusCode).toBe(200);
    });

    it('resetPassword meldet unbekannte User und lehnt zu kurze Passwörter ab', async () => {
      await register(start(), 'Alice');
      expect(await resetPassword(s.pool, 'Bob', 'neues-passwort')).toBe(false);
      await expect(resetPassword(s.pool, 'Alice', 'kurz')).rejects.toThrow(/mindestens 8/);
    });

    it('setAdmin setzt das Admin-Flag (sichtbar in /api/me)', async () => {
      const a = start();
      const cookie = cookieHeader(await register(a, 'Alice'));
      expect(await setAdmin(s.pool, 'ALICE', true)).toBe(true);
      expect((await me(a, cookie)).json()).toEqual({ user: { id: 1, username: 'Alice', isAdmin: true } });
      expect(await setAdmin(s.pool, 'Bob', true)).toBe(false);
    });
  });
});
