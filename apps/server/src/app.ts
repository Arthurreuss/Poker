import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { loadAuthConfig, type AuthConfig } from './auth/config';
import { authRoutes } from './auth/routes';
import { getUserFromCookieHeader } from './auth/session';
import type { Database } from './db';
import { GameServer, type GameServerOptions } from './game/game-server';
import { createPgTableRepository } from './game/pg-repository';
import { combineHooks, createHandHistoryHooks } from './history/hooks';
import { DEFAULT_RETRY_DELAYS_MS, withFinishRoundRetry } from './history/retry';
import { createPgHandHistoryStore, type HandHistoryStore } from './history/store';
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
    /**
     * Hand-Historie (WP-013). Standard: Postgres (`createPgHandHistoryStore(db)`), wenn auch das Repository
     * der Standard ist; mit eigenem `repository` (Tests ohne DB) keine Historie. `null` schaltet sie ab.
     * Die Hooks aus `hooks` laufen zusätzlich, nach der Historie.
     */
    history?: HandHistoryStore | null;
    /** Wartezeiten der Retries beim Speichern (Historie, Rundenergebnis). Standard: `DEFAULT_RETRY_DELAYS_MS`. */
    retryDelaysMs?: readonly number[];
  };
}

/** Beim Herunterfahren höchstens so lange auf ausstehende Schreibvorgänge warten. */
const SHUTDOWN_FLUSH_TIMEOUT_MS = 10_000;

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
  const {
    authenticate = (cookie) => getUserFromCookieHeader(db, cookie),
    history = gameOptions.repository === undefined ? createPgHandHistoryStore(db) : null,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    repository,
    hooks,
    ...rest
  } = gameOptions;
  const retry = { delaysMs: retryDelaysMs, log: app.log };
  const game = new GameServer({
    ...rest,
    repository: repository ?? withFinishRoundRetry(createPgTableRepository(db), retry),
    hooks: combineHooks(history === null ? {} : createHandHistoryHooks(history, retry), hooks ?? {}),
    log: app.log,
  });
  app.decorate('game', game);

  app.addHook('onClose', async () => {
    // Ausstehende Hand-Historie und Rundenergebnisse noch schreiben (WP-013), aber nicht ewig warten.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS);
    });
    await Promise.race([game.idle(), timeout]);
    clearTimeout(timer);
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
