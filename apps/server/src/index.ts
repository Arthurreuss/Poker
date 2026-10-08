import { engineInfo } from '@poker/engine';

export { buildApp, type AppOptions, type HealthResponse } from './app';
export { loadConfig, type ServerConfig } from './config';
export { createPgDatabase, type Database } from './db';

export function serverInfo(): { name: string; engine: string } {
  return { name: '@poker/server', engine: engineInfo().name };
}
