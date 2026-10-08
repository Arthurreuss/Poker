// Pause nach der Hand inkl. All-in-Runout (WP-031).
import { describe, expect, it } from 'vitest';
import type { HandEvent, ShowdownSummary } from '@poker/engine';
import { handPauseFor, runoutStreets } from './pause';

const SHOWDOWN: ShowdownSummary = { uncalled: null, pots: [], reveals: [], allHandsShown: true };
const ev = (street: HandEvent['street']): HandEvent => ({
  street,
  playerId: '1',
  type: 'call',
  amount: 10,
  to: 10,
  allIn: true,
});
const board = (n: number) => ['2c', '3d', '4h', '5s', '7c'].slice(0, n) as never[];

describe('runoutStreets / handPauseFor', () => {
  it.each([
    { name: 'All-in preflop → Flop, Turn, River', last: 'preflop' as const, cards: 5, expected: 3 },
    { name: 'All-in am Flop → Turn, River', last: 'flop' as const, cards: 5, expected: 2 },
    { name: 'All-in am Turn → River', last: 'turn' as const, cards: 5, expected: 1 },
    { name: 'normaler Showdown nach dem River', last: 'river' as const, cards: 5, expected: 0 },
  ])('$name', ({ last, cards, expected }) => {
    const hand = { board: board(cards), log: [ev('preflop'), ev(last)], showdown: SHOWDOWN };
    expect(runoutStreets(hand)).toBe(expected);
    expect(handPauseFor(hand, 4000, 1000)).toBe(4000 + expected * 1000);
  });

  it('Hand ohne Showdown (Fold) hat keinen Runout', () => {
    expect(runoutStreets({ board: [], log: [ev('preflop')], showdown: null })).toBe(0);
    expect(handPauseFor({ board: [], log: [ev('preflop')], showdown: null }, 4000, 1000)).toBe(4000);
  });
});
