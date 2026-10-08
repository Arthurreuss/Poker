// Admin-API (WP-028, D-029): Spieler sperren/entsperren, Sessions beenden, Passwort zurücksetzen, Tisch schließen,
// Admin-Protokoll lesen. Zugriff prüft der allgemeine Guard (admin/guard.ts) für alle `/api/admin/*`-Routen;
// jede Aktion steht im Admin-Protokoll (admin/audit.ts). Formate: docs/ARCHITECTURE.md, „Admin (WP-028)“.
import type { FastifyError, FastifyPluginAsync, FastifyReply } from 'fastify';
import { generatePassword } from '../auth/admin';
import { hashPassword } from '../auth/password';
import type { Database } from '../db';
import type { GameServer } from '../game/game-server';
import { CLOSE_ACCOUNT_BANNED, CLOSE_SESSIONS_REVOKED } from '../ws';
import { AUDIT_LIST_MAX_LIMIT, listAudit, writeAudit, type AuditEntry } from './audit';
import { adminOf } from './guard';
import {
  USER_LIST_MAX_LIMIT,
  banUser,
  findUser,
  listUsers,
  revokeSessions,
  setPasswordHash,
  unbanUser,
  type AdminUserView,
} from './users';

export interface AdminPluginOptions {
  db: Database;
  game: GameServer;
  /** Offene WebSocket-Verbindungen eines Users schließen (`registerWebSocket(...).closeUserConnections`). */
  closeUserConnections: (userId: number, code: number, reason: string) => void;
}

export interface AdminApiError {
  error: 'invalid_request' | 'not_found' | 'conflict' | 'internal';
  message: string;
}

export const BAN_REASON_MAX = 500;
const MAX_ID = 2 ** 31 - 1;

/** Positive integer-ID aus einem Pfad-/Query-Parameter, sonst `null`. */
function parseId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= MAX_ID ? id : null;
}

function fail(reply: FastifyReply, status: number, error: AdminApiError['error'], message: string) {
  return reply.code(status).send({ error, message } satisfies AdminApiError);
}

export const adminRoutes: FastifyPluginAsync<AdminPluginOptions> = (app, { db, game, closeUserConnections }) => {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) return fail(reply, status, 'invalid_request', err.message);
    request.log.error({ err }, 'Admin: unerwarteter Fehler');
    return fail(reply, 500, 'internal', 'Interner Fehler');
  });

  const userNotFound = (reply: FastifyReply) => fail(reply, 404, 'not_found', 'Spieler nicht gefunden');

  /** Ziel-User aus `:id`, sonst 404. */
  async function targetUser(params: unknown, reply: FastifyReply): Promise<AdminUserView | null> {
    const id = parseId((params as { id?: unknown }).id);
    const user = id === null ? null : await findUser(db, id);
    if (user === null) await userNotFound(reply);
    return user;
  }

  // ---------------------------------------------------------------------------
  // Spieler
  // ---------------------------------------------------------------------------

  app.get('/api/admin/users', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const search = typeof query['search'] === 'string' ? query['search'] : null;
    const rawLimit = query['limit'];
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > USER_LIST_MAX_LIMIT)) {
      return fail(reply, 400, 'invalid_request', 'Ungültiges Limit');
    }
    return { users: await listUsers(db, { search, ...(limit === undefined ? {} : { limit }) }) };
  });

  app.get('/api/admin/users/:id', async (request, reply) => {
    const user = await targetUser(request.params, reply);
    if (user === null) return reply;
    return { user };
  });

  // Sperren: Sessions löschen (atomar mit Protokoll), dann offene WebSockets mit eigenem Code schließen. Am Tisch gilt
  // der Spieler danach als getrennt und wird automatisch gecheckt/gefoldet (D-022).
  app.post('/api/admin/users/:id/ban', async (request, reply) => {
    const admin = adminOf(request);
    const body = (request.body ?? {}) as { reason?: unknown };
    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
      return fail(reply, 400, 'invalid_request', 'Begründung muss Text sein');
    }
    const reason = typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : null;
    if (reason !== null && reason.length > BAN_REASON_MAX) {
      return fail(reply, 400, 'invalid_request', `Begründung höchstens ${String(BAN_REASON_MAX)} Zeichen`);
    }
    const user = await targetUser(request.params, reply);
    if (user === null) return reply;
    if (user.id === admin.id) return fail(reply, 409, 'conflict', 'Du kannst dich nicht selbst sperren');
    if (user.isAdmin) {
      return fail(reply, 409, 'conflict', 'Admins können nicht gesperrt werden – erst das Admin-Flag entziehen (CLI)');
    }
    if (user.bannedAt !== null) return fail(reply, 409, 'conflict', 'Spieler ist bereits gesperrt');
    const result = await banUser(db, { adminId: admin.id, userId: user.id, reason });
    if (result === null) return fail(reply, 409, 'conflict', 'Spieler konnte nicht gesperrt werden');
    closeUserConnections(user.id, CLOSE_ACCOUNT_BANNED, 'account banned');
    request.log.info({ adminId: admin.id, userId: user.id }, 'Admin: Spieler gesperrt');
    return { user: await findUser(db, user.id) };
  });

  app.post('/api/admin/users/:id/unban', async (request, reply) => {
    const admin = adminOf(request);
    const user = await targetUser(request.params, reply);
    if (user === null) return reply;
    if (user.bannedAt === null) return fail(reply, 409, 'conflict', 'Spieler ist nicht gesperrt');
    if (!(await unbanUser(db, { adminId: admin.id, userId: user.id }))) {
      return fail(reply, 409, 'conflict', 'Spieler ist nicht gesperrt');
    }
    request.log.info({ adminId: admin.id, userId: user.id }, 'Admin: Sperre aufgehoben');
    return { user: await findUser(db, user.id) };
  });

  // Alle Sessions beenden (auch die eigenen eines Admins – dann ist er selbst abgemeldet).
  app.post('/api/admin/users/:id/sessions/revoke', async (request, reply) => {
    const admin = adminOf(request);
    const user = await targetUser(request.params, reply);
    if (user === null) return reply;
    const revoked = await revokeSessions(db, { adminId: admin.id, userId: user.id });
    if (revoked === null) return userNotFound(reply);
    closeUserConnections(user.id, CLOSE_SESSIONS_REVOKED, 'sessions revoked');
    request.log.info({ adminId: admin.id, userId: user.id, revoked }, 'Admin: Sessions beendet');
    return { revoked };
  });

  // Neues Zufallspasswort (D-011: Reset über Admin): wird genau einmal in dieser Antwort zurückgegeben, nie
  // gespeichert oder protokolliert; alle Sessions des Spielers enden.
  app.post('/api/admin/users/:id/password', async (request, reply) => {
    const admin = adminOf(request);
    const user = await targetUser(request.params, reply);
    if (user === null) return reply;
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    if (!(await setPasswordHash(db, { adminId: admin.id, userId: user.id, passwordHash }))) {
      return userNotFound(reply);
    }
    closeUserConnections(user.id, CLOSE_SESSIONS_REVOKED, 'password reset');
    request.log.info({ adminId: admin.id, userId: user.id }, 'Admin: Passwort zurückgesetzt');
    void reply.header('cache-control', 'no-store');
    return { password };
  });

  // ---------------------------------------------------------------------------
  // Tische
  // ---------------------------------------------------------------------------

  // Erst protokollieren, dann schließen: schlägt das Protokoll fehl, bleibt der Tisch offen (keine Aktion ohne
  // Eintrag). Laufende Runde → ohne Punkte abgebrochen (wie D-019).
  app.post('/api/admin/tables/:id/close', async (request, reply) => {
    const admin = adminOf(request);
    const tableId = parseId((request.params as { id?: unknown }).id);
    const table = tableId === null ? undefined : game.getTable(tableId);
    if (tableId === null || table === undefined) {
      return fail(reply, 404, 'not_found', 'Tisch nicht gefunden oder schon geschlossen');
    }
    await writeAudit(db, {
      adminId: admin.id,
      action: 'table.close',
      targetTableId: tableId,
      details: { status: table.status, roundId: table.roundId, seated: table.seats.size },
    });
    const closed = game.closeTableByAdmin(tableId);
    if (closed === null) return fail(reply, 404, 'not_found', 'Tisch nicht gefunden oder schon geschlossen');
    request.log.info({ adminId: admin.id, tableId, status: closed.status }, 'Admin: Tisch geschlossen');
    return { table: closed };
  });

  // ---------------------------------------------------------------------------
  // Protokoll
  // ---------------------------------------------------------------------------

  app.get('/api/admin/audit', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const rawLimit = query['limit'];
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_LIST_MAX_LIMIT)) {
      return fail(reply, 400, 'invalid_request', 'Ungültiges Limit');
    }
    const ids: Record<'before' | 'userId' | 'tableId', number | null> = { before: null, userId: null, tableId: null };
    for (const key of ['before', 'userId', 'tableId'] as const) {
      if (query[key] === undefined) continue;
      const id = parseId(query[key]);
      if (id === null) return fail(reply, 400, 'invalid_request', `Ungültiger Parameter ${key}`);
      ids[key] = id;
    }
    const action = typeof query['action'] === 'string' && query['action'] !== '' ? query['action'] : null;
    const entries: AuditEntry[] = await listAudit(db, {
      ...(limit === undefined ? {} : { limit }),
      beforeId: ids.before,
      userId: ids.userId,
      tableId: ids.tableId,
      action,
    });
    return { entries };
  });

  return Promise.resolve();
};
