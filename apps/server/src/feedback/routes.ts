// Feedback-Endpunkte als gekapseltes Fastify-Plugin (WP-024): `POST /api/feedback` für eingeloggte Spieler,
// `GET /api/admin/feedback` und `PATCH /api/admin/feedback/:id` nur für Admins (geprüft vom allgemeinen Admin-Guard,
// admin/guard.ts, WP-028).
// Formate und Rate-Limit: docs/ARCHITECTURE.md, Abschnitt „Datenmodell“ → „Feedback“.
import rateLimit from '@fastify/rate-limit';
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getUserFromCookieHeader, type AuthUser } from '../auth/session';
import type { Database } from '../db';
import type { FeedbackConfig } from './config';
import {
  countFeedback,
  insertFeedback,
  listFeedback,
  updateFeedbackStatus,
  type FeedbackCounts,
  type FeedbackItem,
} from './store';
import { isFeedbackStatus, normalizeUserAgent, validateFeedback } from './validation';

export interface FeedbackPluginOptions {
  db: Database;
  config: FeedbackConfig;
}

export interface FeedbackCreatedResponse {
  feedback: { id: number; createdAt: string };
}

export interface FeedbackListResponse {
  feedback: FeedbackItem[];
  counts: FeedbackCounts;
}

export interface FeedbackItemResponse {
  feedback: FeedbackItem;
}

export interface FeedbackErrorResponse {
  error: 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'internal';
  message: string;
}

const UNAUTHORIZED: FeedbackErrorResponse = { error: 'unauthorized', message: 'Nicht angemeldet' };

declare module 'fastify' {
  interface FastifyRequest {
    /** Eingeloggter User der Feedback-Routen (gesetzt im `onRequest`-Hook). */
    feedbackUser: AuthUser | null;
  }
}

export const feedbackRoutes: FastifyPluginAsync<FeedbackPluginOptions> = async (app, { db, config }) => {
  await app.register(rateLimit, { global: false });
  app.decorateRequest('feedbackUser', null);

  /** Session aus dem Cookie; ohne gültige Session `401`. */
  async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    request.feedbackUser = await getUserFromCookieHeader(db, request.headers.cookie);
    if (request.feedbackUser === null) await reply.code(401).send(UNAUTHORIZED);
  }

  // Pro User gezählt; erst nach der Session-Prüfung (preHandler), damit nur Eingeloggte zählen.
  const rateLimitConfig =
    config.rateLimit === null
      ? {}
      : {
          rateLimit: {
            max: config.rateLimit.max,
            timeWindow: config.rateLimit.windowMs,
            hook: 'preHandler' as const,
            keyGenerator: (request: FastifyRequest) => `user:${String(request.feedbackUser?.id ?? 0)}`,
          },
        };

  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send({
        error: 'rate_limited',
        message: 'Zu viel Feedback in kurzer Zeit – bitte später noch einmal versuchen',
      } satisfies FeedbackErrorResponse);
    }
    if (status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: 'invalid_request', message: err.message } satisfies FeedbackErrorResponse);
    }
    request.log.error({ err }, 'Feedback: unerwarteter Fehler');
    return reply.code(500).send({ error: 'internal', message: 'Interner Fehler' } satisfies FeedbackErrorResponse);
  });

  app.post(
    '/api/feedback',
    { onRequest: requireUser, config: rateLimitConfig, bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const input = validateFeedback(request.body);
      if (!input.ok) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', message: input.message } satisfies FeedbackErrorResponse);
      }
      const user = request.feedbackUser;
      if (user === null) return reply.code(401).send(UNAUTHORIZED);
      const created = await insertFeedback(db, user.id, input.value, normalizeUserAgent(request.headers['user-agent']));
      return reply.code(201).send({ feedback: created } satisfies FeedbackCreatedResponse);
    },
  );

  app.get('/api/admin/feedback', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const status = query['status'];
    if (status !== undefined && status !== 'all' && !isFeedbackStatus(status)) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Unbekannter Status' } satisfies FeedbackErrorResponse);
    }
    const rawLimit = query['limit'];
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Ungültiges Limit' } satisfies FeedbackErrorResponse);
    }
    const [feedback, counts] = await Promise.all([
      listFeedback(db, {
        status: isFeedbackStatus(status) ? status : null,
        ...(limit === undefined ? {} : { limit }),
      }),
      countFeedback(db),
    ]);
    return { feedback, counts } satisfies FeedbackListResponse;
  });

  app.patch('/api/admin/feedback/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { status?: unknown } | null | undefined;
    const status = body?.status;
    if (!Number.isInteger(id) || id < 1 || id > 2 ** 31 - 1) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: 'Feedback nicht gefunden' } satisfies FeedbackErrorResponse);
    }
    if (!isFeedbackStatus(status)) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Unbekannter Status' } satisfies FeedbackErrorResponse);
    }
    const item = await updateFeedbackStatus(db, id, status);
    if (item === null) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: 'Feedback nicht gefunden' } satisfies FeedbackErrorResponse);
    }
    return { feedback: item } satisfies FeedbackItemResponse;
  });
};
