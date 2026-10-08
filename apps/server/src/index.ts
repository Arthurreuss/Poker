import { engineInfo } from '@poker/engine';

export { buildApp, type AppOptions, type HealthResponse } from './app';
export { registerWebSocket, WS_PATH, HEARTBEAT_INTERVAL_MS, type WebSocketOptions } from './ws';
export { loadConfig, type ServerConfig } from './config';
export { createPgDatabase, type Database } from './db';

export function serverInfo(): { name: string; engine: string } {
  return { name: '@poker/server', engine: engineInfo().name };
}
