import { engineInfo } from '@poker/engine';

export { buildApp, type AppOptions, type HealthResponse } from './app';
export { registerWebSocket, WS_PATH, HEARTBEAT_INTERVAL_MS, type WebSocketOptions } from './ws';
export { loadConfig, type ServerConfig } from './config';
export { createPgDatabase, type Database, type Queryable } from './db';
export { loadAuthConfig, type AuthConfig } from './auth/config';
export { getUserFromCookieHeader, getUserFromSessionToken, SESSION_COOKIE, type AuthUser } from './auth/session';

export function serverInfo(): { name: string; engine: string } {
  return { name: '@poker/server', engine: engineInfo().name };
}
