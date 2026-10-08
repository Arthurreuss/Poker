// Hand-Historie (WP-013): Abbildung eines Engine-Handzustands auf die gespeicherte Form (Tabellen `hands`,
// `hand_actions`) – rein, ohne DB. Format der JSONB-Spalten: siehe Typen unten und ARCHITECTURE.md,
// „Datenmodell“ → „Persistenz“. Engine-Spieler-ID = String(userId) (D-003).
import {
  initialDeck,
  type Card,
  type HandCategory,
  type HandEvent,
  type HandState,
  type ShowdownHand,
} from '@poker/engine';
import type { HandActionType, Street } from '../db/types';

/** Eintrag in `hands.players`: Spieler zu Handbeginn. Hole Cards immer (fürs Replay), Sichtbarkeit im Ergebnis. */
export interface StoredHandPlayer {
  seat: number;
  userId: number;
  /** Stack vor den Blinds. */
  stack: number;
  holeCards: Card[];
}

/** Bewertete Hand für die Anzeige (nur bei gezeigten Karten gespeichert). */
export interface StoredHandRank {
  category: HandCategory;
  description: string;
  /** Die fünf besten Karten. */
  cards: Card[];
}

/**
 * Sichtbarkeit der Hole Cards für spätere Anzeigen (D-003 gilt auch für die Historie):
 * `shown` = im Showdown gezeigt, `mucked` = im Showdown verdeckt weggeworfen,
 * `hidden` = nicht im Showdown (gefoldet oder ohne Showdown gewonnen).
 */
export type CardVisibility = 'shown' | 'mucked' | 'hidden';

export interface StoredChips {
  userId: number;
  amount: number;
}

export interface StoredPot {
  amount: number;
  eligibleUserIds: number[];
  /** Mehrere = Split. Bei einer Hand ohne Showdown leer (dann gibt es keine Pots, nur `payouts`). */
  winnerUserIds: number[];
  shares: StoredChips[];
  /** `null`, wenn nur ein Spieler berechtigt war. */
  winningHand: StoredHandRank | null;
}

export interface StoredHandResultPlayer {
  userId: number;
  seat: number;
  /** Stack nach der Hand (inkl. Gewinn); 0 = ausgeschieden. */
  endStack: number;
  folded: boolean;
  cards: CardVisibility;
  /** Bewertung, nur wenn `cards === 'shown'`. */
  hand: StoredHandRank | null;
}

/** Inhalt von `hands.result` (gesetzt, sobald die Hand beendet ist). */
export interface StoredHandResult {
  /** `false` = alle bis auf einen haben gefoldet. */
  showdown: boolean;
  /** All-in-Situation: alle Hände aufgedeckt (TDA). */
  allHandsShown: boolean;
  /** Ausgezahlte Chips je Spieler (inkl. zurückgegebener, nicht gecallter Einsätze). */
  payouts: StoredChips[];
  /** Nicht gecallter Überschuss (in `payouts` enthalten). */
  uncalled: StoredChips | null;
  /** Main Pot zuerst, dann Side Pots; leer ohne Showdown. */
  pots: StoredPot[];
  players: StoredHandResultPlayer[];
}

/** Eine Zeile in `hand_actions`. */
export interface StoredAction {
  /** Ab 1, Reihenfolge des Engine-Protokolls (Blinds zuerst). */
  seq: number;
  userId: number;
  street: Street;
  action: HandActionType;
  /** In diesem Schritt eingezahlte Chips (bei Bet/Raise der Zuwachs, nicht „to“). */
  amount: number;
  isAllIn: boolean;
}

/** Eine Hand in der gespeicherten Form. `result`/`actions` erst bei beendeter Hand. */
export interface HandRecord {
  roundId: number;
  handNumber: number;
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  /** Deck zu Handbeginn (52 Karten); nie an Clients (D-003). */
  deck: Card[];
  players: StoredHandPlayer[];
  board: Card[];
  result: StoredHandResult | null;
  actions: StoredAction[];
}

const ACTION_TYPES: Record<Exclude<HandEvent['type'], 'ante'>, HandActionType> = {
  smallBlind: 'small_blind',
  bigBlind: 'big_blind',
  fold: 'fold',
  check: 'check',
  call: 'call',
  bet: 'bet',
  raise: 'raise',
};

const EVENT_TYPES = Object.fromEntries(Object.entries(ACTION_TYPES).map(([k, v]) => [v, k])) as Record<
  HandActionType,
  Exclude<HandEvent['type'], 'ante'>
>;

const userIdOf = (playerId: string): number => {
  const id = Number(playerId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Spieler-ID ${playerId} ist keine User-ID`);
  return id;
};

const rank = (h: ShowdownHand): StoredHandRank => ({
  category: h.category,
  description: h.description,
  cards: [...h.cards],
});

/** Hand → gespeicherte Form. Bei laufender Hand (`phase === 'betting'`) ohne Ergebnis und Aktionen. */
export function toHandRecord(roundId: number, handNumber: number, hand: HandState): HandRecord {
  if (hand.ante > 0) throw new Error('Antes gibt es nicht (D-016)');
  const complete = hand.phase === 'complete';
  return {
    roundId,
    handNumber,
    buttonSeat: hand.buttonSeat,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    smallBlindSeat: hand.smallBlindSeat,
    bigBlindSeat: hand.bigBlindSeat,
    deck: initialDeck(hand),
    players: hand.players.map((p) => ({
      seat: p.seat,
      userId: userIdOf(p.id),
      stack: p.startStack,
      holeCards: [...p.holeCards],
    })),
    board: complete ? [...hand.board] : [],
    result: complete ? toResult(hand) : null,
    actions: complete ? hand.log.map(toStoredAction) : [],
  };
}

function toStoredAction(e: HandEvent, i: number): StoredAction {
  if (e.type === 'ante') throw new Error('Antes gibt es nicht (D-016)');
  return {
    seq: i + 1,
    userId: userIdOf(e.playerId),
    street: e.street,
    action: ACTION_TYPES[e.type],
    amount: e.amount,
    isAllIn: e.allIn,
  };
}

function toResult(hand: HandState): StoredHandResult {
  const sd = hand.showdown;
  const reveals = new Map((sd?.reveals ?? []).map((r) => [r.playerId, r]));
  const chips = (c: { playerId: string; amount: number }): StoredChips => ({
    userId: userIdOf(c.playerId),
    amount: c.amount,
  });
  return {
    showdown: sd !== null,
    allHandsShown: sd?.allHandsShown ?? false,
    payouts: (hand.payouts ?? []).map(chips),
    uncalled: sd?.uncalled ? chips(sd.uncalled) : null,
    pots: (sd?.pots ?? []).map((p) => ({
      amount: p.amount,
      eligibleUserIds: p.eligibleIds.map(userIdOf),
      winnerUserIds: p.winnerIds.map(userIdOf),
      shares: p.shares.map(chips),
      winningHand: p.winningHand === null ? null : rank(p.winningHand),
    })),
    players: hand.players.map((p) => {
      const reveal = reveals.get(p.id);
      const cards: CardVisibility = reveal === undefined ? 'hidden' : reveal.shownCards === null ? 'mucked' : 'shown';
      return {
        userId: userIdOf(p.id),
        seat: p.seat,
        endStack: p.stack,
        folded: p.status === 'folded',
        cards,
        hand: cards === 'shown' && reveal !== undefined ? rank(reveal.hand) : null,
      };
    }),
  };
}

/** Gespeicherte Aktion → Protokolleintrag der Engine (für `replayHand`). */
export function toReplayEvent(a: StoredAction): Pick<HandEvent, 'street' | 'playerId' | 'type' | 'amount' | 'allIn'> {
  return {
    street: a.street,
    playerId: String(a.userId),
    type: EVENT_TYPES[a.action],
    amount: a.amount,
    allIn: a.isAllIn,
  };
}
