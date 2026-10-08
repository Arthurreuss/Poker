// Endpunkte für Rangliste, Statistiken und Hand-Historie (WP-019), nur für eingeloggte Nutzer.
// Formate: docs/ARCHITECTURE.md, Abschnitt „Statistiken“.
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getUserFromCookieHeader, type AuthUser } from '../auth/session';
import type { Queryable } from '../db';
import {
  findActiveUser,
  isRoundParticipant,
  loadHistoryHand,
  loadLeaderboard,
  loadNames,
  loadPlayerStats,
  loadRecentRounds,
  loadRoundHistory,
  loadRoundSummary,
} from './queries';
import { toHandSummary, toHandView } from './view';

export interface StatsPluginOptions {
  db: Queryable;
}

export interface StatsErrorResponse {
  error: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_request';
  message: string;
}

export const RECENT_ROUNDS_DEFAULT = 10;
export const RECENT_ROUNDS_MAX = 50;

/** Positive ganze Zahl aus einem Pfad-/Query-Parameter, sonst `null`. */
function positiveInt(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,8}$/.test(value)) return null;
  return Number(value);
}

function send(reply: FastifyReply, status: number, body: StatsErrorResponse) {
  return reply.code(status).send(body);
}

const NOT_FOUND_PLAYER: StatsErrorResponse = { error: 'not_found', message: 'Spieler nicht gefunden' };
const NOT_FOUND_ROUND: StatsErrorResponse = { error: 'not_found', message: 'Runde nicht gefunden' };
const NOT_FOUND_HAND: StatsErrorResponse = { error: 'not_found', message: 'Hand nicht gefunden' };
const NOT_PARTICIPANT: StatsErrorResponse = {
  error: 'forbidden',
  message: 'Die Hände einer Runde können nur ihre Teilnehmer nachlesen',
};

export const statsRoutes: FastifyPluginAsync<StatsPluginOptions> = (app, { db }) => {
  // Session prüfen wie beim WebSocket-Handshake (eigener Cookie-Parser, das Cookie-Plugin ist im Auth-Plugin
  // gekapselt). Ein Hook setzt den User; Handler lesen ihn über `viewers`.
  const viewers = new WeakMap<FastifyRequest, AuthUser>();
  app.addHook('preHandler', async (request, reply) => {
    const user = await getUserFromCookieHeader(db, request.headers.cookie);
    if (user === null) return send(reply, 401, { error: 'unauthorized', message: 'Nicht angemeldet' });
    viewers.set(request, user);
    return undefined;
  });
  app.setErrorHandler((err: FastifyError, request, reply) => {
    request.log.error({ err }, 'Statistik: unerwarteter Fehler');
    return reply.code(500).send({ error: 'internal', message: 'Interner Fehler' });
  });
  const viewerOf = (request: FastifyRequest): AuthUser => {
    const user = viewers.get(request);
    if (user === undefined) throw new Error('Statistik-Route ohne geprüfte Session');
    return user;
  };

  app.get('/api/leaderboard', async () => ({ players: await loadLeaderboard(db) }));

  app.get<{ Params: { name: string } }>('/api/players/:name/stats', async (request, reply) => {
    const stats = await loadPlayerStats(db, request.params.name);
    return stats ?? send(reply, 404, NOT_FOUND_PLAYER);
  });

  app.get<{ Querystring: { player?: string; limit?: string } }>('/api/rounds/recent', async (request, reply) => {
    const viewer = viewerOf(request);
    const { player, limit: rawLimit } = request.query;
    const limit = rawLimit === undefined ? RECENT_ROUNDS_DEFAULT : positiveInt(rawLimit);
    if (limit === null || limit > RECENT_ROUNDS_MAX) {
      return send(reply, 400, {
        error: 'invalid_request',
        message: `limit muss zwischen 1 und ${String(RECENT_ROUNDS_MAX)} liegen`,
      });
    }
    const user = player === undefined ? { id: viewer.id } : await findActiveUser(db, player);
    if (user === null) return send(reply, 404, NOT_FOUND_PLAYER);
    return { rounds: await loadRecentRounds(db, user.id, viewer.id, limit) };
  });

  app.get<{ Params: { id: string } }>('/api/rounds/:id', async (request, reply) => {
    const viewer = viewerOf(request);
    const id = positiveInt(request.params.id);
    if (id === null) return send(reply, 404, NOT_FOUND_ROUND);
    const round = await loadRoundSummary(db, id, viewer.id);
    if (round === null) return send(reply, 404, NOT_FOUND_ROUND);
    if (!round.viewerParticipated) return send(reply, 403, NOT_PARTICIPANT);
    const hands = await loadRoundHistory(db, id);
    const names = await loadNames(db, hands);
    return { round, hands: hands.map((h) => toHandSummary(h, names, viewer.id)) };
  });

  app.get<{ Params: { id: string } }>('/api/hands/:id', async (request, reply) => {
    const viewer = viewerOf(request);
    const id = positiveInt(request.params.id);
    if (id === null) return send(reply, 404, NOT_FOUND_HAND);
    const hand = await loadHistoryHand(db, id);
    if (hand === null) return send(reply, 404, NOT_FOUND_HAND);
    if (!(await isRoundParticipant(db, hand.roundId, viewer.id))) return send(reply, 403, NOT_PARTICIPANT);
    const names = await loadNames(db, [hand]);
    return { hand: toHandView(hand, names, viewer.id) };
  });
  return Promise.resolve();
};
