// Lobby und Einladungsseite über die gemeinsame Verbindung der App (`GameConnection`, ADR 0002): Lobby-Liste
// abonnieren, Tisch anlegen, per Einladungscode beitreten. Wiederverbinden, Heartbeat und die Regeln für
// 4000/4001 liegen in der Verbindung. Verbindungsregeln (D-014, D-022): ARCHITECTURE.md, „Timer und
// Verbindungsmodell“ → „Was der Client tun muss“.
import type { ClientMessage, ErrorCode, LobbyTable, ServerMessage, TableSettingsInput } from '@poker/engine/protocol';
import type { ConnectionStatus, GameConnection } from '../game/connection';

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

export interface LobbyClientOptions {
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

interface Pending {
  resolve(message: ServerMessage): void;
  reject(error: LobbyRequestError): void;
  /** Erfolgsnachricht ohne `requestId` erkennen (z. B. `table.state` nach `table.join`). */
  matches(message: ServerMessage): boolean;
}

export function lobbyStatus(status: ConnectionStatus): LobbyStatus {
  switch (status.kind) {
    case 'open':
      return 'online';
    case 'replaced':
      return 'replaced';
    case 'failed':
      return status.reason === 'version' ? 'outdated' : 'connecting';
    default:
      return 'connecting';
  }
}

export class LobbyClient {
  private state: LobbyState;
  private readonly listeners = new Set<() => void>();
  private off: (() => void)[] = [];
  private subscribed = false;
  private nextRequestId = 1;
  private readonly pending = new Map<string, Pending>();
  /** Selbst angelegte Tische: der Server beobachtet sie für uns, freigegeben wird mit `stop`. */
  private readonly created = new Set<number>();
  private readonly subscribeLobby: boolean;

  constructor(
    private readonly connection: GameConnection,
    options: LobbyClientOptions = {},
  ) {
    this.subscribeLobby = options.subscribe ?? true;
    this.state = { status: lobbyStatus(connection.status), tables: [] };
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

  /** Hängt sich an die Verbindung (mehrfacher Aufruf harmlos; nach `stop()` wieder möglich). */
  start(): void {
    if (this.off.length > 0) return;
    this.off = [
      this.connection.onStatus((status) => {
        this.onStatus(status);
      }),
      this.connection.onMessage((message) => {
        this.onMessage(message);
      }),
    ];
    this.connection.start();
    this.onStatus(this.connection.status);
  }

  /** Löst sich von der Verbindung (sie bleibt offen); offene Anfragen schlagen fehl. */
  stop(): void {
    for (const off of this.off) off();
    this.off = [];
    if (this.subscribed) this.connection.send({ type: 'lobby.unsubscribe' });
    this.subscribed = false;
    for (const tableId of this.created) this.connection.unwatchTable(tableId);
    this.created.clear();
    this.failPending();
  }

  /** Bewusst neu verbinden, z. B. nach 4001 („Hier weiterspielen“). */
  reconnect(): void {
    this.connection.reconnectNow();
  }

  // --- Anfragen --------------------------------------------------------------

  /** Tisch anlegen; der Server lässt den Ersteller den Tisch automatisch beobachten. */
  async createTable(settings: TableSettingsInput): Promise<{ tableId: number; inviteCode: string }> {
    const message = await this.request({ type: 'table.create', settings }, () => false, 'table.created');
    if (message.type !== 'table.created') throw new LobbyRequestError('INTERNAL', 'Unerwartete Antwort');
    if (!this.created.has(message.tableId) && this.off.length > 0) {
      this.created.add(message.tableId);
      this.connection.watchTable(message.tableId);
    }
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
    const requestId = `l${String(this.nextRequestId++)}`;
    return new Promise((resolve, reject) => {
      if (this.state.status !== 'online' || !this.connection.send({ ...message, requestId })) {
        reject(new LobbyRequestError('DISCONNECTED', 'Keine Verbindung zum Server – bitte kurz warten'));
        return;
      }
      this.pending.set(requestId, {
        resolve,
        reject,
        matches: (m) => (replyType !== undefined && m.type === replyType && m.requestId === requestId) || matches(m),
      });
    });
  }

  // --- Verbindung ------------------------------------------------------------

  private onStatus(status: ConnectionStatus): void {
    if (status.kind === 'open') {
      if (this.subscribeLobby && !this.subscribed) {
        this.subscribed = this.connection.send({ type: 'lobby.subscribe' });
      }
    } else {
      // Nach einem Abbruch kennt der Server das Abo nicht mehr; offene Anfragen bekommen keine Antwort.
      this.subscribed = false;
      this.failPending();
    }
    this.setState({ status: lobbyStatus(status) });
  }

  private onMessage(message: ServerMessage): void {
    switch (message.type) {
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
