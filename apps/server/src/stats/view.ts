// Hand-Historie für Clients (WP-019): rein, ohne DB. Datenschutz (D-003): fremde Hole Cards nur, wenn sie im
// Showdown gezeigt wurden (`shown`), eigene immer; das Deck wird gar nicht erst geladen (`HistoryHand` hat keins)
// und die Antwort wird Feld für Feld aufgebaut, nie aus dem gespeicherten Datensatz kopiert.
import type { Card } from '@poker/engine';
import type { HandActionType, Street } from '../db/types';
import type { CardVisibility, HandRecord } from '../history/records';

/** Gespeicherte, beendete Hand ohne Deck (so lädt `queries.ts` sie). */
export type HistoryHand = Omit<HandRecord, 'deck'> & { id: number; startedAt: Date };

/** Anzeigename je User-ID; `null` = Account gelöscht bzw. nicht (mehr) vorhanden. */
export type NameLookup = ReadonlyMap<number, string | null>;

export interface HandPlayerView {
  seat: number;
  /** `null` = gelöschter Spieler. */
  name: string | null;
  isViewer: boolean;
  startStack: number;
  endStack: number;
  folded: boolean;
  cards: CardVisibility;
  /** Nur eigene oder gezeigte Karten, sonst `null`. */
  holeCards: Card[] | null;
  /** Bewertung, nur bei gezeigten Karten. */
  handDescription: string | null;
}

export interface HandActionView {
  seq: number;
  street: Street;
  seat: number | null;
  name: string | null;
  action: HandActionType;
  /** In diesem Schritt eingezahlt. */
  amount: number;
  /** Einsatz auf dieser Straße nach der Aktion („erhöht auf …“). */
  streetTotal: number;
  isAllIn: boolean;
  isAutomatic: boolean;
}

export interface HandWinnerView {
  seat: number | null;
  name: string | null;
  amount: number;
}

export interface HandPotView {
  amount: number;
  winners: HandWinnerView[];
  handDescription: string | null;
}

export interface HandView {
  id: number;
  roundId: number;
  handNumber: number;
  startedAt: string;
  smallBlind: number;
  bigBlind: number;
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  board: Card[];
  showdown: boolean;
  players: HandPlayerView[];
  actions: HandActionView[];
  /** Main Pot zuerst; leer, wenn alle bis auf einen gefoldet haben. */
  pots: HandPotView[];
  /** Gewonnene Chips je Spieler (ohne zurückgegebene, nicht gecallte Einsätze). */
  winners: HandWinnerView[];
}

/** Kurzfassung für die Handliste einer Runde. */
export interface HandSummaryView {
  id: number;
  handNumber: number;
  board: Card[];
  winners: HandWinnerView[];
  /** Eigene Karten und Ergebnis (Stack nach − vor der Hand), wenn der Betrachter mitspielte. */
  viewer: { holeCards: Card[]; net: number } | null;
}

const nameOf = (names: NameLookup, userId: number): string | null => names.get(userId) ?? null;

function winnersOf(hand: HistoryHand, names: NameLookup): HandWinnerView[] {
  const result = hand.result;
  if (result === null) return [];
  const seats = new Map(hand.players.map((p) => [p.userId, p.seat]));
  return result.payouts
    .map((p) => ({
      userId: p.userId,
      amount: p.amount - (result.uncalled?.userId === p.userId ? result.uncalled.amount : 0),
    }))
    .filter((p) => p.amount > 0)
    .map((p) => ({ seat: seats.get(p.userId) ?? null, name: nameOf(names, p.userId), amount: p.amount }));
}

/** Detailansicht einer Hand für `viewerId`. */
export function toHandView(hand: HistoryHand, names: NameLookup, viewerId: number): HandView {
  const result = hand.result;
  const seats = new Map(hand.players.map((p) => [p.userId, p.seat]));
  const outcome = new Map((result?.players ?? []).map((p) => [p.userId, p]));
  const streetTotals = new Map<string, number>();
  return {
    id: hand.id,
    roundId: hand.roundId,
    handNumber: hand.handNumber,
    startedAt: hand.startedAt.toISOString(),
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    buttonSeat: hand.buttonSeat,
    smallBlindSeat: hand.smallBlindSeat,
    bigBlindSeat: hand.bigBlindSeat,
    board: [...hand.board],
    showdown: result?.showdown ?? false,
    players: hand.players.map((p) => {
      const o = outcome.get(p.userId);
      const cards: CardVisibility = o?.cards ?? 'hidden';
      const isViewer = p.userId === viewerId;
      return {
        seat: p.seat,
        name: nameOf(names, p.userId),
        isViewer,
        startStack: p.stack,
        endStack: o?.endStack ?? p.stack,
        folded: o?.folded ?? false,
        cards,
        holeCards: isViewer || cards === 'shown' ? [...p.holeCards] : null,
        handDescription: cards === 'shown' ? (o?.hand?.description ?? null) : null,
      };
    }),
    actions: hand.actions.map((a) => {
      const key = `${a.street}/${String(a.userId)}`;
      const streetTotal = (streetTotals.get(key) ?? 0) + a.amount;
      streetTotals.set(key, streetTotal);
      return {
        seq: a.seq,
        street: a.street,
        seat: seats.get(a.userId) ?? null,
        name: nameOf(names, a.userId),
        action: a.action,
        amount: a.amount,
        streetTotal,
        isAllIn: a.isAllIn,
        isAutomatic: a.isAutomatic,
      };
    }),
    pots: (result?.pots ?? []).map((pot) => ({
      amount: pot.amount,
      winners: pot.shares.map((s) => ({
        seat: seats.get(s.userId) ?? null,
        name: nameOf(names, s.userId),
        amount: s.amount,
      })),
      handDescription: pot.winningHand?.description ?? null,
    })),
    winners: winnersOf(hand, names),
  };
}

/** Kurzfassung einer Hand für `viewerId` (keine fremden Hole Cards). */
export function toHandSummary(hand: HistoryHand, names: NameLookup, viewerId: number): HandSummaryView {
  const own = hand.players.find((p) => p.userId === viewerId);
  const endStack = hand.result?.players.find((p) => p.userId === viewerId)?.endStack;
  return {
    id: hand.id,
    handNumber: hand.handNumber,
    board: [...hand.board],
    winners: winnersOf(hand, names),
    viewer: own === undefined ? null : { holeCards: [...own.holeCards], net: (endStack ?? own.stack) - own.stack },
  };
}
