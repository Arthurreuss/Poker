// Testhilfe (WP-018): steuerbarer WebSocket-Ersatz für `GameConnection`.
import type { ClientMessage, ServerMessage } from '@poker/engine/protocol';
import { GameConnection, type BrowserEvents, type SocketLike } from '../connection';

export class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientMessage[] = [];
  closed: { code?: number | undefined; reason?: string | undefined } | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  // --- Steuerung aus dem Test ---
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  receive(message: ServerMessage) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
  serverClose(code = 1006) {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code }));
  }
  types() {
    return this.sent.map((m) => m.type);
  }
}

export const WELCOME: ServerMessage = { type: 'welcome', protocolVersion: 1, user: { id: 1, username: 'anna' } };

/** Verbindung über `FakeSocket`s; `connect()` öffnet den letzten Socket und schickt `welcome`. */
export function fakeConnection(
  options: { checkSession?: () => Promise<boolean>; events?: BrowserEvents | null; welcome?: ServerMessage } = {},
) {
  const sockets: FakeSocket[] = [];
  const connection = new GameConnection({
    url: () => 'ws://test/ws',
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    random: () => 0.5, // keine Streuung
    events: options.events ?? null,
    checkSession: options.checkSession ?? (() => Promise.resolve(true)),
  });
  const last = () => {
    const s = sockets.at(-1);
    if (s === undefined) throw new Error('kein Socket');
    return s;
  };
  const connect = () => {
    last().open();
    last().receive(options.welcome ?? WELCOME);
  };
  return { connection, sockets, last, connect };
}
