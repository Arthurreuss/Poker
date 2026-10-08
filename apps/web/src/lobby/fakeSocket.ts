// Test-Helfer (WP-015): WebSocket-Double für den Lobby-Client. Der Test spielt den Server.
import type { ClientMessage, ServerMessage } from '@poker/engine/protocol';
import type { SocketFactory, SocketLike } from './client';

export class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  readonly sent: ClientMessage[] = [];
  closed: { code: number | undefined; reason: string | undefined } | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  // --- Server-Seite ---

  open(): void {
    this.onopen?.({});
  }

  receive(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Verbindung öffnen und `welcome` schicken. */
  welcome(userId = 2, username = 'spieler_1'): void {
    this.open();
    this.receive({ type: 'welcome', protocolVersion: 1, user: { id: userId, username } });
  }

  serverClose(code: number): void {
    this.onclose?.({ code });
  }

  last<T extends ClientMessage['type']>(type: T): Extract<ClientMessage, { type: T }> {
    const found = [...this.sent].reverse().find((m) => m.type === type);
    if (found === undefined) throw new Error(`keine Nachricht ${type}`);
    return found as Extract<ClientMessage, { type: T }>;
  }
}

/** Fabrik, die alle erzeugten Sockets mitschreibt. */
export function fakeSocketFactory(): { factory: SocketFactory; sockets: FakeSocket[]; latest: () => FakeSocket } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    latest: () => {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error('kein Socket');
      return socket;
    },
  };
}
