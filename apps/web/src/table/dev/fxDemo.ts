/**
 * Ablauf einer Hand für die Testseite (WP-031, `table-dev.html?fx=1`): zeigt alle Tisch-Animationen
 * nacheinander – Austeilen, Einsätze, Fold, Check, Einsätze → Pot, Board, Showdown, Pot → Gewinner.
 */
import type { Card, HoleCardsView, PlayerSeatView, SeatView, TableView } from '../types';
import { MAX_SEATS } from '../types';

const HIDDEN: HoleCardsView = { kind: 'hidden' };
const NONE: HoleCardsView = { kind: 'none' };
const HERO: HoleCardsView = { kind: 'visible', cards: ['Ah', 'Kh'] };

function p(name: string, stack: number, extra: Partial<PlayerSeatView> = {}): PlayerSeatView {
  return { kind: 'player', name, stack, bet: 0, status: 'active', connected: true, holeCards: HIDDEN, ...extra };
}

function table(players: Record<number, PlayerSeatView>, extra: Partial<TableView>): TableView {
  const seats: SeatView[] = Array.from({ length: MAX_SEATS }, (_, i) => players[i] ?? { kind: 'empty' });
  return {
    seats,
    heroSeat: 0,
    buttonSeat: 6,
    smallBlindSeat: 0,
    bigBlindSeat: 3,
    toActSeat: null,
    board: [],
    pots: [],
    blinds: { small: 50, big: 100, level: 2 },
    handNumber: 2,
    ...extra,
  };
}

const FLOP: Card[] = ['Qh', '7h', '2c'];
const TURN: Card[] = [...FLOP, 'Js'];
const RIVER: Card[] = [...TURN, 'Th'];

export const FX_DEMO: readonly TableView[] = [
  table(
    {
      0: p('Arthur', 2000, { holeCards: NONE }),
      3: p('Lena', 2000, { holeCards: NONE }),
      6: p('Mia', 2000, { holeCards: NONE }),
    },
    { handNumber: 1 },
  ),
  table(
    { 0: p('Arthur', 1950, { bet: 50, holeCards: HERO }), 3: p('Lena', 1900, { bet: 100 }), 6: p('Mia', 2000) },
    { toActSeat: 6 },
  ),
  table(
    {
      0: p('Arthur', 1950, { bet: 50, holeCards: HERO }),
      3: p('Lena', 1900, { bet: 100 }),
      6: p('Mia', 1700, { bet: 300 }),
    },
    { toActSeat: 0 },
  ),
  table(
    {
      0: p('Arthur', 1700, { bet: 300, holeCards: HERO }),
      3: p('Lena', 1900, { bet: 100 }),
      6: p('Mia', 1700, { bet: 300 }),
    },
    { toActSeat: 3 },
  ),
  table(
    {
      0: p('Arthur', 1700, { bet: 300, holeCards: HERO }),
      3: p('Lena', 1900, { status: 'folded', holeCards: NONE, bet: 100 }),
      6: p('Mia', 1700, { bet: 300 }),
    },
    { toActSeat: null },
  ),
  table(
    {
      0: p('Arthur', 1700, { holeCards: HERO }),
      3: p('Lena', 1900, { status: 'folded', holeCards: NONE }),
      6: p('Mia', 1700),
    },
    { board: FLOP, pots: [{ amount: 700 }], toActSeat: 0 },
  ),
  table(
    {
      0: p('Arthur', 1700, { holeCards: HERO }),
      3: p('Lena', 1900, { status: 'folded', holeCards: NONE }),
      6: p('Mia', 1700),
    },
    { board: FLOP, pots: [{ amount: 700 }], toActSeat: 6 },
  ),
  table(
    {
      0: p('Arthur', 1700, { holeCards: HERO }),
      3: p('Lena', 1900, { status: 'folded', holeCards: NONE }),
      6: p('Mia', 1200, { bet: 500 }),
    },
    { board: FLOP, pots: [{ amount: 700 }], toActSeat: 0 },
  ),
  table(
    {
      0: p('Arthur', 1200, { bet: 500, holeCards: HERO }),
      3: p('Lena', 1900, { status: 'folded', holeCards: NONE }),
      6: p('Mia', 1200, { bet: 500 }),
    },
    { board: FLOP, pots: [{ amount: 700 }] },
  ),
  table(
    {
      0: p('Arthur', 1200, { holeCards: HERO }),
      3: p('Lena', 1900, { status: 'folded', holeCards: NONE }),
      6: p('Mia', 1200),
    },
    { board: TURN, pots: [{ amount: 1700 }], toActSeat: 0 },
  ),
  table(
    {
      0: p('Arthur', 1200, { holeCards: HERO }),
      3: p('Lena', 1900, { status: 'folded', holeCards: NONE }),
      6: p('Mia', 1200),
    },
    { board: RIVER, pots: [{ amount: 1700 }], toActSeat: 0 },
  ),
  table(
    {
      0: p('Arthur', 2900, { holeCards: HERO }),
      3: p('Lena', 1900, { status: 'folded', holeCards: NONE }),
      6: p('Mia', 1200, { holeCards: { kind: 'shown', cards: ['Qs', 'Qd'] } }),
    },
    { board: RIVER, winnerSeats: [0], winningCards: ['Ah', 'Kh', 'Qh', '7h', 'Th'] },
  ),
];
