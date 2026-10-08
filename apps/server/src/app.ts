import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { loadAuthConfig, type AuthConfig } from './auth/config';
import { authRoutes } from './auth/routes';
import { getUserFromCookieHeader } from './auth/session';
import type { Database } from './db';
import { GameServer, type GameServerOptions } from './game/game-server';
import { createPgTableRepository } from './game/pg-repository';
import { registerWebSocket, type Authenticate } from './ws';

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
  /**
   * Game-Server (WP-011). Standard: Tische in Postgres (`createPgTableRepository(db)`), echte Uhr, `cryptoRng`,
   * Pause nach jeder Hand `DEFAULT_HAND_PAUSE_MS`. Tests übergeben z. B. In-Memory-Repository und Pause 0.
   */
  game?: Partial<Omit<GameServerOptions, 'log'>> & {
    /** Standard: Session aus dem Cookie per `getUserFromCookieHeader(db, …)`. */
    authenticate?: Authenticate;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Game-Server mit allen Tischen im Speicher (WP-011). */
    game: GameServer;
  }
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
  game: gameOptions = {},
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger, trustProxy });
  const { authenticate = (cookie) => getUserFromCookieHeader(db, cookie), ...rest } = gameOptions;
  const game = new GameServer({ repository: createPgTableRepository(db), ...rest, log: app.log });
  app.decorate('game', game);

  app.addHook('onClose', async () => {
    await db.close();
  });

  registerWebSocket(app, {
    publicOrigin,
    authenticate,
    game,
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
