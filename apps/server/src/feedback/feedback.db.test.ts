// Integrationstests der Feedback-API gegen die Test-DB (nur mit TEST_DATABASE_URL, sonst übersprungen), WP-024.
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import { setAdmin } from '../auth/admin';
import { SESSION_COOKIE } from '../auth/session';
import { createPgDatabase } from '../db';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import type { FeedbackRow } from '../db/types';
import type { FeedbackConfig } from './config';
import { formatFeedbackList } from './cli';
import { listFeedback } from './store';

const AUTH: AuthConfig = {
  secureCookies: false,
  trustCfConnectingIp: false,
  sessionTtlMs: 86_400_000,
  rateLimit: null,
};
const NO_LIMIT: FeedbackConfig = { rateLimit: null };
const PASSWORD = 'richtig-geheim';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Test';

const VALID = {
  category: 'bug',
  message: 'Der Call-Button reagiert nicht',
  page: '/table/7',
  tableId: 7,
  appVersion: 'abc1234',
  orientation: 'portrait',
};

describe.skipIf(testDatabaseUrl === undefined)('Feedback-API (Test-DB)', () => {
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
    await s.pool.query('TRUNCATE users, sessions, feedback RESTART IDENTITY CASCADE');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function start(feedback: FeedbackConfig = NO_LIMIT): FastifyInstance {
    app = buildApp({
      db: createPgDatabase({ ...s.config, max: 2 }),
      publicOrigin: 'http://localhost:4310',
      auth: AUTH,
      feedback,
    });
    return app;
  }

  /** Registriert einen User (Präfix wp024_) und liefert den Cookie-Header. */
  async function login(a: FastifyInstance, name: string, admin = false): Promise<string> {
    const username = `wp024_${name}`;
    const res = await a.inject({ method: 'POST', url: '/api/register', payload: { username, password: PASSWORD } });
    expect(res.statusCode).toBe(201);
    if (admin) expect(await setAdmin(s.pool, username, true)).toBe(true);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (cookie === undefined) throw new Error('kein Session-Cookie');
    return `${SESSION_COOKIE}=${cookie.value}`;
  }

  function send(a: FastifyInstance, cookie: string | undefined, payload: unknown) {
    return a.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { 'user-agent': UA, ...(cookie === undefined ? {} : { cookie }) },
      payload: payload as object,
    });
  }

  async function rows(): Promise<FeedbackRow[]> {
    return (await s.pool.query<FeedbackRow>('SELECT * FROM feedback ORDER BY id')).rows;
  }

  describe('POST /api/feedback', () => {
    it('speichert Feedback mit Kontext und User-Agent aus dem Header', async () => {
      const a = start();
      const cookie = await login(a, 'alice');
      const res = await send(a, cookie, { ...VALID, message: '  Der Call-Button reagiert nicht  ' });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ feedback: { id: 1, createdAt: expect.any(String) as string } });
      const [row] = await rows();
      expect(row).toMatchObject({
        user_id: 1,
        category: 'bug',
        message: 'Der Call-Button reagiert nicht',
        page: '/table/7',
        table_id: 7,
        app_version: 'abc1234',
        user_agent: UA,
        orientation: 'portrait',
        status: 'new',
      });
    });

    it('Kontext ist optional', async () => {
      const a = start();
      const cookie = await login(a, 'alice');
      const res = await send(a, cookie, { category: 'idea', message: 'Mehr Avatare' });
      expect(res.statusCode).toBe(201);
      expect((await rows())[0]).toMatchObject({ category: 'idea', page: null, table_id: null, orientation: null });
    });

    it('erlaubt genau 2000 Zeichen (Emoji zählt als ein Zeichen)', async () => {
      const a = start();
      const cookie = await login(a, 'alice');
      const res = await send(a, cookie, { category: 'other', message: '🂡'.repeat(2000) });
      expect(res.statusCode).toBe(201);
    });

    it('ohne Session → 401, nichts gespeichert', async () => {
      const a = start();
      const res = await send(a, undefined, VALID);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'unauthorized' });
      const invalid = await send(a, `${SESSION_COOKIE}=${'x'.repeat(43)}`, VALID);
      expect(invalid.statusCode).toBe(401);
      expect(await rows()).toHaveLength(0);
    });

    it.each([
      ['ungültige Kategorie', { ...VALID, category: 'lob' }],
      ['fehlende Kategorie', { message: 'x' }],
      ['zu langer Text', { ...VALID, message: 'a'.repeat(2001) }],
      ['leerer Text', { ...VALID, message: '   ' }],
      ['Text kein String', { ...VALID, message: 42 }],
      ['ungültige Ausrichtung', { ...VALID, orientation: 'diagonal' }],
      ['ungültige Tisch-ID', { ...VALID, tableId: 'abc' }],
      ['Seite kein Pfad', { ...VALID, page: 'https://example.com' }],
      ['zu lange App-Version', { ...VALID, appVersion: 'v'.repeat(101) }],
      ['kein Objekt', [1, 2]],
    ])('%s → 400', async (_name, payload) => {
      const a = start();
      const cookie = await login(a, 'alice');
      const res = await send(a, cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_request', message: expect.any(String) as string });
      expect(await rows()).toHaveLength(0);
    });

    it('Rate-Limit: 5 pro Stunde und User, andere User sind nicht betroffen', async () => {
      const a = start({ rateLimit: { max: 5, windowMs: 3_600_000 } });
      const alice = await login(a, 'alice');
      const bob = await login(a, 'bob');
      for (let i = 0; i < 5; i += 1) {
        expect((await send(a, alice, VALID)).statusCode).toBe(201);
      }
      const limited = await send(a, alice, VALID);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ error: 'rate_limited' });
      expect((await send(a, bob, VALID)).statusCode).toBe(201);
      // Ohne Session zählt nichts und es bleibt bei 401.
      expect((await send(a, undefined, VALID)).statusCode).toBe(401);
      expect(await rows()).toHaveLength(6);
    });
  });

  describe('Admin-API', () => {
    async function seed(a: FastifyInstance) {
      const alice = await login(a, 'alice');
      const admin = await login(a, 'admin', true);
      await send(a, alice, { ...VALID, message: 'erstes' });
      await send(a, alice, { category: 'idea', message: 'zweites' });
      await send(a, alice, { category: 'other', message: 'drittes' });
      return { alice, admin };
    }

    function list(a: FastifyInstance, cookie: string | undefined, query = '') {
      return a.inject({
        method: 'GET',
        url: `/api/admin/feedback${query}`,
        headers: cookie === undefined ? {} : { cookie },
      });
    }

    function patch(a: FastifyInstance, cookie: string | undefined, id: number | string, payload: unknown) {
      return a.inject({
        method: 'PATCH',
        url: `/api/admin/feedback/${String(id)}`,
        headers: cookie === undefined ? {} : { cookie },
        payload: payload as object,
      });
    }

    it('Liste: neueste zuerst, mit Benutzername, Kontext und Zählern', async () => {
      const a = start();
      const { admin } = await seed(a);
      const res = await list(a, admin);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ feedback: { message: string }[]; counts: object }>();
      expect(body.feedback.map((f) => f.message)).toEqual(['drittes', 'zweites', 'erstes']);
      expect(body.feedback[2]).toEqual({
        id: 1,
        userId: 1,
        username: 'wp024_alice',
        category: 'bug',
        message: 'erstes',
        page: '/table/7',
        tableId: 7,
        appVersion: 'abc1234',
        userAgent: UA,
        orientation: 'portrait',
        status: 'new',
        createdAt: expect.any(String) as string,
      });
      expect(body.counts).toEqual({ new: 3, read: 0, done: 0 });
    });

    it('Status ändern und nach Status filtern', async () => {
      const a = start();
      const { admin } = await seed(a);
      const res = await patch(a, admin, 2, { status: 'done' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ feedback: { id: 2, status: 'done', username: 'wp024_alice' } });
      expect((await patch(a, admin, 1, { status: 'read' })).statusCode).toBe(200);

      const done = (await list(a, admin, '?status=done')).json<{ feedback: { id: number }[]; counts: object }>();
      expect(done.feedback.map((f) => f.id)).toEqual([2]);
      expect(done.counts).toEqual({ new: 1, read: 1, done: 1 });
      const fresh = (await list(a, admin, '?status=new')).json<{ feedback: { id: number }[] }>();
      expect(fresh.feedback.map((f) => f.id)).toEqual([3]);
      const all = (await list(a, admin, '?status=all&limit=2')).json<{ feedback: { id: number }[] }>();
      expect(all.feedback.map((f) => f.id)).toEqual([3, 2]);
    });

    it('Fehler: unbekannter Status/Limit 400, unbekannte ID 404', async () => {
      const a = start();
      const { admin } = await seed(a);
      expect((await list(a, admin, '?status=offen')).statusCode).toBe(400);
      expect((await list(a, admin, '?limit=0')).statusCode).toBe(400);
      expect((await patch(a, admin, 1, { status: 'archiviert' })).statusCode).toBe(400);
      expect((await patch(a, admin, 99, { status: 'done' })).statusCode).toBe(404);
      expect((await patch(a, admin, 'abc', { status: 'done' })).statusCode).toBe(404);
    });

    it('nur Admins: ohne Session 401, normale Spieler 403', async () => {
      const a = start();
      const { alice } = await seed(a);
      expect((await list(a, undefined)).statusCode).toBe(401);
      const forbidden = await list(a, alice);
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json()).toMatchObject({ error: 'forbidden' });
      expect((await patch(a, undefined, 1, { status: 'done' })).statusCode).toBe(401);
      expect((await patch(a, alice, 1, { status: 'done' })).statusCode).toBe(403);
      expect((await rows()).every((r) => r.status === 'new')).toBe(true);
    });
  });

  describe('Account-Löschung (WP-022)', () => {
    it('harte Löschung der User-Zeile: Feedback bleibt, User und User-Agent sind weg', async () => {
      const a = start();
      const alice = await login(a, 'alice');
      const bob = await login(a, 'bob');
      await send(a, alice, VALID);
      await send(a, bob, { category: 'idea', message: 'von Bob' });

      await s.pool.query('DELETE FROM users WHERE id = 1');

      const [aliceRow, bobRow] = await rows();
      expect(aliceRow).toMatchObject({
        user_id: null,
        user_agent: null,
        message: VALID.message,
        page: '/table/7',
        table_id: 7,
        app_version: 'abc1234',
        orientation: 'portrait',
      });
      expect(bobRow).toMatchObject({ user_id: 2, user_agent: UA });
      const [, item] = await listFeedback(s.pool);
      expect(item).toMatchObject({ userId: null, username: null, userAgent: null });
    });

    it('Anonymisieren des Accounts (deleted_at): Feedback wird ebenfalls anonymisiert', async () => {
      const a = start();
      const alice = await login(a, 'alice');
      await send(a, alice, VALID);

      await s.pool.query('UPDATE users SET username = NULL, password_hash = NULL, deleted_at = now() WHERE id = 1');

      expect((await rows())[0]).toMatchObject({ user_id: null, user_agent: null, message: VALID.message });
      // Ein späteres Update des gelöschten Accounts ändert nichts mehr.
      await s.pool.query('UPDATE users SET deleted_at = now() WHERE id = 1');
      expect(await rows()).toHaveLength(1);
    });
  });

  it('CLI-Ausgabe aus echten Daten', async () => {
    const a = start();
    const alice = await login(a, 'alice');
    await send(a, alice, VALID);
    const text = formatFeedbackList(await listFeedback(s.pool, { status: 'new', limit: 20 }), 'new');
    expect(text).toContain('#1');
    expect(text).toContain('[neu]  Bug  von wp024_alice');
    expect(text).toContain('Seite /table/7 · Tisch 7 · Version abc1234 · Ausrichtung portrait');
  });
});
