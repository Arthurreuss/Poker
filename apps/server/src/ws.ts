// WebSocket-Endpunkt `/ws` – PLATZHALTER (WP-003): Echo + Heartbeat, damit der Weg
// Browser → Reverse-Proxy/Tunnel → Server geprüft werden kann. Das echte Protokoll baut WP-011 darauf auf.
// Regeln aus D-014: Origin-Prüfung gegen PUBLIC_ORIGIN, Heartbeat alle 30 s.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';

export const WS_PATH = '/ws';
export const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_PAYLOAD_BYTES = 64 * 1024;

export interface WebSocketOptions {
  /** Erlaubte Origin des Browsers, z. B. `https://poker.arthur-reuss.de` (D-014). */
  publicOrigin: string;
  /** Abstand der Pings; Clients ohne Pong bis zum nächsten Ping werden getrennt. */
  heartbeatIntervalMs?: number;
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Hängt den WebSocket-Server an den HTTP-Server der Fastify-App (Upgrade auf `/ws`). */
export function registerWebSocket(app: FastifyInstance, options: WebSocketOptions): void {
  const { publicOrigin, heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) {
      reject(socket, 404, 'Not Found');
      return;
    }
    if (req.headers.origin !== publicOrigin) {
      app.log.warn({ origin: req.headers.origin }, 'WebSocket: Origin abgelehnt');
      reject(socket, 403, 'Forbidden');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      // Platzhalter: Echo.
      ws.send(data, { binary: isBinary });
    });
    ws.send(JSON.stringify({ type: 'hello', placeholder: true }));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) !== true) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  // Vor dem Schließen des HTTP-Servers offene Verbindungen beenden, sonst wartet `close` ewig.
  app.addHook('preClose', async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) {
      ws.terminate();
    }
    await new Promise<void>((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
  });
}
