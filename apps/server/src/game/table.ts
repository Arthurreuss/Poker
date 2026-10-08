// Ein Tisch im Speicher (WP-011): Sitze, Start, Spielablauf über die Engine-Runde (D-012), gefilterte Sichten.
// Der Server ist autoritativ (D-003): Zufall per injiziertem Rng (Betrieb: cryptoRng), Zeit per Clock.
// Alle Zustandsänderungen sind synchron; nur DB-Zugriffe (Repository) und Hooks laufen asynchron.
import {
  applyRoundAction,
  startNextHand,
  startRound,
  type Action,
  type Rng,
  type RoundConfig,
  type RoundState,
} from '@poker/engine';
import {
  toClientView,
  type ErrorCode,
  type LobbyTable,
  type PublicUser,
  type StandingView,
  type TableSettings,
  type TableStatus,
  type TableView,
  type TurnClockView,
} from '@poker/engine/protocol';
import type { Cancel, Clock } from './clock';
import type { GameHooks } from './hooks';
import type { TableRepository } from './repository';

export type TableResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

const OK: TableResult = { ok: true };
const err = (code: ErrorCode, message: string): TableResult => ({ ok: false, code, message });

/** Fehlercodes der Engine, die unverändert an den Client gehen. */
const PASSED_ENGINE_CODES = new Set<ErrorCode>([
  'NOT_YOUR_TURN',
  'INVALID_ACTION',
  'ILLEGAL_ACTION',
  'AMOUNT_TOO_SMALL',
  'AMOUNT_TOO_LARGE',
]);

export interface Logger {
  error(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface TableDeps {
  clock: Clock;
  rng: Rng;
  repository: TableRepository;
  hooks: GameHooks;
  /** Pause nach jeder Hand, bevor die nächste startet (Showdown-Anzeige); in Tests 0. */
  handPauseMs: number;
  /**
   * Gnadenfrist für getrennte Spieler am Zug (WP-012): so lange nach Zugbeginn bzw. Abbruch wartet der
   * Server höchstens, bevor er für sie checkt/foldet (Reload/Netzwechsel ohne Fold); in Tests frei wählbar.
   */
  disconnectGraceMs: number;
  log: Logger;
  /** Zustand hat sich geändert → Sichten neu senden, Lobby aktualisieren. */
  onChange(table: Table): void;
  /** Runde beendet → Ergebnis an alle. */
  onRoundFinished(table: Table, standings: StandingView[]): void;
}

/** Engine-Spieler-ID eines Users (D-003: die Engine kennt nur Strings). */
export const playerIdOf = (userId: number): string => String(userId);

/** Laufender Zug (WP-012, D-013): wer am Zug ist und wann der Server automatisch handelt. */
interface Turn {
  userId: number;
  seat: number;
  handNumber: number;
  actionSeq: number;
  startedAtMs: number;
  turnEndsAtMs: number;
  /** Zeitbank des Spielers zu Zugbeginn. */
  bankAtStartMs: number;
  deadlineMs: number;
  cancel: Cancel;
}

export class Table {
  status: TableStatus = 'open';
  /** Sitz → Spieler. */
  readonly seats = new Map<number, PublicUser>();
  round: RoundState | null = null;
  roundId: number | null = null;
  /** Offene Verbindungen je User, die diesen Tisch beobachten (Verbindungsstatus pro Spieler, WP-012). */
  private readonly watchers = new Map<number, number>();
  private cancelPending: Cancel | null = null;
  /** Aktueller Zug mit Timer (WP-012). */
  private turn: Turn | null = null;
  /** Verbleibende Zeitbank je User in ms (pro Runde); fehlt = volle Zeitbank aus den Einstellungen. */
  private readonly timeBanks = new Map<number, number>();
  private hookQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    readonly id: number,
    readonly inviteCode: string,
    readonly createdBy: PublicUser,
    readonly settings: TableSettings,
    private readonly deps: TableDeps,
  ) {}

  // -------------------------------------------------------------------------
  // Beobachter und Verbindungsstatus
  // -------------------------------------------------------------------------

  addWatcher(userId: number): void {
    this.watchers.set(userId, (this.watchers.get(userId) ?? 0) + 1);
    if (this.watchers.get(userId) === 1) this.onConnectivityChange(userId);
  }

  removeWatcher(userId: number): void {
    const n = (this.watchers.get(userId) ?? 0) - 1;
    if (n > 0) this.watchers.set(userId, n);
    else if (this.watchers.delete(userId)) this.onConnectivityChange(userId);
  }

  /** Hat der User mindestens eine Verbindung, die diesen Tisch beobachtet? (WP-012: Auto-Check/Fold) */
  isConnected(userId: number): boolean {
    return this.watchers.has(userId);
  }

  get watcherCount(): number {
    return this.watchers.size;
  }

  seatOf(userId: number): number | null {
    for (const [seat, user] of this.seats) if (user.id === userId) return seat;
    return null;
  }

  // -------------------------------------------------------------------------
  // Vor dem Start: Sitze
  // -------------------------------------------------------------------------

  sit(user: PublicUser, seat: number): TableResult {
    if (this.status !== 'open') return err('ROUND_STARTED', 'Die Runde läuft bereits – nur Zuschauen möglich');
    if (this.seatOf(user.id) !== null) return err('ALREADY_SEATED', 'Du sitzt schon an diesem Tisch');
    if (seat >= this.settings.maxSeats) {
      return err('INVALID_SEAT', `Sitz muss zwischen 0 und ${String(this.settings.maxSeats - 1)} liegen`);
    }
    if (this.seats.size >= this.settings.maxSeats) return err('TABLE_FULL', 'Der Tisch ist voll');
    if (this.seats.has(seat)) return err('SEAT_TAKEN', 'Dieser Platz ist schon besetzt');
    this.seats.set(seat, { id: user.id, username: user.username });
    this.deps.onChange(this);
    return OK;
  }

  stand(userId: number): TableResult {
    if (this.status !== 'open') return err('ROUND_STARTED', 'Während der Runde kann niemand aufstehen');
    const seat = this.seatOf(userId);
    if (seat === null) return err('NOT_SEATED', 'Du sitzt nicht an diesem Tisch');
    this.seats.delete(seat);
    this.deps.onChange(this);
    return OK;
  }

  // -------------------------------------------------------------------------
  // Start und Spielablauf
  // -------------------------------------------------------------------------

  /** Startet die Runde (nur Ersteller, ≥ 2 Spieler). Danach kein Einstieg mehr (D-012). */
  async start(userId: number): Promise<TableResult> {
    if (this.status !== 'open') return err('ROUND_STARTED', 'Die Runde wurde schon gestartet');
    if (userId !== this.createdBy.id) return err('NOT_CREATOR', 'Nur der Ersteller kann die Runde starten');
    if (this.seats.size < 2) return err('NOT_ENOUGH_PLAYERS', 'Mindestens 2 Spieler müssen sitzen');

    // Sofort sperren: ab hier kein Hinsetzen/Aufstehen mehr, auch während die DB schreibt.
    this.status = 'running';
    const seated = [...this.seats].sort(([a], [b]) => a - b);
    try {
      this.roundId = await this.deps.repository.startRound(
        this.id,
        seated.map(([seat, user]) => ({ userId: user.id, seat })),
      );
    } catch (error) {
      this.status = 'open';
      this.deps.log.error({ err: error, tableId: this.id }, 'Runde konnte nicht gespeichert werden');
      return err('INTERNAL', 'Die Runde konnte nicht gestartet werden');
    }
    if (this.closed) return err('TABLE_NOT_FOUND', 'Der Tisch wurde geschlossen');

    const config: RoundConfig = {
      startingStack: this.settings.startingStack,
      blindStructure: this.settings.blindStructure,
      turnTimeSeconds: this.settings.turnTimeSeconds,
      timeBankSeconds: this.settings.timeBankSeconds,
    };
    const started = startRound(
      config,
      seated.map(([seat, user]) => ({ id: playerIdOf(user.id), seat })),
      this.deps.rng,
    );
    if (!started.ok) {
      // Kann bei validierten Einstellungen nicht passieren; Tisch bleibt bedienbar.
      this.status = 'open';
      this.deps.log.error({ tableId: this.id, error: started.error }, 'startRound fehlgeschlagen');
      return err('INTERNAL', started.error.message);
    }
    this.round = started.round;
    this.dealNextHand();
    return OK;
  }

  /**
   * Aktion eines Spielers aus einer Client-Nachricht. `handNumber`/`seq` müssen zur aktuellen Hand passen,
   * sonst ist es ein veralteter Klick (`STALE_ACTION`).
   */
  act(userId: number, handNumber: number, seq: number, action: Action): TableResult {
    const round = this.round;
    if (this.status !== 'running' || round?.phase !== 'hand' || round.hand === null) {
      return err('NO_HAND_IN_PROGRESS', 'Gerade läuft keine Hand');
    }
    if (this.seatOf(userId) === null) return err('NOT_SEATED', 'Du spielst an diesem Tisch nicht mit');
    if (round.hand.toActId !== playerIdOf(userId)) return err('NOT_YOUR_TURN', 'Du bist nicht am Zug');
    if (handNumber !== round.handNumber || seq !== round.hand.log.length) {
      return err('STALE_ACTION', 'Die Aktion ist veraltet – der Tisch hat sich inzwischen geändert');
    }
    return this.actFor(userId, action);
  }

  /**
   * Aktion im Namen eines Spielers ohne Prüfung von `handNumber`/`seq` – für automatische Aktionen
   * des Servers (WP-012: Zeitablauf, nicht verbunden → Check, sonst Fold).
   */
  actFor(userId: number, action: Action): TableResult {
    const round = this.round;
    if (round?.phase !== 'hand') return err('NO_HAND_IN_PROGRESS', 'Gerade läuft keine Hand');
    const update = applyRoundAction(round, playerIdOf(userId), action);
    if (!update.ok) {
      const code = update.error.code as ErrorCode;
      return err(PASSED_ENGINE_CODES.has(code) ? code : 'ILLEGAL_ACTION', update.error.message);
    }
    this.round = update.round;
    this.afterTransition();
    return OK;
  }

  /** Check, wenn möglich, sonst Fold (D-013) – für WP-012. */
  autoCheckOrFold(userId: number): TableResult {
    const checked = this.actFor(userId, { type: 'check' });
    return checked.ok ? checked : this.actFor(userId, { type: 'fold' });
  }

  /** Beendet Timer; der Tisch nimmt danach keine Spielschritte mehr vor. */
  close(): void {
    this.closed = true;
    this.cancelPending?.();
    this.cancelPending = null;
    this.turn?.cancel();
    this.turn = null;
  }

  // -------------------------------------------------------------------------
  // Zug-Timer und Zeitbank (WP-012, D-013)
  // -------------------------------------------------------------------------

  /**
   * Gleicht den Zug-Timer mit dem Spielzustand ab: Ist ein neuer Spieler (bzw. eine neue Aktion) am Zug,
   * wird der alte Zug abgerechnet (verbrauchte Zeitbank) und ein neuer Timer gestartet.
   */
  private syncTurn(): void {
    const now = this.deps.clock.now();
    const round = this.round;
    const hand = round?.phase === 'hand' ? round.hand : null;
    const actorId = !this.closed && hand?.phase === 'betting' ? hand.toActId : null;
    if (round === null || hand === null || actorId === null) {
      this.endTurn(now);
      return;
    }
    const seq = hand.log.length;
    if (this.turn?.handNumber === round.handNumber && this.turn.actionSeq === seq) return;
    this.endTurn(now);
    const userId = Number(actorId);
    const player = hand.players.find((p) => p.id === actorId);
    this.turn = {
      userId,
      seat: player?.seat ?? -1,
      handNumber: round.handNumber,
      actionSeq: seq,
      startedAtMs: now,
      turnEndsAtMs: now + this.settings.turnTimeSeconds * 1000,
      bankAtStartMs: this.timeBankOf(userId),
      deadlineMs: now,
      cancel: () => undefined,
    };
    this.scheduleDeadline(now);
  }

  /** Rechnet den laufenden Zug ab: nur die über die normale Zugzeit hinaus verbrauchte Zeit kostet Zeitbank. */
  private endTurn(now: number): void {
    const turn = this.turn;
    if (turn === null) return;
    turn.cancel();
    this.turn = null;
    this.timeBanks.set(turn.userId, turn.bankAtStartMs - this.bankUsed(turn, now));
  }

  private bankUsed(turn: Turn, now: number): number {
    return Math.min(turn.bankAtStartMs, Math.max(0, now - turn.turnEndsAtMs));
  }

  private timeBankOf(userId: number): number {
    return this.timeBanks.get(userId) ?? this.settings.timeBankSeconds * 1000;
  }

  /** Plant die automatische Aktion; getrennte Spieler bekommen nur die Gnadenfrist ab `now`. */
  private scheduleDeadline(now: number): void {
    const turn = this.turn;
    if (turn === null) return;
    turn.cancel();
    const full = turn.turnEndsAtMs + turn.bankAtStartMs;
    turn.deadlineMs = this.isConnected(turn.userId) ? full : Math.min(full, now + this.deps.disconnectGraceMs);
    turn.cancel = this.deps.clock.schedule(Math.max(0, turn.deadlineMs - now), () => {
      this.onDeadline(turn);
    });
  }

  private onDeadline(turn: Turn): void {
    if (this.turn !== turn || this.closed) return;
    try {
      const result = this.autoCheckOrFold(turn.userId);
      if (!result.ok) {
        this.deps.log.error({ tableId: this.id, userId: turn.userId, result }, 'Automatische Aktion fehlgeschlagen');
      }
    } catch (error) {
      this.deps.log.error({ err: error, tableId: this.id }, 'Fehler bei der automatischen Aktion');
    }
  }

  /** Spieler am Zug hat sich getrennt bzw. ist zurück → Frist neu berechnen (Sicht sendet der Aufrufer). */
  private onConnectivityChange(userId: number): void {
    if (this.turn?.userId === userId) this.scheduleDeadline(this.deps.clock.now());
  }

  private dealNextHand(): void {
    this.cancelPending = null;
    if (this.closed || this.round === null) return;
    const now = this.deps.clock.now();
    const update = startNextHand(this.round, now, this.deps.rng);
    if (!update.ok) {
      this.deps.log.error({ tableId: this.id, error: update.error }, 'startNextHand fehlgeschlagen');
      return;
    }
    this.round = update.round;
    const hand = update.round.hand;
    if (hand !== null) {
      this.runHook('onHandStarted', {
        tableId: this.id,
        roundId: this.roundId ?? 0,
        handNumber: update.round.handNumber,
        hand,
        atMs: now,
      });
    }
    this.afterTransition();
  }

  /** Nach jedem Spielschritt: Sichten senden; bei beendeter Hand Hooks, Rundenende oder nächste Hand planen. */
  private afterTransition(): void {
    const round = this.round;
    if (round === null) return;
    if (round.phase === 'finished') this.status = 'finished';
    this.syncTurn();
    this.deps.onChange(this);
    if (round.hand?.phase !== 'complete') return;

    const now = this.deps.clock.now();
    const roundId = this.roundId ?? 0;
    this.runHook('onHandComplete', {
      tableId: this.id,
      roundId,
      handNumber: round.handNumber,
      hand: round.hand,
      round,
      atMs: now,
    });

    if (round.phase === 'finished') {
      this.finish(round, roundId, now);
      return;
    }
    this.cancelPending = this.deps.clock.schedule(this.deps.handPauseMs, () => {
      try {
        this.dealNextHand();
      } catch (error) {
        this.deps.log.error({ err: error, tableId: this.id }, 'Fehler beim Start der nächsten Hand');
      }
    });
  }

  private finish(round: RoundState, roundId: number, now: number): void {
    const standings = (round.standings ?? []).map((s) => ({ ...s, userId: Number(s.playerId) }));
    this.runHook('onRoundComplete', { tableId: this.id, roundId, standings, round, atMs: now });
    this.enqueue('finishRound', () =>
      this.deps.repository.finishRound(
        this.id,
        roundId,
        standings.map((s) => ({ userId: s.userId, placement: s.placement, points: s.points })),
      ),
    );
    this.deps.onRoundFinished(
      this,
      standings.map(({ userId, ...s }) => ({ ...s, user: this.userById(userId) })),
    );
  }

  private runHook<K extends keyof GameHooks>(name: K, event: Parameters<NonNullable<GameHooks[K]>>[0]): void {
    const hook = this.deps.hooks[name] as ((e: typeof event) => void | Promise<void>) | undefined;
    if (hook === undefined) return;
    this.enqueue(name, () => hook(event));
  }

  /** Hooks und DB-Schreibvorgänge eines Tisches laufen nacheinander; Fehler werden nur geloggt. */
  private enqueue(name: string, task: () => void | Promise<void>): void {
    this.hookQueue = this.hookQueue.then(task).catch((error: unknown) => {
      this.deps.log.error({ err: error, tableId: this.id, task: name }, 'Fehler in Tisch-Hook');
    });
  }

  /** Wartet, bis alle bisher eingereihten Hooks und Schreibvorgänge erledigt sind (Tests, Herunterfahren). */
  idle(): Promise<void> {
    return this.hookQueue;
  }

  private userById(userId: number): PublicUser {
    for (const user of this.seats.values()) if (user.id === userId) return { ...user };
    return { id: userId, username: '' };
  }

  // -------------------------------------------------------------------------
  // Sichten
  // -------------------------------------------------------------------------

  /** Gefilterte Sicht für einen Empfänger (D-003). */
  view(viewer: PublicUser): TableView {
    const seat = this.seatOf(viewer.id);
    const now = this.deps.clock.now();
    const turn = this.turn;
    const seats = [...this.seats]
      .sort(([a], [b]) => a - b)
      .map(([s, user]) => ({
        seat: s,
        user: { ...user },
        connected: this.isConnected(user.id),
        timeBankMs: turn?.userId === user.id ? turn.bankAtStartMs - this.bankUsed(turn, now) : this.timeBankOf(user.id),
      }));
    const turnClock: TurnClockView | null =
      turn === null
        ? null
        : {
            playerId: playerIdOf(turn.userId),
            seat: turn.seat,
            handNumber: turn.handNumber,
            actionSeq: turn.actionSeq,
            startedAtMs: turn.startedAtMs,
            turnEndsAtMs: turn.turnEndsAtMs,
            deadlineMs: turn.deadlineMs,
          };
    const seatedIds = new Set(seats.map((s) => s.user.id));
    return {
      id: this.id,
      inviteCode: this.inviteCode,
      createdBy: { ...this.createdBy },
      settings: structuredClone(this.settings),
      status: this.status,
      seats,
      spectators: [...this.watchers.keys()].filter((id) => !seatedIds.has(id)).length,
      round: this.round === null ? null : toClientView(this.round, seat === null ? null : playerIdOf(viewer.id), now),
      turnClock,
      serverNowMs: now,
      you: { userId: viewer.id, seat, isCreator: viewer.id === this.createdBy.id },
    };
  }

  /** Eintrag für die Lobby-Liste; `null`, wenn der Tisch dort nicht erscheint (privat oder beendet). */
  lobbyEntry(): LobbyTable | null {
    if (!this.settings.isPublic || this.status === 'finished' || this.closed) return null;
    const s = this.settings.blindStructure;
    const first = s.type === 'fixed' ? s.level : s.levels[0];
    return {
      id: this.id,
      name: this.settings.name,
      createdBy: { ...this.createdBy },
      status: this.status,
      seated: this.seats.size,
      maxSeats: this.settings.maxSeats,
      startingStack: this.settings.startingStack,
      blinds: { smallBlind: first?.smallBlind ?? 0, bigBlind: first?.bigBlind ?? 0 },
      blindType: s.type,
      turnTimeSeconds: this.settings.turnTimeSeconds,
      timeBankSeconds: this.settings.timeBankSeconds,
    };
  }
}
