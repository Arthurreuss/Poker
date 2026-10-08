// Integrationstests der Admin-Rolle (WP-028, D-029) gegen die Test-DB (nur mit TEST_DATABASE_URL, sonst übersprungen):
// Guard für alle /api/admin/*-Routen, Sperre (Sessions, WebSocket, Login), Sessions beenden, Passwort-Reset,
// Tisch schließen, Admin-Protokoll inkl. Anonymisierung bei Konto-Löschung und Löschfrist.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeededRng } from '@poker/engine';
import type { ServerMessage } from '@poker/engine/protocol';
import { buildApp } from '../app';
import { anonymizeAccount } from '../auth/account';
import { resetPassword, setAdmin } from '../auth/admin';
import type { AuthConfig } from '../auth/config';
import { SESSION_COOKIE } from '../auth/session';
import { createPgDatabase } from '../db';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import type { AdminAuditLogRow } from '../db/types';
import { TestClient, attachBot } from '../game/ws-test-client';
import { CLOSE_ACCOUNT_BANNED, CLOSE_SESSIONS_REVOKED } from '../ws';
import { purgeExpiredAudit, startAuditPurgeJob, writeAudit, type AuditEntry } from './audit';

const ORIGIN = 'http://localhost:4310';
const AUTH: AuthConfig = {
  secureCookies: false,
  trustCfConnectingIp: false,
  sessionTtlMs: 86_400_000,
  rateLimit: null,
};
const PASSWORD = 'richtig-geheim';
const DAY = 86_400_000;

interface Account {
  id: number;
  cookie: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const isMethod = (m: string): m is Method => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m);

type TableCreated = Extract<ServerMessage, { type: 'table.created' }>;
type TableClosed = Extract<ServerMessage, { type: 'table.closed' }>;

describe.skipIf(testDatabaseUrl === undefined)('Admin-Rolle (Test-DB)', () => {
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
      game: { handPauseMs: 0, disconnectGraceMs: 0, rng: createSeededRng(11) },
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
    // Direkt in der DB (ohne CLI-Protokolleintrag), damit die Tests nur ihre eigenen Einträge sehen.
    if (admin) await s.pool.query('UPDATE users SET is_admin = true WHERE lower(username) = lower($1)', [username]);
    return { id: res.json<{ user: { id: number } }>().user.id, cookie: cookieOf(res) };
  }

  function login(a: FastifyInstance, username: string, password = PASSWORD) {
    return a.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
  }

  function me(a: FastifyInstance, acc: Account) {
    return a.inject({ method: 'GET', url: '/api/me', headers: { cookie: acc.cookie } });
  }

  function call(
    a: FastifyInstance,
    method: Method,
    url: string,
    cookie: string | undefined,
    payload?: object,
  ): Promise<LightMyRequestResponse> {
    return a.inject({
      method,
      url,
      headers: cookie === undefined ? {} : { cookie },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function auditRows(): Promise<AdminAuditLogRow[]> {
    return (await s.pool.query<AdminAuditLogRow>('SELECT * FROM admin_audit_log ORDER BY id')).rows;
  }

  async function sessionCount(id: number): Promise<number> {
    const { rows } = await s.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [
      id,
    ]);
    return rows[0]?.n ?? -1;
  }

  /** Bob legt einen Tisch an, Alice und Bob setzen sich; mit `run` startet die Runde (Bots spielen). */
  async function tableWith(players: TestClient[], run: boolean): Promise<number> {
    const [creator] = players;
    if (creator === undefined) throw new Error('kein Spieler');
    creator.send({
      type: 'table.create',
      settings: {
        name: 'Admintisch',
        startingStack: 2000,
        blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
      },
    });
    const { tableId } = await creator.next<TableCreated>((m) => m.type === 'table.created');
    for (const [seat, cl] of players.entries()) {
      cl.send({ type: 'table.join', tableId });
      cl.send({ type: 'table.sit', tableId, seat });
      await cl.nextState((t) => t.you.seat === seat);
    }
    if (run) {
      creator.send({ type: 'table.start', tableId });
      await creator.nextState((t) => t.round !== null);
    }
    return tableId;
  }

  // ---------------------------------------------------------------------------
  // Guard
  // ---------------------------------------------------------------------------

  describe('Guard', () => {
    it('jede /api/admin/*-Route: ohne Session 401, Nicht-Admin 403, Admin kommt durch', async () => {
      const a = start();
      // buildApp registriert die Routen-Plugins erst bei ready() – der Hook sieht also alle Routen.
      const routes: { method: Method; url: string }[] = [];
      a.addHook('onRoute', (route) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) {
          if (!route.url.startsWith('/api/admin') || !isMethod(method)) continue;
          routes.push({ method, url: route.url });
        }
      });
      await a.ready();
      const urls = routes.map((r) => `${r.method} ${r.url}`);
      expect(urls).toEqual(
        expect.arrayContaining([
          'GET /api/admin/feedback',
          'PATCH /api/admin/feedback/:id',
          'GET /api/admin/users',
          'POST /api/admin/users/:id/ban',
          'POST /api/admin/users/:id/unban',
          'POST /api/admin/users/:id/sessions/revoke',
          'POST /api/admin/users/:id/password',
          'POST /api/admin/tables/:id/close',
          'GET /api/admin/audit',
        ]),
      );

      const alice = await register(a, 'Alice');
      const root = await register(a, 'Root', true);
      // Zusätzlich: unbekannte Admin-Pfade und kodierte Varianten.
      const targets = [
        ...routes.map((r) => ({ method: r.method, url: r.url.replace(/:id/g, String(alice.id)) })),
        { method: 'GET' as const, url: '/api/admin' },
        { method: 'GET' as const, url: '/api/admin/gibt-es-nicht' },
        { method: 'GET' as const, url: '/api/%61dmin/feedback' },
      ];
      for (const t of targets) {
        const anon = await call(a, t.method, t.url, undefined, t.method === 'GET' ? undefined : {});
        expect(anon.statusCode, `${t.method} ${t.url} ohne Session`).toBe(401);
        expect(anon.json()).toEqual({ error: 'unauthorized', message: 'Nicht angemeldet' });
        const user = await call(a, t.method, t.url, alice.cookie, t.method === 'GET' ? undefined : {});
        expect(user.statusCode, `${t.method} ${t.url} als Nicht-Admin`).toBe(403);
        expect(user.json()).toEqual({ error: 'forbidden', message: 'Nur für Admins' });
      }
      // Nichts davon hat etwas verändert.
      expect(await auditRows()).toHaveLength(0);
      expect((await me(a, alice)).statusCode).toBe(200);

      const ok = await call(a, 'GET', '/api/admin/users', root.cookie);
      expect(ok.statusCode).toBe(200);
      expect((await call(a, 'GET', '/api/admin/gibt-es-nicht', root.cookie)).statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Spieler
  // ---------------------------------------------------------------------------

  describe('Spieler', () => {
    it('Liste und Suche', async () => {
      const a = start();
      const root = await register(a, 'Root', true);
      await register(a, 'Alice');
      await register(a, 'Bob_1');
      const all = await call(a, 'GET', '/api/admin/users', root.cookie);
      expect(all.json<{ users: { username: string }[] }>().users.map((u) => u.username)).toEqual([
        'Alice',
        'Bob_1',
        'Root',
      ]);
      const found = await call(a, 'GET', '/api/admin/users?search=b_', root.cookie);
      expect(found.json()).toMatchObject({
        users: [{ username: 'Bob_1', isAdmin: false, bannedAt: null, sessions: 1 }],
      });
      expect((await call(a, 'GET', '/api/admin/users?limit=0', root.cookie)).statusCode).toBe(400);
      expect((await call(a, 'GET', '/api/admin/users/999', root.cookie)).statusCode).toBe(404);
    });

    it('Sperre beendet Sessions und WebSocket, Login meldet die Sperre, Entsperren gibt den Zugang zurück', async () => {
      const a = start();
      const url = await listen(a);
      const root = await register(a, 'Root', true);
      const alice = await register(a, 'Alice');
      expect((await login(a, 'alice')).statusCode).toBe(200); // zweites Gerät
      expect(await sessionCount(alice.id)).toBe(2);
      const ws = await connect(url, alice);

      const res = await call(a, 'POST', `/api/admin/users/${String(alice.id)}/ban`, root.cookie, {
        reason: '  Beleidigt Mitspieler  ',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ user: { id: alice.id, username: 'Alice', sessions: 0 } });
      expect(res.json<{ user: { bannedAt: string } }>().user.bannedAt).toEqual(expect.any(String));

      await expect.poll(() => ws.closeCode, { timeout: 5_000 }).toBe(CLOSE_ACCOUNT_BANNED);
      expect(await sessionCount(alice.id)).toBe(0);
      expect((await me(a, alice)).statusCode).toBe(401);
      await expect(TestClient.connect(url, ORIGIN, alice.cookie, alice.id)).rejects.toThrow(/401/);

      // Login: richtiges Passwort → 403 mit Hinweis, falsches → wie immer 401 (Sperre bleibt verborgen).
      const banned = await login(a, 'Alice');
      expect(banned.statusCode).toBe(403);
      expect(banned.json()).toMatchObject({ error: 'account_banned' });
      expect(banned.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
      expect((await login(a, 'Alice', 'falsches-passwort')).json()).toMatchObject({ error: 'invalid_credentials' });
      expect(await sessionCount(alice.id)).toBe(0);

      // Doppelt sperren → 409, nichts protokolliert.
      expect((await call(a, 'POST', `/api/admin/users/${String(alice.id)}/ban`, root.cookie)).statusCode).toBe(409);

      const unban = await call(a, 'POST', `/api/admin/users/${String(alice.id)}/unban`, root.cookie);
      expect(unban.statusCode).toBe(200);
      expect(unban.json()).toMatchObject({ user: { bannedAt: null } });
      expect((await login(a, 'Alice')).statusCode).toBe(200);
      expect((await call(a, 'POST', `/api/admin/users/${String(alice.id)}/unban`, root.cookie)).statusCode).toBe(409);

      expect(await auditRows()).toMatchObject([
        {
          admin_id: root.id,
          action: 'user.ban',
          target_user_id: alice.id,
          details: { reason: 'Beleidigt Mitspieler', sessions: 2 },
          source: 'api',
        },
        { admin_id: root.id, action: 'user.unban', target_user_id: alice.id, details: {}, source: 'api' },
      ]);
    });

    it('Sperre: nicht sich selbst, keine Admins, unbekannte User 404, Begründung geprüft', async () => {
      const a = start();
      const root = await register(a, 'Root', true);
      const other = await register(a, 'Other', true);
      const alice = await register(a, 'Alice');
      const self = await call(a, 'POST', `/api/admin/users/${String(root.id)}/ban`, root.cookie);
      expect(self.statusCode).toBe(409);
      expect(self.json()).toMatchObject({ error: 'conflict', message: 'Du kannst dich nicht selbst sperren' });
      expect((await call(a, 'POST', `/api/admin/users/${String(other.id)}/ban`, root.cookie)).statusCode).toBe(409);
      expect((await call(a, 'POST', '/api/admin/users/999/ban', root.cookie)).statusCode).toBe(404);
      expect((await call(a, 'POST', '/api/admin/users/abc/ban', root.cookie)).statusCode).toBe(404);
      const long = await call(a, 'POST', `/api/admin/users/${String(alice.id)}/ban`, root.cookie, {
        reason: 'x'.repeat(501),
      });
      expect(long.statusCode).toBe(400);
      const wrongType = await call(a, 'POST', `/api/admin/users/${String(alice.id)}/ban`, root.cookie, { reason: 5 });
      expect(wrongType.statusCode).toBe(400);
      expect((await me(a, root)).statusCode).toBe(200);
      expect((await me(a, other)).statusCode).toBe(200);
      expect((await me(a, alice)).statusCode).toBe(200);
      expect(await auditRows()).toHaveLength(0);
    });

    it('Sessions beenden: alle Sessions weg, WebSocket getrennt, protokolliert', async () => {
      const a = start();
      const url = await listen(a);
      const root = await register(a, 'Root', true);
      const alice = await register(a, 'Alice');
      const ws = await connect(url, alice);
      const res = await call(a, 'POST', `/api/admin/users/${String(alice.id)}/sessions/revoke`, root.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ revoked: 1 });
      await expect.poll(() => ws.closeCode, { timeout: 5_000 }).toBe(CLOSE_SESSIONS_REVOKED);
      expect((await me(a, alice)).statusCode).toBe(401);
      // Neu anmelden geht (keine Sperre).
      expect((await login(a, 'Alice')).statusCode).toBe(200);
      expect(await auditRows()).toMatchObject([
        { admin_id: root.id, action: 'user.sessions_revoke', target_user_id: alice.id, details: { sessions: 1 } },
      ]);
      expect((await call(a, 'POST', '/api/admin/users/999/sessions/revoke', root.cookie)).statusCode).toBe(404);
    });

    it('Passwort zurücksetzen: neues Zufallspasswort einmalig, alte Sessions und altes Passwort ungültig', async () => {
      const a = start();
      const url = await listen(a);
      const root = await register(a, 'Root', true);
      const alice = await register(a, 'Alice');
      const ws = await connect(url, alice);
      const res = await call(a, 'POST', `/api/admin/users/${String(alice.id)}/password`, root.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const { password } = res.json<{ password: string }>();
      expect(password).toMatch(/^[A-Za-z0-9_-]{16}$/);
      await expect.poll(() => ws.closeCode, { timeout: 5_000 }).toBe(CLOSE_SESSIONS_REVOKED);
      expect((await me(a, alice)).statusCode).toBe(401);
      expect((await login(a, 'Alice')).statusCode).toBe(401);
      expect((await login(a, 'Alice', password)).statusCode).toBe(200);

      const rows = await auditRows();
      expect(rows).toMatchObject([
        { admin_id: root.id, action: 'user.password_reset', target_user_id: alice.id, details: { sessions: 1 } },
      ]);
      expect(JSON.stringify(rows)).not.toContain(password);
    });
  });

  // ---------------------------------------------------------------------------
  // Tische
  // ---------------------------------------------------------------------------

  describe('Tisch schließen', () => {
    it('laufende Runde: ohne Punkte abgebrochen, alle Beobachter informiert, Tisch weg, protokolliert', async () => {
      const a = start();
      const url = await listen(a);
      const root = await register(a, 'Root', true);
      const bob = await register(a, 'Bob');
      const carol = await register(a, 'Carol');
      const [cb, cc] = [await connect(url, bob), await connect(url, carol)];
      const tableId = await tableWith([cb, cc], true);
      const roundId = a.game.getTable(tableId)?.roundId;
      expect(roundId).toEqual(expect.any(Number));

      const res = await call(a, 'POST', `/api/admin/tables/${String(tableId)}/close`, root.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        table: { tableId, status: 'running', roundId, seated: 2, roundAborted: true },
      });
      for (const c of [cb, cc]) {
        expect(await c.next<TableClosed>((m) => m.type === 'table.closed')).toEqual({
          type: 'table.closed',
          tableId,
          reason: 'admin',
        });
      }
      expect(a.game.getTable(tableId)).toBeUndefined();
      await a.game.idle();

      const { rows: rounds } = await s.pool.query<{ status: string }>('SELECT status FROM rounds WHERE id = $1', [
        roundId,
      ]);
      expect(rounds).toEqual([{ status: 'aborted' }]);
      const { rows: points } = await s.pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM round_players WHERE round_id = $1 AND points IS NOT NULL',
        [roundId],
      );
      expect(points[0]?.n).toBe(0);
      const { rows: tables } = await s.pool.query<{ status: string }>('SELECT status FROM tables WHERE id = $1', [
        tableId,
      ]);
      expect(tables).toEqual([{ status: 'closed' }]);

      // Erneut beitreten geht nicht mehr; zweites Schließen → 404.
      cb.send({ type: 'table.join', tableId });
      expect((await cb.nextError()).code).toBe('TABLE_NOT_FOUND');
      expect((await call(a, 'POST', `/api/admin/tables/${String(tableId)}/close`, root.cookie)).statusCode).toBe(404);

      expect(await auditRows()).toMatchObject([
        {
          admin_id: root.id,
          action: 'table.close',
          target_table_id: tableId,
          target_user_id: null,
          details: { status: 'running', roundId, seated: 2 },
        },
      ]);
    }, 30_000);

    it('offener Tisch: geschlossen ohne Runde', async () => {
      const a = start();
      const url = await listen(a);
      const root = await register(a, 'Root', true);
      const bob = await register(a, 'Bob');
      const cb = await connect(url, bob);
      const tableId = await tableWith([cb], false);
      const res = await call(a, 'POST', `/api/admin/tables/${String(tableId)}/close`, root.cookie);
      expect(res.json()).toMatchObject({ table: { status: 'open', roundId: null, roundAborted: false } });
      await cb.next((m) => m.type === 'table.closed');
      await a.game.idle();
      const { rows } = await s.pool.query<{ status: string }>('SELECT status FROM tables WHERE id = $1', [tableId]);
      expect(rows).toEqual([{ status: 'closed' }]);
    });

    it('unbekannter Tisch → 404, nichts protokolliert', async () => {
      const a = start();
      const root = await register(a, 'Root', true);
      expect((await call(a, 'POST', '/api/admin/tables/4711/close', root.cookie)).statusCode).toBe(404);
      expect((await call(a, 'POST', '/api/admin/tables/x/close', root.cookie)).statusCode).toBe(404);
      expect(await auditRows()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Protokoll
  // ---------------------------------------------------------------------------

  describe('Admin-Protokoll', () => {
    it('Liste mit Namen, Filtern und Blättern; CLI-Aktionen ohne Admin mit Quelle cli', async () => {
      const a = start();
      const root = await register(a, 'Root');
      expect(await setAdmin(s.pool, 'root', true)).toBe(true); // Eintrag 1: user.admin_grant (CLI)
      const alice = await register(a, 'Alice');
      await call(a, 'POST', `/api/admin/users/${String(alice.id)}/ban`, root.cookie); // 2
      await call(a, 'POST', `/api/admin/users/${String(alice.id)}/unban`, root.cookie); // 3
      expect(await resetPassword(s.pool, 'alice', 'neues-passwort')).toBe(true); // 4 (CLI)
      expect(await setAdmin(s.pool, 'Root', true)).toBe(true); // keine Änderung → kein Eintrag

      const res = await call(a, 'GET', '/api/admin/audit', root.cookie);
      expect(res.statusCode).toBe(200);
      const { entries } = res.json<{ entries: AuditEntry[] }>();
      expect(entries.map((e) => [e.action, e.source, e.admin?.username ?? null, e.targetUser?.username])).toEqual([
        ['user.password_reset', 'cli', null, 'Alice'],
        ['user.unban', 'api', 'Root', 'Alice'],
        ['user.ban', 'api', 'Root', 'Alice'],
        ['user.admin_grant', 'cli', null, 'Root'],
      ]);
      expect(entries[0]?.createdAt).toEqual(expect.any(String));

      const page = await call(a, 'GET', `/api/admin/audit?limit=2&before=${String(entries[1]?.id)}`, root.cookie);
      expect(page.json<{ entries: AuditEntry[] }>().entries.map((e) => e.action)).toEqual([
        'user.ban',
        'user.admin_grant',
      ]);
      const filtered = await call(a, 'GET', '/api/admin/audit?action=user.ban', root.cookie);
      expect(filtered.json<{ entries: AuditEntry[] }>().entries).toHaveLength(1);
      const byUser = await call(a, 'GET', `/api/admin/audit?userId=${String(root.id)}`, root.cookie);
      expect(byUser.json<{ entries: AuditEntry[] }>().entries).toHaveLength(3);
      expect((await call(a, 'GET', '/api/admin/audit?limit=501', root.cookie)).statusCode).toBe(400);
      expect((await call(a, 'GET', '/api/admin/audit?before=abc', root.cookie)).statusCode).toBe(400);
    });

    it('Konto-Löschung: Einträge bleiben, verlieren aber den Bezug zum Account und die Begründung', async () => {
      const a = start();
      const root = await register(a, 'Root', true);
      const alice = await register(a, 'Alice');
      const bob = await register(a, 'Bob');
      await call(a, 'POST', `/api/admin/users/${String(alice.id)}/ban`, root.cookie, { reason: 'Alice war gemein' });
      await call(a, 'POST', `/api/admin/users/${String(bob.id)}/ban`, root.cookie, { reason: 'Bob auch' });

      expect(await anonymizeAccount(s.pool, alice.id)).toBe(true);
      const { rows: users } = await s.pool.query<{ banned_at: Date | null }>(
        'SELECT banned_at FROM users WHERE id = $1',
        [alice.id],
      );
      expect(users).toEqual([{ banned_at: null }]);
      // Admin löscht sein Konto → admin_id wird NULL.
      await setAdmin(s.pool, 'Root', false);
      expect(await anonymizeAccount(s.pool, root.id)).toBe(true);

      const rows = await auditRows();
      const bans = rows.filter((r) => r.action === 'user.ban');
      expect(bans).toMatchObject([
        { admin_id: null, target_user_id: null, details: { sessions: 1 } },
        { admin_id: null, target_user_id: bob.id, details: { reason: 'Bob auch', sessions: 1 } },
      ]);
      expect(bans[0]?.details).not.toHaveProperty('reason');
      expect(JSON.stringify(rows)).not.toContain('Alice');

      // Harte Löschung (nur Wartung) wird nicht blockiert.
      await s.pool.query('DELETE FROM sessions WHERE user_id = $1', [bob.id]);
      await s.pool.query('DELETE FROM users WHERE id = $1', [bob.id]);
      expect((await auditRows()).find((r) => r.action === 'user.ban' && r.details['reason'] === 'Bob auch')).toBe(
        undefined,
      );
    });

    it('DB-Bedingungen: Aktionsformat, Quelle, Details als Objekt; gelöschter Account nicht gesperrt', async () => {
      await expect(s.pool.query("INSERT INTO admin_audit_log (action) VALUES ('Ban user')")).rejects.toThrow(
        /admin_audit_log_action/,
      );
      await expect(
        s.pool.query("INSERT INTO admin_audit_log (action, source) VALUES ('user.ban', 'web')"),
      ).rejects.toThrow(/admin_audit_log_source/);
      await expect(
        s.pool.query("INSERT INTO admin_audit_log (action, details) VALUES ('user.ban', '[]')"),
      ).rejects.toThrow(/admin_audit_log_details_object/);
      await expect(
        s.pool.query(
          `INSERT INTO users (username, password_hash, deleted_at, banned_at) VALUES (NULL, NULL, now(), now())`,
        ),
      ).rejects.toThrow(/users_deleted_is_anonymized/);
    });

    it('Löschfrist: Einträge älter als 1 Jahr werden gelöscht, auch per Job', async () => {
      const now = new Date('2027-06-01T12:00:00Z');
      await writeAudit(s.pool, { adminId: null, action: 'user.unban', source: 'cli' });
      await s.pool.query(`INSERT INTO admin_audit_log (action, created_at) VALUES ('user.ban', $1), ('user.ban', $2)`, [
        new Date(now.getTime() - 366 * DAY),
        new Date(now.getTime() - 364 * DAY),
      ]);
      // Der frische Eintrag liegt (echte Uhr) vor `now` und bleibt ebenfalls.
      expect(await purgeExpiredAudit(s.pool, now)).toBe(1);
      expect(await auditRows()).toHaveLength(2);

      const log = { info: vi.fn(), error: vi.fn() };
      const job = startAuditPurgeJob({ db: s.pool, log, now: () => new Date(now.getTime() + 2 * DAY) });
      await job.firstRun;
      job.stop();
      expect((await auditRows()).map((r) => r.action)).toEqual(['user.unban']);
      expect(log.info).toHaveBeenCalledWith({ deleted: 1 }, expect.any(String));

      const failing = startAuditPurgeJob({ db: { query: () => Promise.reject(new Error('DB weg')) }, log });
      await failing.firstRun;
      failing.stop();
      expect(log.error).toHaveBeenCalledOnce();
    });
  });

  it('gesperrter Spieler am laufenden Tisch: Verbindung weg, Runde läuft für die anderen weiter', async () => {
    const a = start();
    const url = await listen(a);
    const root = await register(a, 'Root', true);
    const accounts = [await register(a, 'Alice'), await register(a, 'Bob'), await register(a, 'Carol')];
    const [alice] = accounts as [Account, Account, Account];
    const [ca, cb, cc] = await Promise.all(accounts.map((acc) => connect(url, acc)));
    if (ca === undefined || cb === undefined || cc === undefined) throw new Error('Client fehlt');
    const tableId = await tableWith([cb, ca, cc], false);
    attachBot(cb, tableId, 3);
    attachBot(cc, tableId, 4);
    cb.send({ type: 'table.start', tableId });
    await ca.nextState((t) => t.round !== null);

    expect((await call(a, 'POST', `/api/admin/users/${String(alice.id)}/ban`, root.cookie)).statusCode).toBe(200);
    await expect.poll(() => ca.closeCode, { timeout: 5_000 }).toBe(CLOSE_ACCOUNT_BANNED);
    // Alice wird automatisch gecheckt/gefoldet (D-022); die Runde endet regulär.
    await cb.next((m) => m.type === 'table.roundFinished', 30_000);
  }, 45_000);
});
