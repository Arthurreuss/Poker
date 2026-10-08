// Kleiner WebSocket-Client für Lobby und Einladungsseite (WP-015). Bewusst eigenständig und ohne React,
// damit er später mit dem Spiel-Client aus WP-018 (`src/game/`) zusammengeführt werden kann.
// Verbindungsregeln (D-014, D-022): ARCHITECTURE.md, „Timer und Verbindungsmodell“ → „Was der Client tun muss“.
import {
  CLOSE_REPLACED,
  CLOSE_UNSUPPORTED_VERSION,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type LobbyTable,
  type ServerMessage,
  type TableSettingsInput,
} from '@poker/engine/protocol';
import { wsUrl } from '../api/ws';

/**
 * - `connecting`: Verbindung wird (wieder) aufgebaut
 * - `online`: `welcome` erhalten, Lobby abonniert
 * - `replaced`: anderer Tab/Gerät hat übernommen (4001) – kein automatischer Reconnect
 * - `outdated`: Protokollversion passt nicht (4000) – Seite neu laden
 */
export type LobbyStatus = 'connecting' | 'online' | 'replaced' | 'outdated';

export interface LobbyState {
  status: LobbyStatus;
  /** Öffentliche Tische, nach ID sortiert (nur mit `subscribe`). */
  tables: readonly LobbyTable[];
}

/** Was der Client von einem WebSocket braucht (Browser-`WebSocket` oder Test-Double). */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export const browserSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

export interface LobbyClientOptions {
  socketFactory?: SocketFactory;
  /** Standard: `wsUrl('/ws')`. */
  url?: string;
  /** Lobby-Liste abonnieren (Lobby-Seite) oder nicht (Einladungsseite). Standard: true. */
  subscribe?: boolean;
}

/** Fehler einer Anfrage (`error` vom Server oder Verbindung weg). */
export class LobbyRequestError extends Error {
  constructor(
    readonly code: ErrorCode | 'DISCONNECTED',
    message: string,
  ) {
    super(message);
    this.name = 'LobbyRequestError';
  }
}

const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 10_000;

interface Pending {
  resolve(message: ServerMessage): void;
  reject(error: LobbyRequestError): void;
  /** Erfolgsnachricht ohne `requestId` erkennen (z. B. `table.state` nach `table.join`). */
  matches(message: ServerMessage): boolean;
}

export class LobbyClient {
  private state: LobbyState = { status: 'connecting', tables: [] };
  private readonly listeners = new Set<() => void>();
  private socket: SocketLike | null = null;
  private running = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly socketFactory: SocketFactory;
  private readonly subscribeLobby: boolean;

  constructor(private readonly options: LobbyClientOptions = {}) {
    this.socketFactory = options.socketFactory ?? browserSocketFactory;
    this.subscribeLobby = options.subscribe ?? true;
  }

  // --- Zustand für React (`useSyncExternalStore`) ---------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): LobbyState => this.state;

  // --- Lebenszyklus ----------------------------------------------------------

  /** Verbindet (mehrfacher Aufruf harmlos; nach `stop()` wieder möglich). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    window.addEventListener('online', this.retryNow);
    document.addEventListener('visibilitychange', this.retryNow);
    this.open();
  }

  /** Trennt dauerhaft; offene Anfragen schlagen fehl. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener('online', this.retryNow);
    document.removeEventListener('visibilitychange', this.retryNow);
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      this.detach(socket);
      socket.close(1000, 'lobby closed');
    }
    this.failPending();
  }

  /** Bewusst neu verbinden, z. B. nach 4001 („Hier weiterspielen“). */
  reconnect(): void {
    this.stop();
    this.setState({ status: 'connecting' });
    this.start();
  }

  // --- Anfragen --------------------------------------------------------------

  /** Tisch anlegen; der Server lässt den Ersteller den Tisch automatisch beobachten. */
  async createTable(settings: TableSettingsInput): Promise<{ tableId: number; inviteCode: string }> {
    const message = await this.request({ type: 'table.create', settings }, () => false, 'table.created');
    if (message.type !== 'table.created') throw new LobbyRequestError('INTERNAL', 'Unerwartete Antwort');
    return { tableId: message.tableId, inviteCode: message.inviteCode };
  }

  /** Per Einladungscode beitreten (Zuschauen); liefert die Tisch-ID. */
  async joinByInvite(inviteCode: string): Promise<number> {
    const message = await this.request(
      { type: 'table.join', inviteCode },
      (m) => m.type === 'table.state' && m.table.inviteCode === inviteCode,
    );
    if (message.type !== 'table.state') throw new LobbyRequestError('INTERNAL', 'Unerwartete Antwort');
    return message.table.id;
  }

  private request(
    message: ClientMessage,
    matches: (m: ServerMessage) => boolean,
    replyType?: 'table.created',
  ): Promise<ServerMessage> {
    const socket = this.socket;
    if (socket === null || this.state.status !== 'online') {
      return Promise.reject(new LobbyRequestError('DISCONNECTED', 'Keine Verbindung zum Server – bitte kurz warten'));
    }
    const requestId = `l${String(this.nextRequestId++)}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        matches: (m) => (replyType !== undefined && m.type === replyType && m.requestId === requestId) || matches(m),
      });
      socket.send(JSON.stringify({ ...message, requestId }));
    });
  }

  // --- Verbindung ------------------------------------------------------------

  private open(): void {
    this.setState({ status: 'connecting' });
    let socket: SocketLike;
    try {
      socket = this.socketFactory(this.options.url ?? wsUrl('/ws'));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION });
    };
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') this.onMessage(event.data);
    };
    socket.onerror = () => undefined; // Danach kommt immer `close`.
    socket.onclose = (event) => {
      this.onClose(socket, event.code);
    };
  }

  private onMessage(text: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    // Jede Nachricht zeigt: Verbindung lebt.
    if (this.pongTimer !== null) clearTimeout(this.pongTimer);
    this.pongTimer = null;

    switch (message.type) {
      case 'welcome':
        this.attempt = 0;
        if (this.subscribeLobby) this.send({ type: 'lobby.subscribe' });
        this.setState({ status: 'online' });
        this.startPing();
        return;
      case 'lobby.snapshot':
        this.setState({ tables: [...message.tables].sort((a, b) => a.id - b.id) });
        return;
      case 'lobby.update': {
        const others = this.state.tables.filter((t) => t.id !== message.table.id);
        this.setState({ tables: [...others, message.table].sort((a, b) => a.id - b.id) });
        return;
      }
      case 'lobby.remove':
        this.setState({ tables: this.state.tables.filter((t) => t.id !== message.tableId) });
        return;
      case 'error': {
        const entry = message.requestId === null ? undefined : this.pending.get(message.requestId);
        if (entry !== undefined && message.requestId !== null) {
          this.pending.delete(message.requestId);
          entry.reject(new LobbyRequestError(message.code, message.message));
        }
        return;
      }
      default:
        for (const [id, entry] of this.pending) {
          if (entry.matches(message)) {
            this.pending.delete(id);
            entry.resolve(message);
          }
        }
    }
  }

  private onClose(socket: SocketLike, code: number): void {
    if (socket !== this.socket) return;
    this.detach(socket);
    this.socket = null;
    this.clearTimers();
    this.failPending();
    if (!this.running) return;
    if (code === CLOSE_REPLACED || code === CLOSE_UNSUPPORTED_VERSION) {
      this.running = false;
      window.removeEventListener('online', this.retryNow);
      document.removeEventListener('visibilitychange', this.retryNow);
      this.setState({ status: code === CLOSE_REPLACED ? 'replaced' : 'outdated' });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.setState({ status: 'connecting' });
    if (this.reconnectTimer !== null) return;
    // Exponentiell 0,5 s … 10 s mit Zufallsanteil.
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt);
    this.attempt += 1;
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running && this.socket === null) this.open();
    }, delay);
  }

  /** Bei `online` oder sichtbarem Tab sofort neu versuchen, statt den Backoff abzuwarten. */
  private readonly retryNow = (): void => {
    if (!this.running || this.socket !== null || document.visibilityState === 'hidden') return;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.open();
  };

  private startPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
      if (this.pongTimer !== null) return;
      this.pongTimer = setTimeout(() => {
        // Keine Antwort: Verbindung als tot behandeln, neu verbinden.
        const socket = this.socket;
        if (socket !== null) {
          socket.close(4002, 'pong timeout');
          this.onClose(socket, 1006);
        }
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private send(message: ClientMessage): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // Verbindung bricht gerade ab – `close` folgt.
    }
  }

  private detach(socket: SocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.pongTimer !== null) clearTimeout(this.pongTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private failPending(): void {
    for (const entry of this.pending.values()) {
      entry.reject(new LobbyRequestError('DISCONNECTED', 'Verbindung unterbrochen – bitte erneut versuchen'));
    }
    this.pending.clear();
  }

  private setState(patch: Partial<LobbyState>): void {
    const next = { ...this.state, ...patch };
    if (next.status === this.state.status && next.tables === this.state.tables) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
