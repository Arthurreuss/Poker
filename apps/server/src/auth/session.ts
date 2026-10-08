// Login-Sessions: zufälliges Token im httpOnly-Cookie, in der DB nur dessen SHA-256 (Tabelle `sessions`).
import { createHash, randomBytes } from 'node:crypto';
import type { AvatarId } from '@poker/engine/protocol';
import { toAvatarId } from '../avatar/avatar';
import type { Queryable } from '../db';

export const SESSION_COOKIE = 'poker_session';

/** 32 Zufallsbytes als base64url ohne Padding = genau 43 Zeichen. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Öffentliche Sicht auf einen Account (API-Antworten, WebSocket-Handshake). */
export interface AuthUser {
  id: number;
  username: string;
  isAdmin: boolean;
  /** Gewählter Avatar (WP-032); `null` = keiner. */
  avatar: AvatarId | null;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export interface NewSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(db: Queryable, userId: number, ttlMs: number): Promise<NewSession> {
  const token = generateSessionToken();
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3)) RETURNING expires_at`,
    [hashSessionToken(token), userId, ttlMs / 1000],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Session konnte nicht angelegt werden');
  return { token, expiresAt: row.expires_at };
}

export async function deleteSession(db: Queryable, token: string): Promise<void> {
  if (!isWellFormedToken(token)) return;
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
}

/** Löscht abgelaufene Sessions eines Users (beim Login, damit sich nichts ansammelt). */
export async function deleteExpiredSessions(db: Queryable, userId: number): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()', [userId]);
}

/** User zu einem Session-Token; `null`, wenn unbekannt, abgelaufen oder der Account gelöscht oder gesperrt ist. */
export async function getUserFromSessionToken(db: Queryable, token: string): Promise<AuthUser | null> {
  if (!isWellFormedToken(token)) return null;
  const { rows } = await db.query<{ id: number; username: string; is_admin: boolean; avatar: string | null }>(
    `SELECT u.id, u.username, u.is_admin, u.avatar
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deleted_at IS NULL AND u.banned_at IS NULL`,
    [hashSessionToken(token)],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : { id: row.id, username: row.username, isAdmin: row.is_admin, avatar: toAvatarId(row.avatar) };
}

/**
 * Liest das Session-Token aus einem rohen `Cookie`-Header (`undefined`, wenn keins da ist).
 * Eigener Mini-Parser: `@fastify/cookie` parst nur innerhalb einer Fastify-Instanz zuverlässig.
 * Das Token ist base64url und wird daher nie URL-kodiert.
 */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === SESSION_COOKIE) {
      return part
        .slice(eq + 1)
        .trim()
        .replace(/^"(.*)"$/, '$1');
    }
  }
  return undefined;
}

/**
 * Löst den eingeloggten User aus einem rohen `Cookie`-Header auf – für Stellen ohne Fastify-Cookie-Plugin,
 * vor allem das WebSocket-Upgrade (WP-011): `getUserFromCookieHeader(db, request.headers.cookie)`.
 */
export async function getUserFromCookieHeader(
  db: Queryable,
  cookieHeader: string | undefined,
): Promise<AuthUser | null> {
  const token = readSessionToken(cookieHeader);
  return token === undefined ? null : getUserFromSessionToken(db, token);
}
