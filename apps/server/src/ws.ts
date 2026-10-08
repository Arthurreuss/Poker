// WebSocket-Endpunkt `/ws` (WP-011): Upgrade mit Origin-Prüfung und Session-Cookie, danach JSON-Nachrichten
// nach `@poker/engine/protocol`, verarbeitet vom `GameServer`. Regeln aus D-014: Origin-Prüfung gegen
// PUBLIC_ORIGIN, Heartbeat alle 30 s. Ablauf: ARCHITECTURE.md, „Game-Server: Protokoll und Tische“.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { MAX_MESSAGE_BYTES, type ServerMessage } from '@poker/engine/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { AuthUser } from './auth/session';
import type { GameServer } from './game/game-server';

export const WS_PATH = '/ws';
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Löst den User aus dem rohen `Cookie`-Header auf (Standard: `getUserFromCookieHeader` gegen die DB). */
export type Authenticate = (cookieHeader: string | undefined) => Promise<AuthUser | null>;

export interface WebSocketOptions {
  /** Erlaubte Origin(s) des Browsers, z. B. `https://poker.arthur-reuss.de` (D-014, D-023). */
  publicOrigin: string | readonly string[];
  authenticate: Authenticate;
  game: GameServer;
  /** Abstand der Pings; Clients ohne Pong bis zum nächsten Ping werden getrennt. */
  heartbeatIntervalMs?: number;
}

function reject(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** Schließcode, wenn der Account gelöscht wurde (WP-022): Policy Violation; ein Reconnect scheitert mit 401. */
export const CLOSE_ACCOUNT_DELETED = 1008;

export interface WebSocketControl {
  /** Schließt alle offenen Verbindungen eines Users (z. B. nach dem Löschen des Kontos). */
  closeUserConnections(userId: number, code: number, reason: string): void;
}

/** Hängt den WebSocket-Server an den HTTP-Server der Fastify-App (Upgrade auf `/ws`). */
export function registerWebSocket(app: FastifyInstance, options: WebSocketOptions): WebSocketControl {
  const { publicOrigin, authenticate, game, heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS } = options;
  const allowedOrigins = new Set(typeof publicOrigin === 'string' ? [publicOrigin] : publicOrigin);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();
  const userOf = new WeakMap<WebSocket, number>();

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Bricht der Client während der (asynchronen) Session-Prüfung ab, darf das den Prozess nicht stören.
    socket.on('error', () => undefined);
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) {
      reject(socket, 404, 'Not Found');
      return;
    }
    if (req.headers.origin === undefined || !allowedOrigins.has(req.headers.origin)) {
      app.log.warn({ origin: req.headers.origin }, 'WebSocket: Origin abgelehnt');
      reject(socket, 403, 'Forbidden');
      return;
    }
    authenticate(req.headers.cookie).then(
      (user) => {
        if (user === null) {
          reject(socket, 401, 'Unauthorized');
          return;
        }
        if (socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req, user);
        });
      },
      (error: unknown) => {
        app.log.error({ err: error }, 'WebSocket: Session-Prüfung fehlgeschlagen');
        reject(socket, 500, 'Internal Server Error');
      },
    );
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, user: AuthUser) => {
    alive.set(ws, true);
    userOf.set(ws, user.id);
    ws.on('pong', () => alive.set(ws, true));

    const client = game.connect(
      { id: user.id, username: user.username },
      {
        send(message: ServerMessage) {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
        },
        close(code: number, reason: string) {
          ws.close(code, reason);
        },
      },
    );

    // Nachrichten einer Verbindung strikt nacheinander verarbeiten (manche warten auf die DB).
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      const text = isBinary ? '' : toText(data);
      queue = queue
        .then(() => game.handle(client, text)) // Binärframes → '' → BAD_MESSAGE
        .catch((error: unknown) => {
          app.log.error({ err: error }, 'WebSocket: Nachricht nicht verarbeitet');
        });
    });
    ws.on('close', () => {
      queue = queue.then(() => {
        game.disconnect(client);
      });
    });
    ws.on('error', (error) => {
      app.log.warn({ err: error }, 'WebSocket-Fehler');
    });
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
    game.close();
    for (const ws of wss.clients) {
      ws.terminate();
    }
    await new Promise<void>((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
  });

  return {
    closeUserConnections(userId, code, reason) {
      for (const ws of wss.clients) {
        if (userOf.get(ws) === userId) ws.close(code, reason);
      }
    },
  };
}
