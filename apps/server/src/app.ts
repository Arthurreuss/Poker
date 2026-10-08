import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { loadAuthConfig, type AuthConfig } from './auth/config';
import { authRoutes } from './auth/routes';
import type { Database } from './db';

export interface AppOptions {
  db: Database;
  /** `true`/`false` oder Pino-Optionen (Tests fangen damit Logs ab). */
  logger?: FastifyServerOptions['logger'];
  /** Standard: `loadAuthConfig(process.env)`. */
  auth?: AuthConfig;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
}

/** Baut die Fastify-App ohne `listen` – Tests nutzen `app.inject()`. */
export function buildApp({ db, logger = false, auth = loadAuthConfig(process.env) }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  app.addHook('onClose', async () => {
    await db.close();
  });

  app.get('/api/health', async (request, reply): Promise<HealthResponse> => {
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
