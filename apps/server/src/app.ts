import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { loadAuthConfig, type AuthConfig } from './auth/config';
import { authRoutes } from './auth/routes';
import type { Database } from './db';
import { registerWebSocket } from './ws';

export interface AppOptions {
  db: Database;
  /** Erlaubte Origin für WebSocket-Upgrades (D-014). */
  publicOrigin: string;
  /** `true`/`false` oder Pino-Optionen (Tests fangen damit Logs ab). */
  logger?: FastifyServerOptions['logger'];
  /** Proxy-Header vertrauen – nur in prod (D-014), siehe `loadConfig`. */
  trustProxy?: boolean;
  /** Nur für Tests: kürzerer Heartbeat. */
  heartbeatIntervalMs?: number;
  /** Standard: `loadAuthConfig(process.env)`. */
  auth?: AuthConfig;
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
  auth = loadAuthConfig(process.env),
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

  void app.register(authRoutes, { db, config: auth });

  return app;
}
