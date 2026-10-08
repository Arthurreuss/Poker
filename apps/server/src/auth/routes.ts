// Auth-Endpunkte als gekapseltes Fastify-Plugin: /api/register, /api/login, /api/logout, /api/me (WP-010, D-011),
// DELETE /api/me = Konto löschen (WP-022).
// Ablauf, Cookie und Rate-Limit: docs/ARCHITECTURE.md, Abschnitt „Auth“.
import fastifyCookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { toAvatarId } from '../avatar/avatar';
import type { Database } from '../db';
import { anonymizeAccount } from './account';
import type { AuthConfig } from './config';
import { hashPassword, verifyDummyPassword, verifyPassword } from './password';
import {
  SESSION_COOKIE,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  getUserFromSessionToken,
  type AuthUser,
} from './session';
import { validateLogin, validatePasswordConfirmation, validateRegistration } from './validation';

export interface AuthPluginOptions {
  db: Database;
  config: AuthConfig;
  /** Nach erfolgreicher Konto-Löschung, z. B. um offene WebSocket-Verbindungen des Users zu schließen. */
  onAccountDeleted?: (userId: number) => void;
}

export interface UserResponse {
  user: AuthUser;
}

export interface ErrorResponse {
  error: 'invalid_request' | 'username_taken' | 'invalid_credentials' | 'unauthorized' | 'rate_limited' | 'internal';
  message: string;
}

const UNIQUE_VIOLATION = '23505';
const INVALID_CREDENTIALS: ErrorResponse = {
  error: 'invalid_credentials',
  message: 'Benutzername oder Passwort ist falsch',
};

/** Client-IP für das Rate-Limit: hinter Cloudflare (nur prod, D-014) aus `CF-Connecting-IP`, sonst die Socket-IP. */
export function clientIp(request: FastifyRequest, trustCfConnectingIp: boolean): string {
  if (trustCfConnectingIp) {
    const header = request.headers['cf-connecting-ip'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return request.ip;
}

export const authRoutes: FastifyPluginAsync<AuthPluginOptions> = async (app, { db, config, onAccountDeleted }) => {
  await app.register(fastifyCookie);
  await app.register(rateLimit, { global: false });

  const rateLimitConfig =
    config.rateLimit === null
      ? {}
      : {
          rateLimit: {
            max: config.rateLimit.max,
            timeWindow: config.rateLimit.windowMs,
            keyGenerator: (request: FastifyRequest) => clientIp(request, config.trustCfConnectingIp),
          },
        };

  function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      path: '/',
      expires: expiresAt,
    });
  }

  function clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/' });
  }

  async function startSession(reply: FastifyReply, userId: number): Promise<void> {
    await deleteExpiredSessions(db, userId);
    const session = await createSession(db, userId, config.sessionTtlMs);
    setSessionCookie(reply, session.token, session.expiresAt);
  }

  // Eigener Fehler-Handler nur für diese Routen: einheitliches `{ error, message }`, keine Request-Bodies im Log.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status === 429) {
      return reply
        .code(429)
        .send({ error: 'rate_limited', message: 'Zu viele Versuche – bitte kurz warten' } satisfies ErrorResponse);
    }
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'invalid_request', message: err.message } satisfies ErrorResponse);
    }
    request.log.error({ err }, 'Auth: unerwarteter Fehler');
    return reply.code(500).send({ error: 'internal', message: 'Interner Fehler' } satisfies ErrorResponse);
  });

  app.post('/api/register', { config: rateLimitConfig }, async (request, reply) => {
    const input = validateRegistration(request.body);
    if (!input.ok) {
      return reply.code(400).send({ error: 'invalid_request', message: input.message } satisfies ErrorResponse);
    }
    const { username, password } = input.value;
    const passwordHash = await hashPassword(password);
    let row: { id: number; username: string; is_admin: boolean } | undefined;
    try {
      ({
        rows: [row],
      } = await db.query<{ id: number; username: string; is_admin: boolean }>(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, is_admin',
        [username, passwordHash],
      ));
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        return reply
          .code(409)
          .send({ error: 'username_taken', message: 'Benutzername ist bereits vergeben' } satisfies ErrorResponse);
      }
      throw err;
    }
    if (row === undefined) throw new Error('User konnte nicht angelegt werden');
    await startSession(reply, row.id);
    return reply.code(201).send({
      user: { id: row.id, username: row.username, isAdmin: row.is_admin, avatar: null },
    } satisfies UserResponse);
  });

  app.post('/api/login', { config: rateLimitConfig }, async (request, reply) => {
    const input = validateLogin(request.body);
    if (!input.ok) {
      return reply.code(400).send({ error: 'invalid_request', message: input.message } satisfies ErrorResponse);
    }
    const { username, password } = input.value;
    const { rows } = await db.query<{
      id: number;
      username: string;
      is_admin: boolean;
      password_hash: string;
      avatar: string | null;
    }>(
      `SELECT id, username, is_admin, password_hash, avatar FROM users
        WHERE lower(username) = lower($1) AND deleted_at IS NULL`,
      [username],
    );
    const user = rows[0];
    // Unbekannter Name: trotzdem einen Hash prüfen, damit Antwort und Laufzeit gleich aussehen.
    const valid =
      user === undefined ? await verifyDummyPassword(password) : await verifyPassword(user.password_hash, password);
    if (user === undefined || !valid) {
      return reply.code(401).send(INVALID_CREDENTIALS);
    }
    await startSession(reply, user.id);
    return {
      user: { id: user.id, username: user.username, isAdmin: user.is_admin, avatar: toAvatarId(user.avatar) },
    } satisfies UserResponse;
  });

  app.post('/api/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined) await deleteSession(db, token);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/me', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const user = token === undefined ? null : await getUserFromSessionToken(db, token);
    if (user === null) {
      if (token !== undefined) clearSessionCookie(reply);
      return reply.code(401).send({ error: 'unauthorized', message: 'Nicht angemeldet' } satisfies ErrorResponse);
    }
    return { user } satisfies UserResponse;
  });

  // Konto löschen (WP-022, DSGVO): Passwort bestätigen, dann anonymisieren (auth/account.ts). Rate-Limit wie
  // Login, weil die Route ein Passwort prüft. 403 statt 401 bei falschem Passwort: die Session bleibt gültig.
  app.delete('/api/me', { config: rateLimitConfig }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const user = token === undefined ? null : await getUserFromSessionToken(db, token);
    if (user === null) {
      if (token !== undefined) clearSessionCookie(reply);
      return reply.code(401).send({ error: 'unauthorized', message: 'Nicht angemeldet' } satisfies ErrorResponse);
    }
    const input = validatePasswordConfirmation(request.body);
    if (!input.ok) {
      return reply.code(400).send({ error: 'invalid_request', message: input.message } satisfies ErrorResponse);
    }
    const { rows } = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL',
      [user.id],
    );
    const passwordHash = rows[0]?.password_hash;
    if (passwordHash === undefined || !(await verifyPassword(passwordHash, input.password))) {
      return reply
        .code(403)
        .send({ error: 'invalid_credentials', message: 'Passwort ist falsch' } satisfies ErrorResponse);
    }
    await anonymizeAccount(db, user.id);
    request.log.info({ userId: user.id }, 'Konto gelöscht (anonymisiert)');
    onAccountDeleted?.(user.id);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};
