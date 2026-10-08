// Game-Server (WP-011): verwaltet Verbindungen, Lobby und Tische im Speicher eines Prozesses und setzt
// Client-Nachrichten in Tisch-Operationen um. Unabhängig vom Transport (WebSocket in `ws.ts`), damit das
// Tischmodell ohne Netzwerk und ohne DB testbar ist. Protokoll: `@poker/engine/protocol`.
import { randomBytes } from 'node:crypto';
import type { Rng } from '@poker/engine';
import { cryptoRng } from '@poker/engine/crypto-rng';
import {
  CLOSE_REPLACED,
  CLOSE_UNSUPPORTED_VERSION,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type PublicUser,
  type ServerMessage,
  type TableSettings,
  type TableSettingsInput,
} from '@poker/engine/protocol';
import { systemClock, type Cancel, type Clock } from './clock';
import type { GameHooks } from './hooks';
import type { TableRepository } from './repository';
import { Table, type Logger, type TableResult } from './table';

/** Pause nach jeder Hand (Showdown-Anzeige), bevor die nächste startet. */
export const DEFAULT_HAND_PAUSE_MS = 4000;

/**
 * Gnadenfrist für getrennte Spieler am Zug (WP-012): Ein Reload oder kurzer Netzwechsel kostet so keine Hand,
 * der Tisch wartet aber höchstens so lange (nie länger als Zugzeit + Zeitbank).
 */
export const DEFAULT_DISCONNECT_GRACE_MS = 3000;

/** Verwaiste Runde (D-022): 10 Minuten ohne verbundenen Spieler → Abbruch ohne Punkte. */
export const DEFAULT_ORPHAN_TIMEOUT_MS = 10 * 60_000;

/**
 * Offene oder beendete Tische ohne Beobachter bleiben so lange im Speicher (WP-015), damit ein Reload, der
 * Wechsel Lobby → Tisch (neue WebSocket-Verbindung) oder das Teilen des Einladungslinks den Tisch nicht schließt.
 * Ein explizites `table.leave` des letzten Beobachters räumt einen leeren offenen bzw. beendeten Tisch sofort auf.
 */
export const DEFAULT_IDLE_TABLE_TIMEOUT_MS = 10 * 60_000;

// Schließcodes leben im Protokoll (der Client braucht sie); hier für bestehende Importe re-exportiert.
export { CLOSE_REPLACED, CLOSE_UNSUPPORTED_VERSION };

/** Transport einer Verbindung (WebSocket oder Test-Double). */
export interface Connection {
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

export interface GameServerOptions {
  repository: TableRepository;
  log: Logger;
  /** Standard: echte Uhr. */
  clock?: Clock;
  /** Standard: `cryptoRng` (D-003); Tests können ein Seed-Rng übergeben. */
  rng?: Rng;
  /** Standard: {@link DEFAULT_HAND_PAUSE_MS}. */
  handPauseMs?: number;
  /** Standard: {@link DEFAULT_DISCONNECT_GRACE_MS}. */
  disconnectGraceMs?: number;
  /** Standard: {@link DEFAULT_ORPHAN_TIMEOUT_MS}. */
  orphanTimeoutMs?: number;
  /** Standard: {@link DEFAULT_IDLE_TABLE_TIMEOUT_MS}. */
  idleTableTimeoutMs?: number;
  /** Erweiterungspunkte für WP-013 (Hand-Historie). */
  hooks?: GameHooks;
  /** Standard: 12 Zeichen base64url aus 9 Zufallsbytes. */
  generateInviteCode?: () => string;
}

/** Ergebnis von {@link GameServer.closeTableByAdmin}. */
export interface AdminClosedTable {
  tableId: number;
  /** Status vor dem Schließen. */
  status: 'open' | 'running' | 'finished';
  roundId: number | null;
  /** Belegte Plätze vor dem Schließen. */
  seated: number;
  /** Eine laufende Runde wurde ohne Punkte abgebrochen. */
  roundAborted: boolean;
}

export interface GameClient {
  readonly id: number;
  readonly user: PublicUser;
}

interface Client extends GameClient {
  conn: Connection;
  hello: boolean;
  lobby: boolean;
  tables: Set<number>;
  /** Von einer neueren Verbindung desselben Users abgelöst (WP-012) – Nachrichten werden ignoriert. */
  replaced: boolean;
}

const OK: TableResult = { ok: true };
const err = (code: ErrorCode, message: string): TableResult => ({ ok: false, code, message });

export class GameServer {
  private readonly tables = new Map<number, Table>();
  private readonly byInviteCode = new Map<string, Table>();
  /** Verbindungen, die einen Tisch beobachten. */
  private readonly tableClients = new Map<number, Set<Client>>();
  private readonly lobbyClients = new Set<Client>();
  /** Aktive Verbindung (nach `hello`) je User – höchstens eine (WP-012: die neuere übernimmt). */
  private readonly activeByUser = new Map<number, Client>();
  /** Zuletzt an die Lobby gesendeter Eintrag je Tisch (JSON), um nur Änderungen zu schicken. */
  private readonly lobbyCache = new Map<number, string>();
  /** Geplantes Aufräumen von Tischen ohne Beobachter (WP-015). */
  private readonly pendingDispose = new Map<number, Cancel>();
  /** Ausstehende Schreibvorgänge entfernter Tische (z. B. `abortRound`), damit `idle()` auch auf sie wartet. */
  private readonly retiring = new Set<Promise<void>>();
  private nextClientId = 1;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly handPauseMs: number;
  private readonly disconnectGraceMs: number;
  private readonly orphanTimeoutMs: number;
  private readonly idleTableTimeoutMs: number;
  private readonly hooks: GameHooks;
  private readonly generateInviteCode: () => string;

  constructor(private readonly options: GameServerOptions) {
    this.clock = options.clock ?? systemClock;
    this.rng = options.rng ?? cryptoRng;
    this.handPauseMs = options.handPauseMs ?? DEFAULT_HAND_PAUSE_MS;
    this.disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
    this.orphanTimeoutMs = options.orphanTimeoutMs ?? DEFAULT_ORPHAN_TIMEOUT_MS;
    this.idleTableTimeoutMs = options.idleTableTimeoutMs ?? DEFAULT_IDLE_TABLE_TIMEOUT_MS;
    this.hooks = options.hooks ?? {};
    this.generateInviteCode = options.generateInviteCode ?? (() => randomBytes(9).toString('base64url'));
  }

  // -------------------------------------------------------------------------
  // Verbindungen
  // -------------------------------------------------------------------------

  connect(user: PublicUser, conn: Connection): GameClient {
    const client: Client = {
      id: this.nextClientId++,
      user: { id: user.id, username: user.username },
      conn,
      hello: false,
      lobby: false,
      tables: new Set(),
      replaced: false,
    };
    return client;
  }

  /** Verbindung ist weg (oder abgelöst): Lobby/Tische abmelden. Mehrfacher Aufruf ist harmlos. */
  disconnect(gameClient: GameClient): void {
    const client = gameClient as Client;
    if (this.activeByUser.get(client.user.id) === client) this.activeByUser.delete(client.user.id);
    this.lobbyClients.delete(client);
    for (const tableId of [...client.tables]) {
      this.unwatch(client, tableId, false);
    }
  }

  /** Verarbeitet eine eingehende Textnachricht. Fehler gehen nur an den Absender; Tische laufen weiter. */
  async handle(gameClient: GameClient, text: string): Promise<void> {
    const client = gameClient as Client;
    if (client.replaced) return;
    const parsed = parseClientMessage(text);
    if (!parsed.ok) {
      this.sendError(client, parsed.code, parsed.message, parsed.requestId, null);
      return;
    }
    const msg = parsed.message;
    const requestId = msg.requestId ?? null;
    const tableId = 'tableId' in msg && typeof msg.tableId === 'number' ? msg.tableId : null;
    try {
      const result = await this.dispatch(client, msg);
      if (!result.ok) this.sendError(client, result.code, result.message, requestId, tableId);
    } catch (error) {
      this.options.log.error({ err: error, type: msg.type, tableId }, 'Fehler bei der Verarbeitung einer Nachricht');
      this.sendError(client, 'INTERNAL', 'Interner Fehler – bitte erneut versuchen', requestId, tableId);
    }
  }

  /** Tisch im Speicher (für WP-012/WP-013 und Tests). */
  getTable(tableId: number): Table | undefined {
    return this.tables.get(tableId);
  }

  /**
   * Admin schließt einen Tisch (WP-028): laufende Runde ohne Punkte abbrechen (wie D-019), Tisch in der DB schließen,
   * alle Beobachter mit `table.closed` (`reason: 'admin'`) informieren und den Tisch aus Speicher und Lobby nehmen.
   * `null`, wenn der Tisch nicht (mehr) im Speicher ist. Liefert den Zustand vor dem Schließen (fürs Protokoll).
   */
  closeTableByAdmin(tableId: number): AdminClosedTable | null {
    const table = this.tables.get(tableId);
    if (table === undefined) return null;
    const closed: AdminClosedTable = {
      tableId,
      status: table.status,
      roundId: table.roundId,
      seated: table.seats.size,
      roundAborted: table.status === 'running',
    };
    table.terminate();
    this.broadcast(tableId, { type: 'table.closed', tableId, reason: 'admin' });
    for (const c of this.tableClients.get(tableId) ?? []) c.tables.delete(tableId);
    this.remove(table);
    return closed;
  }

  /** Tische im Speicher (z. B. für Admin-Übersichten). */
  tableIds(): number[] {
    return [...this.tables.keys()];
  }

  /** Wartet auf alle eingereihten Hooks/DB-Schreibvorgänge aller Tische. */
  async idle(): Promise<void> {
    await Promise.all([...[...this.tables.values()].map((t) => t.idle()), ...this.retiring]);
  }

  /** Beim Herunterfahren: Timer aller Tische beenden. */
  close(): void {
    for (const table of this.tables.values()) table.close();
    for (const cancel of this.pendingDispose.values()) cancel();
    this.pendingDispose.clear();
  }

  // -------------------------------------------------------------------------
  // Nachrichten
  // -------------------------------------------------------------------------

  private async dispatch(client: Client, msg: ClientMessage): Promise<TableResult> {
    if (msg.type === 'hello') {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        this.sendError(
          client,
          'UNSUPPORTED_VERSION',
          `Protokollversion ${String(msg.protocolVersion)} wird nicht unterstützt (Server: ${String(PROTOCOL_VERSION)}) – bitte die Seite neu laden`,
          msg.requestId ?? null,
          null,
        );
        client.conn.close(CLOSE_UNSUPPORTED_VERSION, 'unsupported protocol version');
        return OK;
      }
      client.hello = true;
      this.takeOver(client);
      this.send(client, { type: 'welcome', protocolVersion: PROTOCOL_VERSION, user: { ...client.user } });
      return OK;
    }
    if (msg.type === 'ping') {
      this.send(client, { type: 'pong', requestId: msg.requestId ?? null, serverNowMs: this.clock.now() });
      return OK;
    }
    if (!client.hello) return err('HELLO_REQUIRED', 'Zuerst hello mit der Protokollversion senden');

    switch (msg.type) {
      case 'lobby.subscribe':
        this.lobbyClients.add(client);
        this.send(client, {
          type: 'lobby.snapshot',
          tables: [...this.tables.values()].flatMap((t) => t.lobbyEntry() ?? []).sort((a, b) => a.id - b.id),
        });
        return OK;
      case 'lobby.unsubscribe':
        this.lobbyClients.delete(client);
        return OK;
      case 'table.create':
        return this.createTable(client, msg.settings, msg.requestId ?? null);
      case 'table.join':
        return this.join(client, msg.tableId === undefined ? { inviteCode: msg.inviteCode } : { tableId: msg.tableId });
      case 'table.leave': {
        if (!client.tables.has(msg.tableId)) return err('NOT_AT_TABLE', 'Du beobachtest diesen Tisch nicht');
        this.unwatch(client, msg.tableId, true);
        this.send(client, { type: 'table.left', tableId: msg.tableId });
        return OK;
      }
      case 'table.sit':
        return this.withTable(client, msg.tableId, (t) => t.sit(client.user, msg.seat));
      case 'table.stand':
        return this.withTable(client, msg.tableId, (t) => t.stand(client.user.id));
      case 'table.start':
        return this.withTable(client, msg.tableId, (t) => t.start(client.user.id));
      case 'table.rematch':
        return this.withTable(client, msg.tableId, (t) => t.rematch(client.user.id));
      case 'table.action':
        return this.withTable(client, msg.tableId, (t) => t.act(client.user.id, msg.handNumber, msg.seq, msg.action));
    }
  }

  /**
   * Zwei Verbindungen desselben Users (WP-012): die neuere (zuletzt `hello`) übernimmt. Die ältere wird sofort
   * von Lobby und Tischen abgemeldet und mit {@link CLOSE_REPLACED} geschlossen; Tische, die die neue Verbindung
   * per `table.join` wieder beobachtet, sehen den Spieler danach wieder als verbunden.
   */
  private takeOver(client: Client): void {
    const previous = this.activeByUser.get(client.user.id);
    this.activeByUser.set(client.user.id, client);
    if (previous === undefined || previous === client) return;
    previous.replaced = true;
    this.disconnect(previous);
    try {
      previous.conn.close(CLOSE_REPLACED, 'replaced by newer connection');
    } catch (error) {
      this.options.log.warn({ err: error }, 'Abgelöste Verbindung konnte nicht geschlossen werden');
    }
  }

  private async withTable(
    client: Client,
    tableId: number,
    fn: (table: Table) => TableResult | Promise<TableResult>,
  ): Promise<TableResult> {
    const table = this.tables.get(tableId);
    if (table === undefined || !client.tables.has(tableId)) {
      return err('NOT_AT_TABLE', 'Erst dem Tisch beitreten (table.join)');
    }
    return fn(table);
  }

  private async createTable(client: Client, input: TableSettingsInput, requestId: string | null): Promise<TableResult> {
    // `parseClientMessage` hat die Einstellungen bereits geprüft und mit Defaults ergänzt.
    const full = input as TableSettings;
    const inviteCode = this.generateInviteCode();
    const id = await this.options.repository.createTable({ createdBy: client.user.id, settings: full, inviteCode });
    const table = new Table(id, inviteCode, { ...client.user }, full, {
      clock: this.clock,
      rng: this.rng,
      repository: this.options.repository,
      hooks: this.hooks,
      handPauseMs: this.handPauseMs,
      disconnectGraceMs: this.disconnectGraceMs,
      orphanTimeoutMs: this.orphanTimeoutMs,
      log: this.options.log,
      onChange: (t) => {
        this.broadcastState(t);
      },
      onRoundFinished: (t, standings) => {
        this.broadcast(t.id, { type: 'table.roundFinished', tableId: t.id, standings });
      },
      onAborted: (t) => {
        this.broadcast(t.id, { type: 'table.closed', tableId: t.id, reason: 'abandoned' });
        for (const c of this.tableClients.get(t.id) ?? []) c.tables.delete(t.id);
        this.remove(t);
      },
    });
    this.tables.set(id, table);
    this.byInviteCode.set(inviteCode, table);
    this.send(client, { type: 'table.created', requestId, tableId: id, inviteCode });
    this.watch(client, table);
    return OK;
  }

  private join(client: Client, target: { tableId: number } | { inviteCode: string }): TableResult {
    const table = 'tableId' in target ? this.tables.get(target.tableId) : this.byInviteCode.get(target.inviteCode);
    // Private Tische nur per Code – außer für Ersteller, Spieler am Tisch und wer schon per Code beigetreten
    // ist (Reload, Wechsel Einladungsseite → Tischseite, WP-015); sonst wie „nicht vorhanden“.
    const allowed =
      table !== undefined &&
      ('inviteCode' in target ||
        table.settings.isPublic ||
        table.createdBy.id === client.user.id ||
        table.seatOf(client.user.id) !== null ||
        table.isInvited(client.user.id));
    if (!allowed) return err('TABLE_NOT_FOUND', 'Tisch nicht gefunden');
    if ('inviteCode' in target) table.invite(client.user.id);
    if (client.tables.has(table.id)) {
      this.sendState(client, table);
      return OK;
    }
    this.watch(client, table);
    return OK;
  }

  // -------------------------------------------------------------------------
  // Beobachten, Senden
  // -------------------------------------------------------------------------

  private watch(client: Client, table: Table): void {
    client.tables.add(table.id);
    let set = this.tableClients.get(table.id);
    if (set === undefined) {
      set = new Set();
      this.tableClients.set(table.id, set);
    }
    set.add(client);
    this.pendingDispose.get(table.id)?.();
    this.pendingDispose.delete(table.id);
    table.addWatcher(client.user.id);
    this.broadcastState(table);
  }

  /** `explicit`: Client hat `table.leave` gesendet – dann steht er vor dem Start auch auf. */
  private unwatch(client: Client, tableId: number, explicit: boolean): void {
    client.tables.delete(tableId);
    this.tableClients.get(tableId)?.delete(client);
    const table = this.tables.get(tableId);
    if (table === undefined) return;
    table.removeWatcher(client.user.id);
    if (explicit && table.status === 'open' && table.seatOf(client.user.id) !== null) {
      table.stand(client.user.id); // sendet selbst den neuen Zustand
    } else {
      this.broadcastState(table);
    }
    this.disposeIfAbandoned(table, explicit);
  }

  /**
   * Räumt Tische ohne Beobachter auf (laufende Runden nie – dafür gilt D-022, siehe `Table.checkOrphaned`).
   * Offene und beendete Tische werden nach {@link DEFAULT_IDLE_TABLE_TIMEOUT_MS} geschlossen und aus dem Speicher
   * entfernt; beobachtet sie vorher wieder jemand, bleiben sie. Sofort, wenn der letzte Beobachter den Tisch
   * explizit verlässt (`table.leave`) und niemand mehr sitzt bzw. die Runde beendet ist.
   */
  private disposeIfAbandoned(table: Table, explicit: boolean): void {
    if (table.watcherCount > 0 || table.status === 'running') return;
    if (explicit && (table.status === 'finished' || table.seats.size === 0)) {
      this.dispose(table);
      return;
    }
    if (this.pendingDispose.has(table.id)) return;
    this.pendingDispose.set(
      table.id,
      this.clock.schedule(this.idleTableTimeoutMs, () => {
        this.pendingDispose.delete(table.id);
        if (table.watcherCount === 0 && table.status !== 'running' && this.tables.get(table.id) === table) {
          this.dispose(table);
        }
      }),
    );
  }

  /** Tisch schließen (DB `closed`, auch nach einer beendeten Runde ein No-op) und aus dem Speicher nehmen. */
  private dispose(table: Table): void {
    this.options.repository.closeTable(table.id).catch((error: unknown) => {
      this.options.log.error({ err: error, tableId: table.id }, 'Tisch konnte nicht geschlossen werden');
    });
    table.close();
    this.remove(table);
  }

  private remove(table: Table): void {
    const pending = table.idle().then(() => {
      this.retiring.delete(pending);
    });
    this.retiring.add(pending);
    this.pendingDispose.get(table.id)?.();
    this.pendingDispose.delete(table.id);
    this.tables.delete(table.id);
    this.byInviteCode.delete(table.inviteCode);
    this.tableClients.delete(table.id);
    this.updateLobby(table);
  }

  private broadcastState(table: Table): void {
    for (const client of this.tableClients.get(table.id) ?? []) this.sendState(client, table);
    this.updateLobby(table);
  }

  private sendState(client: Client, table: Table): void {
    try {
      this.send(client, { type: 'table.state', table: table.view(client.user) });
    } catch (error) {
      this.options.log.error({ err: error, tableId: table.id }, 'Tischansicht konnte nicht erstellt werden');
    }
  }

  private broadcast(tableId: number, message: ServerMessage): void {
    for (const client of this.tableClients.get(tableId) ?? []) this.send(client, message);
  }

  private updateLobby(table: Table): void {
    const entry = this.tables.has(table.id) ? table.lobbyEntry() : null;
    const json = entry === null ? null : JSON.stringify(entry);
    const previous = this.lobbyCache.get(table.id);
    if (json === null) {
      if (previous === undefined) return;
      this.lobbyCache.delete(table.id);
      for (const c of this.lobbyClients) this.send(c, { type: 'lobby.remove', tableId: table.id });
      return;
    }
    if (json === previous || entry === null) return;
    this.lobbyCache.set(table.id, json);
    for (const c of this.lobbyClients) this.send(c, { type: 'lobby.update', table: entry });
  }

  private sendError(
    client: Client,
    code: ErrorCode,
    message: string,
    requestId: string | null,
    tableId: number | null,
  ): void {
    this.send(client, { type: 'error', code, message, requestId, tableId });
  }

  private send(client: Client, message: ServerMessage): void {
    try {
      client.conn.send(message);
    } catch (error) {
      this.options.log.warn({ err: error }, 'Nachricht konnte nicht gesendet werden');
    }
  }
}
