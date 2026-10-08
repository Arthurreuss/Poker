import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db';

export interface AppOptions {
  db: Database;
  logger?: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
}

/** Baut die Fastify-App ohne `listen` – Tests nutzen `app.inject()`. */
export function buildApp({ db, logger = false }: AppOptions): FastifyInstance {
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

  return app;
}
