// Platzhalter – Fastify und WebSocket folgen in eigenen WPs.
import { engineInfo } from '@poker/engine';

export function serverInfo(): { name: string; engine: string } {
  return { name: '@poker/server', engine: engineInfo().name };
}
