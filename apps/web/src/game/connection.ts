// WebSocket-Verbindung zum Game-Server (WP-018): `hello`, Wiederverbinden mit exponentiellem Backoff,
// Abbruch-Erkennung (Heartbeat auf Anwendungsebene) und erneutes Beitreten zu beobachteten Tischen.
// Framework-unabhängig und mit injizierbarem Socket testbar. Beschreibung: ARCHITECTURE.md,
// „Frontend: Spielablauf und Verbindung“.
import {
  CLOSE_REPLACED,
  CLOSE_UNSUPPORTED_VERSION,
  PROTOCOL_VERSION,
  type ClientMessage,
  type PublicUser,
  type ServerMessage,
} from '@poker/engine/protocol';
import { wsUrl } from '../api/ws';

/**
 * - `connecting`: Socket wird geöffnet bzw. wartet auf `welcome`
 * - `open`: `welcome` erhalten, Nachrichten können gesendet werden
 * - `waiting`: Verbindung verloren, nächster Versuch um `retryAt` (lokale Uhr)
 * - `replaced`: ein anderer Tab/ein anderes Gerät desselben Users hat übernommen (Close 4001) –
 *   kein automatisches Wiederverbinden, nur bewusst per `reconnectNow` („Hier weiterspielen“)
 * - `failed`: endgültig – `version` (Close 4000, Seite neu laden) oder `unauthorized` (Session abgelaufen)
 * - `closed`: bewusst beendet (`stop`)
 */
export type ConnectionStatus =
  | { readonly kind: 'connecting'; readonly attempt: number }
  | { readonly kind: 'open' }
  | { readonly kind: 'waiting'; readonly attempt: number; readonly retryAt: number }
  | { readonly kind: 'replaced' }
  | { readonly kind: 'failed'; readonly reason: 'version' | 'unauthorized'; readonly message: string }
  | { readonly kind: 'closed' };

/** Was die Verbindung von einem WebSocket braucht (Browser-`WebSocket` passt). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface BackoffOptions {
  /** Wartezeit nach dem ersten Abbruch. */
  readonly initialMs: number;
  readonly factor: number;
  readonly maxMs: number;
  /** Zufällige Streuung ± Anteil (0–1), damit nicht alle Clients gleichzeitig wiederkommen. */
  readonly jitter: number;
}

export interface HeartbeatOptions {
  /** Ohne eingehende Nachricht so lange → Probe senden. */
  readonly idleMs: number;
  /** Keine Antwort auf die Probe innerhalb dieser Zeit → Verbindung gilt als tot. */
  readonly timeoutMs: number;
}

/** Minimale Schnittstelle für Browser-Ereignisse (`window`, `document`); in Tests ersetzbar. */
export interface BrowserEvents {
  readonly window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  readonly document:
    (Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { visibilityState: string }) | null;
}

export interface GameConnectionOptions {
  /** Standard: `wsUrl('/ws')` (gleiche Origin, D-014). */
  readonly url?: () => string;
  /** Standard: Browser-`WebSocket`. */
  readonly createSocket?: SocketFactory;
  readonly backoff?: Partial<BackoffOptions>;
  /** `false` schaltet die Abbruch-Erkennung per Probe ab. */
  readonly heartbeat?: Partial<HeartbeatOptions> | false;
  /** Zufall für die Streuung (Tests: fest). */
  readonly random?: () => number;
  readonly now?: () => number;
  /** Standard: globales `window`/`document`; `null` = keine Browser-Ereignisse. */
  readonly events?: BrowserEvents | null;
  /**
   * Prüft nach mehreren Fehlversuchen ohne `welcome`, ob die Session noch gilt (eine HTTP-Ablehnung
   * des Upgrades, z. B. 401, sieht der Browser nur als Abbruch). `false` → Status `failed`/`unauthorized`.
   * Standard: `GET /api/me`.
   */
  readonly checkSession?: () => Promise<boolean>;
  /** Nach so vielen Fehlversuchen in Folge wird `checkSession` gefragt. */
  readonly sessionCheckAfter?: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 500, factor: 2, maxMs: 10_000, jitter: 0.2 };
/** `ping` nach 20 s ohne eingehende Nachricht, tot nach weiteren 10 s ohne Antwort (WP-012). */
export const DEFAULT_HEARTBEAT: HeartbeatOptions = { idleMs: 20_000, timeoutMs: 10_000 };
export const DEFAULT_SESSION_CHECK_AFTER = 3;

async function defaultCheckSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    return res.status !== 401;
  } catch {
    return true; // Server nicht erreichbar – weiter versuchen
  }
}

/** Wartezeit vor dem `attempt`-ten Wiederverbindungsversuch (1-basiert), ohne Streuung. */
export function backoffDelay(attempt: number, options: BackoffOptions = DEFAULT_BACKOFF): number {
  const raw = options.initialMs * options.factor ** Math.max(0, attempt - 1);
  return Math.min(options.maxMs, raw);
}

const SOCKET_OPEN = 1;

function defaultEvents(): BrowserEvents | null {
  if (typeof window === 'undefined') return null;
  return { window, document: typeof document === 'undefined' ? null : document };
}

type Listener<T> = (value: T) => void;

/**
 * Eine WebSocket-Verbindung zum Game-Server mit automatischem Wiederverbinden.
 *
 * - Nach dem Öffnen sendet sie `hello`; erst nach `welcome` gilt sie als `open`.
 * - Beobachtete Tische (`watchTable`) werden nach jedem (Wieder-)Verbinden erneut per `table.join`
 *   angefordert – der Server antwortet mit dem vollständigen, gefilterten Zustand.
 * - Abbruch-Erkennung: Browser sehen die Pings des Servers nicht. Kommt `idleMs` lang nichts an,
 *   schickt der Client `ping` (Antwort `pong`); bleibt jede Nachricht `timeoutMs` lang aus, wird neu
 *   verbunden. Dazu: `offline`/`online` und Rückkehr in den Vordergrund (`visibilitychange`).
 * - Backoff: 0,5 s, 1 s, 2 s … bis 10 s (± 20 %); nach `welcome` beginnt er wieder von vorn.
 * - Close 4000 (Version) und 4001 (anderer Tab übernimmt): kein automatisches Wiederverbinden.
 */
export class GameConnection {
  private socket: SocketLike | null = null;
  private welcomed = false;
  private statusValue: ConnectionStatus = { kind: 'closed' };
  private userValue: PublicUser | null = null;
  private running = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly tables = new Set<number>();
  private readonly messageListeners = new Set<Listener<ServerMessage>>();
  private readonly statusListeners = new Set<Listener<ConnectionStatus>>();
  private readonly backoff: BackoffOptions;
  private readonly heartbeat: HeartbeatOptions | null;
  private readonly url: () => string;
  private readonly createSocket: SocketFactory;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly events: BrowserEvents | null;
  private readonly checkSession: () => Promise<boolean>;
  private readonly sessionCheckAfter: number;
  /** Abbrüche/Fehlversuche in Folge seit dem letzten `welcome` (Grundlage für den Backoff). */
  private failures = 0;

  constructor(options: GameConnectionOptions = {}) {
    this.url = options.url ?? (() => wsUrl('/ws'));
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.heartbeat = options.heartbeat === false ? null : { ...DEFAULT_HEARTBEAT, ...options.heartbeat };
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.events = options.events === undefined ? defaultEvents() : options.events;
    this.checkSession = options.checkSession ?? defaultCheckSession;
    this.sessionCheckAfter = options.sessionCheckAfter ?? DEFAULT_SESSION_CHECK_AFTER;
  }

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  /** Eingeloggter User laut `welcome` (bleibt nach einem Abbruch erhalten). */
  get user(): PublicUser | null {
    return this.userValue;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.events?.window?.addEventListener('online', this.onOnline);
    this.events?.window?.addEventListener('offline', this.onOffline);
    this.events?.document?.addEventListener('visibilitychange', this.onVisibility);
    this.connect();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.events?.window?.removeEventListener('online', this.onOnline);
    this.events?.window?.removeEventListener('offline', this.onOffline);
    this.events?.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.clearTimers();
    this.dropSocket(1000, 'client stop');
    this.setStatus({ kind: 'closed' });
  }

  /**
   * Sofort neu verbinden (Knopf „Jetzt verbinden“ bzw. „Hier weiterspielen“ nach 4001); setzt den
   * Backoff zurück.
   */
  reconnectNow(): void {
    if (!this.running || this.statusValue.kind === 'open' || this.statusValue.kind === 'failed') return;
    if (this.statusValue.kind === 'connecting' && this.socket !== null) return;
    this.failures = 0;
    this.connect();
  }

  /** Sendet, wenn die Verbindung offen ist. `false` = nicht gesendet (nicht verbunden). */
  send(message: ClientMessage): boolean {
    if (this.statusValue.kind !== 'open' || this.socket === null || this.socket.readyState !== SOCKET_OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Tisch beobachten – auch über Abbrüche hinweg (nach dem Wiederverbinden erneut `table.join`). */
  watchTable(tableId: number): void {
    if (this.tables.has(tableId)) return;
    this.tables.add(tableId);
    this.send({ type: 'table.join', tableId });
  }

  /** Nicht mehr automatisch beitreten; `leave` schickt zusätzlich `table.leave`. */
  unwatchTable(tableId: number, leave = false): void {
    this.tables.delete(tableId);
    if (leave) this.send({ type: 'table.leave', tableId });
  }

  onMessage(listener: Listener<ServerMessage>): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onStatus(listener: Listener<ConnectionStatus>): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------

  private connect(): void {
    this.clearTimers();
    this.dropSocket(1000, 'reconnect');
    this.welcomed = false;
    this.setStatus({ kind: 'connecting', attempt: this.failures + 1 });
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.url());
    } catch {
      this.failures += 1;
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION } satisfies ClientMessage));
      this.armIdle();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleText(event.data);
    };
    socket.onerror = () => {
      // Details liefert der Browser nicht; `onclose` folgt.
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.handleClose(event.code);
    };
  }

  private handleText(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') return;
    this.armIdle();
    if (message.type === 'welcome') {
      this.userValue = { ...message.user };
      if (!this.welcomed) {
        this.welcomed = true;
        this.failures = 0;
        this.setStatus({ kind: 'open' });
        // Zustand neu anfordern: Beitritt liefert sofort die gefilterte Sicht (inkl. eigener Karten).
        for (const tableId of this.tables) this.send({ type: 'table.join', tableId });
      }
    }
    if (message.type === 'error' && message.code === 'UNSUPPORTED_VERSION') {
      this.fail('version', message.message);
    }
    for (const listener of [...this.messageListeners]) listener(message);
  }

  private handleClose(code: number): void {
    this.socket = null;
    this.clearHeartbeat();
    if (!this.running) return;
    if (code === CLOSE_UNSUPPORTED_VERSION) {
      this.fail('version', 'Die App ist veraltet – bitte die Seite neu laden.');
      return;
    }
    if (code === CLOSE_REPLACED) {
      this.clearTimers();
      this.failures = 0;
      this.setStatus({ kind: 'replaced' });
      return;
    }
    this.failures += 1;
    if (this.failures >= this.sessionCheckAfter && this.failures % this.sessionCheckAfter === 0) {
      void this.checkSession().then((valid) => {
        if (!valid && this.running && this.statusValue.kind !== 'open') {
          this.fail('unauthorized', 'Deine Sitzung ist abgelaufen – bitte neu anmelden.');
        }
      });
    }
    this.scheduleRetry();
  }

  private fail(reason: 'version' | 'unauthorized', message: string): void {
    this.clearTimers();
    this.dropSocket(1000, 'failed');
    this.setStatus({ kind: 'failed', reason, message });
  }

  private scheduleRetry(): void {
    if (!this.running || this.statusValue.kind === 'failed' || this.statusValue.kind === 'replaced') return;
    const base = backoffDelay(Math.max(1, this.failures), this.backoff);
    const spread = 1 + this.backoff.jitter * (this.random() * 2 - 1);
    const delay = Math.max(0, Math.round(base * spread));
    this.setStatus({ kind: 'waiting', attempt: this.failures, retryAt: this.now() + delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** Socket loslassen, ohne auf sein `close` zu warten (eine tote Verbindung meldet sich evtl. nie). */
  private dropSocket(code: number, reason: string): void {
    const socket = this.socket;
    if (socket === null) return;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(code, reason);
    } catch {
      // bereits geschlossen
    }
  }

  /** Verbindung als verloren behandeln (Heartbeat, offline) und den Backoff starten. */
  private lose(): void {
    if (!this.running || this.socket === null) return;
    this.dropSocket(1000, 'heartbeat timeout');
    this.clearHeartbeat();
    this.failures += 1;
    this.scheduleRetry();
  }

  private armIdle(): void {
    if (this.heartbeat === null) return;
    const { idleMs } = this.heartbeat;
    this.clearHeartbeat();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.probe();
    }, idleMs);
  }

  /** `ping` als Probe (auch vor `welcome` erlaubt); jede eingehende Nachricht gilt als Lebenszeichen. */
  private probe(): void {
    if (this.heartbeat === null || this.socket === null || this.probeTimer !== null) return;
    if (this.socket.readyState !== SOCKET_OPEN) return;
    try {
      this.socket.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
    } catch {
      this.lose();
      return;
    }
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      this.lose();
    }, this.heartbeat.timeoutMs);
  }

  private clearHeartbeat(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.probeTimer !== null) clearTimeout(this.probeTimer);
    this.idleTimer = null;
    this.probeTimer = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    this.statusValue = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }

  private readonly onOnline = (): void => {
    if (this.statusValue.kind !== 'replaced') this.reconnectNow();
  };

  private readonly onOffline = (): void => {
    this.lose();
  };

  private readonly onVisibility = (): void => {
    if (this.events?.document?.visibilityState !== 'visible') return;
    if (this.statusValue.kind === 'open') this.probe();
    else if (this.statusValue.kind !== 'replaced') this.reconnectNow();
  };
}
