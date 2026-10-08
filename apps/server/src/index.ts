import { engineInfo } from '@poker/engine';

export { buildApp, type AppOptions, type HealthResponse } from './app';
export { loadConfig, type ServerConfig } from './config';
export { createPgDatabase, type Database, type Queryable } from './db';
export { loadAuthConfig, type AuthConfig } from './auth/config';
export { getUserFromCookieHeader, getUserFromSessionToken, SESSION_COOKIE, type AuthUser } from './auth/session';

export function serverInfo(): { name: string; engine: string } {
  return { name: '@poker/server', engine: engineInfo().name };
}
