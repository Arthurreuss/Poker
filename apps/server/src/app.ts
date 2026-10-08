import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db';
import { registerWebSocket } from './ws';

export interface AppOptions {
  db: Database;
  /** Erlaubte Origin für WebSocket-Upgrades (D-014). */
  publicOrigin: string;
  logger?: boolean;
  /** Proxy-Header vertrauen – nur in prod (D-014), siehe `loadConfig`. */
  trustProxy?: boolean;
  /** Nur für Tests: kürzerer Heartbeat. */
  heartbeatIntervalMs?: number;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
}

/** Baut die Fastify-App ohne `listen` – Tests nutzen `app.inject()`. */
export function buildApp({
  db,
  publicOrigin,
  logger = false,
  trustProxy = false,
  heartbeatIntervalMs,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger, trustProxy });

  app.addHook('onClose', async () => {
    await db.close();
  });

  registerWebSocket(app, {
    publicOrigin,
    ...(heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs }),
  });

  // logLevel warn: Healthchecks (alle paar Sekunden) erzeugen keine Request-Logs, Fehler schon.
  app.get('/api/health', { logLevel: 'warn' }, async (request, reply): Promise<HealthResponse> => {
    try {
      await db.ping();
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      request.log.warn({ err }, 'Health: Datenbank nicht erreichbar');
      return reply.code(503).send({ status: 'error', db: 'error' });
    }
  });

  return app;
}
