// Testhilfen (WP-018): echte Server-Sichten über die Engine (Runde starten, Aktionen anwenden, filtern)
// statt handgebauter Objekte – so passen Testdaten immer zum Protokoll.
import {
  applyRoundAction,
  createSeededRng,
  DEFAULT_BLIND_STRUCTURE,
  startNextHand,
  startRound,
  type Action,
  type RoundState,
} from '@poker/engine';
import {
  DEFAULT_TABLE_SETTINGS,
  toClientView,
  type TableView as ServerTableView,
  type TurnClockView,
} from '@poker/engine/protocol';

export const NOW = 1_000_000;
export const USERS = [
  { id: 1, username: 'anna' },
  { id: 2, username: 'ben' },
  { id: 3, username: 'cleo' },
] as const;

export interface Game {
  round: RoundState;
}

/** Runde mit `n` Spielern (Sitze 0, 1, 2 …), erste Hand ausgeteilt. */
export function startGame(n = 3, seed = 7, startingStack = 1500): Game {
  const rng = createSeededRng(seed);
  const started = startRound(
    { startingStack, blindStructure: DEFAULT_BLIND_STRUCTURE, turnTimeSeconds: 20, timeBankSeconds: 60 },
    USERS.slice(0, n).map((u, seat) => ({ id: String(u.id), seat })),
    rng,
  );
  if (!started.ok) throw new Error(started.error.message);
  const dealt = startNextHand(started.round, NOW, rng);
  if (!dealt.ok) throw new Error(dealt.error.message);
  return { round: dealt.round };
}

/** Wer ist am Zug (User-ID)? */
export function toAct(game: Game): number {
  const id = game.round.hand?.toActId;
  if (id === null || id === undefined) throw new Error('niemand am Zug');
  return Number(id);
}

export function act(game: Game, action: Action): void {
  const update = applyRoundAction(game.round, String(toAct(game)), action);
  if (!update.ok) throw new Error(update.error.message);
  game.round = update.round;
}

export interface ViewOptions {
  status?: ServerTableView['status'];
  connected?: boolean;
  turnClock?: TurnClockView | null;
  serverNowMs?: number;
}

/** Gefilterte Sicht für `viewerId` (wie `Table.view` auf dem Server). */
export function serverView(game: Game | null, viewerId: number | null, options: ViewOptions = {}): ServerTableView {
  const n = game?.round.players.length ?? USERS.length;
  const seats = USERS.slice(0, n).map((user, seat) => ({
    seat,
    user: { ...user },
    avatar: seat === 0 ? ('fox' as const) : null,
    connected: options.connected ?? true,
    timeBankMs: 60_000,
  }));
  const seat = seats.find((s) => s.user.id === viewerId)?.seat ?? null;
  return {
    id: 42,
    inviteCode: 'abc123',
    createdBy: { ...USERS[0] },
    settings: { ...DEFAULT_TABLE_SETTINGS, name: 'Testtisch' },
    status: options.status ?? (game === null ? 'open' : game.round.phase === 'finished' ? 'finished' : 'running'),
    seats,
    spectators: 0,
    round: game === null ? null : toClientView(game.round, seat === null ? null : String(viewerId), NOW),
    turnClock: options.turnClock ?? null,
    serverNowMs: options.serverNowMs ?? NOW,
    you: { userId: viewerId ?? 99, seat, isCreator: viewerId === USERS[0].id },
  };
}
