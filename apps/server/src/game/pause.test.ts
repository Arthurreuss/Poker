// Pause nach der Hand inkl. Showdown (WP-039) und All-in-Runout (WP-031).
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
const TIMES = { baseMs: 4000, showdownMs: 1500, perRunoutStreetMs: 1000 };
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
    expect(handPauseFor(hand, TIMES)).toBe(4000 + 1500 + expected * 1000);
  });

  it('Showdown: Grundpause + Zeit für Aufdecken und Gewinneranzeige (5,5 s mit den Standardwerten)', () => {
    const hand = { board: board(5), log: [ev('river')], showdown: SHOWDOWN };
    expect(handPauseFor(hand, TIMES)).toBe(5500);
  });

  it('Hand ohne Showdown (Fold) hat keinen Runout', () => {
    expect(runoutStreets({ board: [], log: [ev('preflop')], showdown: null })).toBe(0);
    expect(handPauseFor({ board: [], log: [ev('preflop')], showdown: null }, TIMES)).toBe(4000);
  });
});
