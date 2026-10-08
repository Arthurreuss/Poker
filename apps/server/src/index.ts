import { engineInfo } from '@poker/engine';

export { buildApp, type AppOptions, type HealthResponse } from './app';
export { registerWebSocket, WS_PATH, HEARTBEAT_INTERVAL_MS, type Authenticate, type WebSocketOptions } from './ws';
export {
  GameServer,
  DEFAULT_HAND_PAUSE_MS,
  CLOSE_UNSUPPORTED_VERSION,
  CLOSE_REPLACED,
  DEFAULT_DISCONNECT_GRACE_MS,
  type Connection,
  type GameClient,
  type GameServerOptions,
} from './game/game-server';
export { Table, playerIdOf, type TableResult } from './game/table';
export { ManualClock, systemClock, type Clock, type Cancel } from './game/clock';
export type { GameHooks, HandCompleteEvent, HandStartedEvent, RoundCompleteEvent } from './game/hooks';
export { InMemoryTableRepository, type TableRepository } from './game/repository';
export { createPgTableRepository, closeOrphanedTables } from './game/pg-repository';
export { loadConfig, type ServerConfig } from './config';
export { createPgDatabase, type Database, type Queryable } from './db';
export { loadAuthConfig, type AuthConfig } from './auth/config';
export { getUserFromCookieHeader, getUserFromSessionToken, SESSION_COOKIE, type AuthUser } from './auth/session';

export function serverInfo(): { name: string; engine: string } {
  return { name: '@poker/server', engine: engineInfo().name };
}
