// Zustand eines Tisches im Client (WP-018): letzter `table.state`, Rundenergebnis, Fehler und
// Verbindungsstatus – als kleiner Store ohne React (Hook: `useTableGame`). Der Server ist autoritativ
// (D-003): der Store hält nur, was der Server schickt, und sendet Wünsche; er rechnet nichts selbst aus.
import type { Action } from '@poker/engine';
import type {
  ErrorCode,
  PublicUser,
  ReactionId,
  ServerMessage,
  StandingView,
  TableClosedMessage,
  TableView as ServerTableView,
} from '@poker/engine/protocol';
import { preActionValid, resolvePreAction, type PreAction, type PreActionKind } from '../table/actions/logic';
import { heroHandContext } from './adapter';
import {
  clearPending,
  EMPTY_REVEAL,
  receiveRevealedCards,
  syncReveal,
  toggleReveal,
  type AdminRevealState,
} from './adminReveal';
import type { ConnectionStatus, GameConnection } from './connection';

export interface GameError {
  /** Laufende Nummer, damit die UI denselben Text erneut anzeigen kann. */
  readonly id: number;
  readonly code: ErrorCode | 'NOT_CONNECTED';
  readonly message: string;
}

export interface TableGameSnapshot {
  readonly connection: ConnectionStatus;
  readonly user: PublicUser | null;
  /** Letzte gefilterte Sicht des Servers; `null` = noch keine (Laden) bzw. Tisch unbekannt. */
  readonly table: ServerTableView | null;
  /** Lokale Empfangszeit von `table` (Uhrabgleich über `serverNowMs`, siehe `readTurnClock`). */
  readonly receivedAtMs: number;
  /** Ergebnis der Runde – aus `table.roundFinished` oder (nach Wiederverbinden) aus dem Zustand. */
  readonly standings: readonly StandingView[] | null;
  readonly error: GameError | null;
  /** Server kennt den Tisch nicht (mehr) bzw. er ist privat. */
  readonly notFound: boolean;
  /** Server hat den Tisch geschlossen (`table.closed`: verwaiste Runde abgebrochen, D-022, oder Admin, WP-028). */
  readonly closed: TableClosedMessage['reason'] | null;
  /** Eine Aktion für diesen Stand (`handNumber/actionSeq`) ist unterwegs. */
  readonly pendingAction: boolean;
  /** Gewählte Vorab-Aktion (gilt für Hand und Straße der Wahl, verfällt bei Änderungen). */
  readonly preAction: PreAction | null;
  /** Admin-Flag der Session laut `welcome` (WP-033). */
  readonly isAdmin: boolean;
  /** Vom Admin aufgedeckte Karten der laufenden Hand (WP-033, D-027); nur im Client dieses Admins. */
  readonly reveal: AdminRevealState;
  /** Gerade eingeblendete Emoji-Reaktionen, höchstens eine je Sitz (WP-032). */
  readonly reactions: readonly ReactionBubble[];
}

/** Emoji-Reaktion über einem Sitz (WP-032), solange sie eingeblendet ist. */
export interface ReactionBubble {
  /** Laufende Nummer (React-Key: dieselbe Reaktion erneut startet die Animation neu). */
  readonly id: number;
  readonly seat: number;
  readonly userId: number;
  readonly reaction: ReactionId;
}

/** So lange bleibt eine Reaktion über dem Platz stehen. */
export const REACTION_DISPLAY_MS = 3000;

/** `requestId`-Präfix von `admin.revealCards`, damit Fehler darauf nicht die Aktionsleiste freigeben. */
const REVEAL_REQUEST = 'reveal:';

type Listener = () => void;

/** Ergebnis aus dem Rundenzustand ableiten (z. B. nach einem Reconnect, `table.roundFinished` verpasst). */
export function standingsFromView(table: ServerTableView): StandingView[] | null {
  const standings = table.round?.standings;
  if (standings === null || standings === undefined) return null;
  const users = new Map(table.seats.map((s) => [String(s.user.id), s.user]));
  return standings.map((s) => ({ ...s, user: users.get(s.playerId) ?? { id: Number(s.playerId), username: '?' } }));
}

function actionKey(table: ServerTableView | null): string | null {
  const hand = table?.round?.hand;
  if (hand === null || hand === undefined) return null;
  return `${String(hand.handNumber)}/${String(hand.actionSeq)}`;
}

/**
 * Store für einen Tisch über einer (geteilten) `GameConnection`. `start()` beobachtet den Tisch
 * (auch über Reconnects), `stop()` gibt ihn frei.
 */
export class TableGameStore {
  private snapshot: TableGameSnapshot;
  private readonly listeners = new Set<Listener>();
  private unsubscribe: (() => void)[] = [];
  private pendingKey: string | null = null;
  private errorId = 0;
  private reactionId = 0;
  private readonly reactionTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    readonly connection: GameConnection,
    readonly tableId: number,
    private readonly now: () => number = Date.now,
  ) {
    this.snapshot = {
      connection: connection.status,
      user: connection.user,
      table: null,
      receivedAtMs: 0,
      standings: null,
      error: null,
      notFound: false,
      closed: null,
      pendingAction: false,
      preAction: null,
      reactions: [],
      isAdmin: connection.isAdmin,
      reveal: EMPTY_REVEAL,
    };
  }

  getSnapshot = (): TableGameSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start(): void {
    this.unsubscribe = [
      this.connection.onMessage((m) => {
        this.handle(m);
      }),
      this.connection.onStatus((status) => {
        // Nach einem Abbruch kann eine unterwegs verlorene Aktion nicht mehr bestätigt werden.
        if (status.kind !== 'open') this.pendingKey = null;
        this.update({
          connection: status,
          user: this.connection.user,
          isAdmin: this.connection.isAdmin,
          pendingAction: this.pendingKey !== null,
        });
      }),
    ];
    this.connection.watchTable(this.tableId);
    this.connection.start();
    this.update({ connection: this.connection.status });
  }

  stop(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    for (const timer of this.reactionTimers) clearTimeout(timer);
    this.reactionTimers.clear();
    this.connection.unwatchTable(this.tableId);
  }

  // --- Wünsche an den Server ------------------------------------------------

  /** Aktion für den aktuellen Stand der Hand (`handNumber`/`seq` aus der letzten Sicht). */
  act(action: Action): boolean {
    const hand = this.snapshot.table?.round?.hand;
    const key = actionKey(this.snapshot.table);
    if (hand === null || hand === undefined || key === null) return false;
    if (this.pendingKey === key) return false; // Doppelklick
    const sent = this.send({
      type: 'table.action',
      tableId: this.tableId,
      handNumber: hand.handNumber,
      seq: hand.actionSeq,
      action,
    });
    if (sent) {
      this.pendingKey = key;
      this.update({ pendingAction: true });
    }
    return sent;
  }

  sit(seat: number): boolean {
    return this.send({ type: 'table.sit', tableId: this.tableId, seat });
  }

  stand(): boolean {
    return this.send({ type: 'table.stand', tableId: this.tableId });
  }

  startRound(): boolean {
    return this.send({ type: 'table.start', tableId: this.tableId });
  }

  /** „Nochmal“ (D-020): nur Ersteller, nur nach Rundenende; Erfolg = neuer `table.state` mit `running`. */
  rematch(): boolean {
    return this.send({ type: 'table.rematch', tableId: this.tableId });
  }

  /** Emoji-Reaktion senden (WP-032); der Server begrenzt auf eine pro `REACTION_COOLDOWN_MS`. */
  react(reaction: ReactionId): boolean {
    return this.send({ type: 'table.react', tableId: this.tableId, reaction });
  }

  /** Tisch verlassen: nicht mehr beobachten (vor dem Start steht man dabei auch auf). */
  leave(): void {
    this.connection.unwatchTable(this.tableId, true);
  }

  /**
   * Vorab-Aktion wählen (`null` = abwählen). Nur möglich, solange man in der laufenden Hand noch
   * handeln kann und nicht am Zug ist.
   */
  selectPreAction(choice: { kind: PreActionKind; amount: number } | null): void {
    const ctx = this.snapshot.table === null ? null : heroHandContext(this.snapshot.table);
    if (choice === null || ctx === null || !ctx.canAct || ctx.legal !== null) {
      this.update({ preAction: null });
      return;
    }
    this.update({ preAction: { ...choice, handNumber: ctx.handNumber, street: ctx.street } });
  }

  /**
   * Admin tippt auf verdeckte Karten eines Mitspielers (WP-033): umdrehen bzw. zurückdrehen. Nur das erste Umdrehen
   * eines Platzes pro Hand fragt beim Server an (und wird dort protokolliert); Zurückdrehen bleibt im Client.
   */
  toggleReveal(seat: number): void {
    if (!this.snapshot.isAdmin) return;
    const { state, request } = toggleReveal(this.snapshot.reveal, seat);
    if (request) {
      const sent = this.send({
        type: 'admin.revealCards',
        tableId: this.tableId,
        seat,
        requestId: `${REVEAL_REQUEST}${String(seat)}`,
      });
      if (!sent) return;
    }
    this.update({ reveal: state });
  }

  reconnectNow(): void {
    this.connection.reconnectNow();
  }

  dismissError(): void {
    this.update({ error: null });
  }

  dismissStandings(): void {
    this.update({ standings: null });
  }

  /** Ergebnis erneut zeigen (aus dem Rundenzustand). */
  showStandings(): void {
    const table = this.snapshot.table;
    if (table !== null) this.update({ standings: standingsFromView(table) });
  }

  // -------------------------------------------------------------------------

  private send(message: Parameters<GameConnection['send']>[0]): boolean {
    const sent = this.connection.send(message);
    if (!sent) this.setError('NOT_CONNECTED', 'Keine Verbindung zum Server – bitte kurz warten.');
    return sent;
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'table.state': {
        if (message.table.id !== this.tableId) return;
        const previous = this.snapshot.table;
        const key = actionKey(message.table);
        if (this.pendingKey !== null && key !== this.pendingKey) this.pendingKey = null;
        const standings =
          this.snapshot.standings ??
          (previous === null || previous.status !== 'finished' ? standingsFromView(message.table) : null);
        this.update({
          table: message.table,
          receivedAtMs: this.now(),
          notFound: false,
          pendingAction: this.pendingKey !== null,
          standings: message.table.status === 'finished' ? standings : null,
          reveal: syncReveal(this.snapshot.reveal, message.table),
        });
        this.applyPreAction();
        return;
      }
      case 'table.roundFinished':
        if (message.tableId !== this.tableId) return;
        this.update({ standings: message.standings });
        return;
      case 'error': {
        if (message.tableId !== null && message.tableId !== this.tableId) return;
        if (message.code === 'TABLE_NOT_FOUND') {
          // Auch nach einem Server-Neustart (Tisch geschlossen): alten Stand nicht weiter zeigen.
          this.pendingKey = null;
          this.update({ notFound: true, table: null, pendingAction: false, preAction: null, reveal: EMPTY_REVEAL });
          return;
        }
        if (message.requestId?.startsWith(REVEAL_REQUEST) === true) {
          // Aufdecken abgelehnt: nur die offene Anfrage verwerfen, eine laufende Aktion bleibt unberührt.
          this.setError(message.code, message.message);
          this.update({ reveal: clearPending(this.snapshot.reveal) });
          return;
        }
        // Abgelehnte Aktion: wieder bedienbar machen.
        this.pendingKey = null;
        this.setError(message.code, message.message);
        this.update({ pendingAction: false });
        return;
      }
      case 'table.left':
        if (message.tableId === this.tableId) this.update({ table: null, reveal: EMPTY_REVEAL });
        return;
      case 'admin.cards':
        if (message.tableId !== this.tableId) return;
        this.update({ reveal: receiveRevealedCards(this.snapshot.reveal, message) });
        return;
      case 'table.closed':
        if (message.tableId !== this.tableId) return;
        this.pendingKey = null;
        this.connection.unwatchTable(this.tableId);
        this.update({
          closed: message.reason,
          table: null,
          pendingAction: false,
          preAction: null,
          standings: null,
          reveal: EMPTY_REVEAL,
        });
        return;
      case 'table.reaction':
        if (message.tableId === this.tableId) this.showReaction(message);
        return;
      // Für den Tisch ohne Bedeutung (Lobby, Handshake, Heartbeat). Bewusst ohne `default`, damit neue
      // Server-Nachrichten hier auffallen.
      case 'welcome':
      case 'pong':
      case 'lobby.snapshot':
      case 'lobby.update':
      case 'lobby.remove':
      case 'table.created':
        return;
      default:
        message satisfies never;
    }
  }

  /** Reaktion einblenden (ersetzt eine noch sichtbare am selben Sitz) und nach `REACTION_DISPLAY_MS` entfernen. */
  private showReaction({ seat, userId, reaction }: { seat: number; userId: number; reaction: ReactionId }): void {
    this.reactionId += 1;
    const bubble: ReactionBubble = { id: this.reactionId, seat, userId, reaction };
    this.update({ reactions: [...this.snapshot.reactions.filter((r) => r.seat !== seat), bubble] });
    const timer = setTimeout(() => {
      this.reactionTimers.delete(timer);
      this.update({ reactions: this.snapshot.reactions.filter((r) => r.id !== bubble.id) });
    }, REACTION_DISPLAY_MS);
    this.reactionTimers.add(timer);
  }

  /** Nach jedem Zustand: verfallene Vorab-Aktion verwerfen bzw. am Zug genau einmal auslösen. */
  private applyPreAction(): void {
    const pre = this.snapshot.preAction;
    const table = this.snapshot.table;
    if (pre === null) return;
    const ctx = table === null ? null : heroHandContext(table);
    if (ctx === null || !ctx.canAct || !preActionValid(pre, ctx)) {
      this.update({ preAction: null });
      return;
    }
    if (ctx.legal === null) return;
    this.update({ preAction: null });
    const action = resolvePreAction(pre, ctx.legal);
    if (action !== null) this.act(action);
  }

  private setError(code: GameError['code'], message: string): void {
    this.errorId += 1;
    this.update({ error: { id: this.errorId, code, message } });
  }

  private update(patch: Partial<TableGameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
