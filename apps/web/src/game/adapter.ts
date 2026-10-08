// Adapter Protokoll → Tischansicht (WP-018): macht aus der gefilterten Server-Sicht (`@poker/engine/protocol`)
// das darstellungsorientierte View-Model der Tischansicht (`src/table/types.ts`). Rein und unit-getestet;
// keine Spiellogik außer Darstellung (D-003). Pots der laufenden Hand rechnet `calculatePots` der Engine
// aus den Einsätzen früherer Straßen (dieselbe Regel wie im Showdown).
import { calculatePots, type Card, type LegalActions, type Street } from '@poker/engine';
import type { HandPlayerView, HandView, TableView as ServerTableView } from '@poker/engine/protocol';
import {
  MAX_SEATS,
  type HoleCardsView,
  type PlayerSeatView,
  type PotView,
  type SeatStatus,
  type SeatView,
  type TableView,
} from '../table/types';
import { turnClockDisplay, type TurnClock } from './turnClock';

const EMPTY: SeatView = { kind: 'empty' };
const NO_CARDS: HoleCardsView = { kind: 'none' };
const HIDDEN: HoleCardsView = { kind: 'hidden' };

function pair(cards: readonly Card[] | null): readonly [Card, Card] | null {
  if (cards === null || cards.length !== 2) return null;
  const [a, b] = cards;
  return a === undefined || b === undefined ? null : [a, b];
}

/** Hole Cards eines Spielers in der Hand aus Sicht des Betrachters. */
function holeCardsOf(hand: HandView, player: HandPlayerView, isHero: boolean): HoleCardsView {
  const cards = pair(player.holeCards);
  if (player.status === 'folded') return NO_CARDS;
  if (cards !== null) return isHero ? { kind: 'visible', cards } : { kind: 'shown', cards };
  // Im Showdown gemuckt: keine Karten mehr zeigen.
  if (hand.phase === 'complete' && hand.showdown?.reveals.some((r) => r.playerId === player.playerId)) {
    return NO_CARDS;
  }
  return HIDDEN;
}

/** Pots der laufenden Hand ohne die Einsätze der aktuellen Straße (die liegen noch vor den Sitzen). */
function potsOf(hand: HandView): PotView[] {
  if (hand.phase === 'complete') return []; // ausgezahlt – Ergebnis zeigt die Aktionsleiste
  const { pots } = calculatePots(
    hand.players.map((p) => ({ id: p.playerId, status: p.status, totalBet: p.totalBet - p.streetBet })),
  );
  return pots.filter((p) => p.amount > 0).map((p) => ({ amount: p.amount }));
}

export interface AdaptOptions {
  /** Zug-Timer (aus `readTurnClock`); ohne Timer bleibt der Ring aus. */
  readonly turnClock?: TurnClock | null;
  /** Lokale Uhrzeit für den Timer-Anteil. */
  readonly nowMs?: number;
}

/** Server-Sicht → View-Model der Tischansicht. */
export function toTableView(server: ServerTableView, options: AdaptOptions = {}): TableView {
  const round = server.round;
  const hand = round?.hand ?? null;
  const heroSeat = server.you.seat;
  const seats: SeatView[] = Array.from({ length: MAX_SEATS }, () => EMPTY);

  for (const s of server.seats) {
    if (s.seat < 0 || s.seat >= MAX_SEATS) continue;
    const playerId = String(s.user.id);
    const roundPlayer = round?.players.find((p) => p.id === playerId);
    const handPlayer = hand?.players.find((p) => p.playerId === playerId);
    const isHero = s.seat === heroSeat;
    const eliminated =
      roundPlayer !== undefined &&
      roundPlayer.stack === 0 &&
      roundPlayer.placement !== null &&
      (handPlayer === undefined || hand?.handNumber !== roundPlayer.eliminatedInHand);

    let status: SeatStatus = 'active';
    let stack = roundPlayer?.stack ?? server.settings.startingStack;
    let bet = 0;
    let holeCards: HoleCardsView = NO_CARDS;
    if (eliminated) {
      status = 'eliminated';
      stack = 0;
    } else if (hand !== null && handPlayer !== undefined) {
      status = handPlayer.status;
      stack = handPlayer.stack;
      bet = hand.phase === 'complete' ? 0 : handPlayer.streetBet;
      holeCards = holeCardsOf(hand, handPlayer, isHero);
    }
    const seat: PlayerSeatView = {
      kind: 'player',
      name: s.user.username,
      stack,
      bet,
      status,
      connected: s.connected,
      holeCards,
    };
    seats[s.seat] = seat;
  }

  const toActSeat =
    hand !== null && hand.phase === 'betting' && hand.toActId !== null
      ? (hand.players.find((p) => p.playerId === hand.toActId)?.seat ?? null)
      : null;

  const level = round?.blindLevel;
  const increasing = server.settings.blindStructure.type === 'increasing';
  const firstLevel =
    server.settings.blindStructure.type === 'fixed'
      ? server.settings.blindStructure.level
      : server.settings.blindStructure.levels[0];
  const blinds =
    hand !== null
      ? { small: hand.smallBlind, big: hand.bigBlind }
      : level !== undefined
        ? { small: level.smallBlind, big: level.bigBlind }
        : { small: firstLevel?.smallBlind ?? 0, big: firstLevel?.bigBlind ?? 0 };
  const levelNumber = increasing ? (level?.levelIndex ?? 0) + 1 : undefined;

  let timer: { timeRemaining?: number; timeBankSeconds?: number } = {};
  const clock = options.turnClock ?? null;
  if (clock !== null && toActSeat !== null && clock.seat === toActSeat) {
    const display = turnClockDisplay(clock, options.nowMs ?? Date.now());
    timer = {
      timeRemaining: display.fraction,
      ...(display.timeBankSeconds === undefined ? {} : { timeBankSeconds: display.timeBankSeconds }),
    };
  }

  return {
    seats,
    heroSeat,
    buttonSeat: hand?.buttonSeat ?? null,
    smallBlindSeat: hand?.smallBlindSeat ?? null,
    bigBlindSeat: hand?.bigBlindSeat ?? null,
    toActSeat,
    ...timer,
    board: hand?.board ?? [],
    pots: hand === null ? [] : potsOf(hand),
    blinds: levelNumber === undefined ? blinds : { ...blinds, level: levelNumber },
  };
}

/** Was die Aktionsleiste über den eigenen Spieler in der laufenden Hand wissen muss. */
export interface HeroHandContext {
  readonly handNumber: number;
  readonly street: Street;
  /** Erlaubte Aktionen, nur wenn man am Zug ist (vom Server, D-003). */
  readonly legal: LegalActions | null;
  /** Fehlende Chips zum Mitgehen (gekappt auf den Stack) – auch, wenn man nicht am Zug ist. */
  readonly toCall: number;
  readonly stack: number;
  readonly streetBet: number;
  /** Höchster Einsatz der Straße. */
  readonly currentBet: number;
  /** Summe aller Einsätze der Hand inkl. laufender Straße. */
  readonly pot: number;
  readonly bigBlind: number;
  /** Noch in der Hand und kann handeln (nicht gefoldet, nicht All-in). */
  readonly canAct: boolean;
}

/** Kontext für die Aktionsleiste; `null`, wenn man nicht in einer laufenden Hand sitzt. */
export function heroHandContext(server: ServerTableView): HeroHandContext | null {
  const hand = server.round?.hand;
  if (hand === null || hand === undefined || hand.phase !== 'betting' || server.you.seat === null) return null;
  const me = hand.players.find((p) => p.playerId === String(server.you.userId));
  if (me === undefined) return null;
  return {
    handNumber: hand.handNumber,
    street: hand.street,
    legal: hand.legalActions,
    toCall: Math.min(Math.max(hand.currentBet - me.streetBet, 0), me.stack),
    stack: me.stack,
    streetBet: me.streetBet,
    currentBet: hand.currentBet,
    pot: hand.pot,
    bigBlind: hand.bigBlind,
    canAct: me.status === 'active',
  };
}
