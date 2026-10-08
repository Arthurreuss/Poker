// Datenschutz der Hand-Historie (WP-019, D-003): fremde Hole Cards nur bei `shown`, nie das Deck.
import { describe, expect, it } from 'vitest';
import type { Card } from '@poker/engine';
import { toHandRecord, type HandRecord } from '../history/records';
import { playRandomRound } from './test-rounds';
import { toHandSummary, toHandView, type HistoryHand } from './view';

const NAMES = new Map<number, string | null>([
  [10, 'anna'],
  [11, null], // gelöscht
  [12, 'cleo'],
]);

function historyHand(r: HandRecord, id = 5): HistoryHand {
  const rest: Partial<HandRecord> = { ...r };
  delete rest.deck;
  return { ...(rest as Omit<HandRecord, 'deck'>), id, startedAt: new Date('2026-10-08T12:00:00Z') };
}

/** Showdown zwischen 10 (zeigt, gewinnt) und 12 (muckt); 11 foldet preflop (Karten verdeckt). */
const SHOWDOWN: HandRecord = {
  roundId: 3,
  handNumber: 7,
  buttonSeat: 0,
  smallBlind: 10,
  bigBlind: 20,
  smallBlindSeat: 1,
  bigBlindSeat: 2,
  deck: ['Qs', 'Qh'],
  players: [
    { seat: 0, userId: 10, stack: 500, holeCards: ['As', 'Ad'] },
    { seat: 1, userId: 11, stack: 300, holeCards: ['2c', '7d'] },
    { seat: 2, userId: 12, stack: 400, holeCards: ['Kh', 'Kd'] },
  ],
  board: ['2h', '5s', '9c', 'Jd', '3h'],
  result: {
    showdown: true,
    allHandsShown: false,
    payouts: [{ userId: 10, amount: 130 }],
    uncalled: null,
    pots: [
      {
        amount: 130,
        eligibleUserIds: [10, 12],
        winnerUserIds: [10],
        shares: [{ userId: 10, amount: 130 }],
        winningHand: { category: 'pair', description: 'Paar, Asse', cards: ['As', 'Ad', 'Jd', '9c', '5s'] },
      },
    ],
    players: [
      { userId: 10, seat: 0, endStack: 570, folded: false, cards: 'shown', hand: null },
      { userId: 11, seat: 1, endStack: 290, folded: true, cards: 'hidden', hand: null },
      { userId: 12, seat: 2, endStack: 340, folded: false, cards: 'mucked', hand: null },
    ],
  },
  actions: [
    { seq: 1, userId: 11, street: 'preflop', action: 'small_blind', amount: 10, isAllIn: false, isAutomatic: false },
    { seq: 2, userId: 12, street: 'preflop', action: 'big_blind', amount: 20, isAllIn: false, isAutomatic: false },
    { seq: 3, userId: 10, street: 'preflop', action: 'raise', amount: 60, isAllIn: false, isAutomatic: false },
    { seq: 4, userId: 11, street: 'preflop', action: 'fold', amount: 0, isAllIn: false, isAutomatic: true },
    { seq: 5, userId: 12, street: 'preflop', action: 'call', amount: 40, isAllIn: false, isAutomatic: false },
    { seq: 6, userId: 12, street: 'flop', action: 'check', amount: 0, isAllIn: false, isAutomatic: false },
    { seq: 7, userId: 10, street: 'flop', action: 'check', amount: 0, isAllIn: false, isAutomatic: false },
  ],
};

describe('toHandView', () => {
  it('fremde Karten nur bei shown, eigene immer; gelöschte Spieler ohne Namen', () => {
    const view = toHandView(historyHand(SHOWDOWN), NAMES, 12);
    expect(view.players.map((p) => [p.seat, p.name, p.isViewer, p.cards, p.holeCards])).toEqual([
      [0, 'anna', false, 'shown', ['As', 'Ad']],
      [1, null, false, 'hidden', null],
      [2, 'cleo', true, 'mucked', ['Kh', 'Kd']],
    ]);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/"deck"/);
    for (const card of ['2c', '7d', 'Qs', 'Qh']) expect(json).not.toContain(`"${card}"`);
  });

  it('als Unbeteiligter sieht man nur gezeigte Karten', () => {
    const view = toHandView(historyHand(SHOWDOWN), NAMES, 999);
    expect(view.players.map((p) => p.holeCards)).toEqual([['As', 'Ad'], null, null]);
    const json = JSON.stringify(view);
    for (const card of ['2c', '7d', 'Kh', 'Kd', 'Qs', 'Qh']) expect(json).not.toContain(`"${card}"`);
  });

  it('Aktionen mit Sitz, Name, Straßeneinsatz und Automatik-Markierung; Pots und Gewinner', () => {
    const view = toHandView(historyHand(SHOWDOWN), NAMES, 10);
    expect(view.actions.map((a) => [a.seq, a.seat, a.name, a.action, a.amount, a.streetTotal, a.isAutomatic])).toEqual([
      [1, 1, null, 'small_blind', 10, 10, false],
      [2, 2, 'cleo', 'big_blind', 20, 20, false],
      [3, 0, 'anna', 'raise', 60, 60, false],
      [4, 1, null, 'fold', 0, 10, true],
      [5, 2, 'cleo', 'call', 40, 60, false],
      [6, 2, 'cleo', 'check', 0, 0, false],
      [7, 0, 'anna', 'check', 0, 0, false],
    ]);
    expect(view.pots).toEqual([
      { amount: 130, winners: [{ seat: 0, name: 'anna', amount: 130 }], handDescription: 'Paar, Asse' },
    ]);
    expect(view.winners).toEqual([{ seat: 0, name: 'anna', amount: 130 }]);
    expect(view.players[0]?.endStack).toBe(570);
  });

  it('ohne Showdown: Gewinner ohne zurückgegebenen Einsatz, keine Karten', () => {
    const r: HandRecord = {
      ...SHOWDOWN,
      board: [],
      result: {
        showdown: false,
        allHandsShown: false,
        payouts: [{ userId: 10, amount: 90 }],
        uncalled: { userId: 10, amount: 40 },
        pots: [],
        players: SHOWDOWN.players.map((p) => ({
          userId: p.userId,
          seat: p.seat,
          endStack: p.stack,
          folded: p.userId !== 10,
          cards: 'hidden' as const,
          hand: null,
        })),
      },
    };
    const view = toHandView(historyHand(r), NAMES, 11);
    expect(view.winners).toEqual([{ seat: 0, name: 'anna', amount: 50 }]);
    expect(view.players.map((p) => p.holeCards)).toEqual([null, ['2c', '7d'], null]);
  });
});

describe('toHandSummary', () => {
  it('nur eigene Karten und eigenes Ergebnis', () => {
    expect(toHandSummary(historyHand(SHOWDOWN), NAMES, 12)).toEqual({
      id: 5,
      handNumber: 7,
      board: ['2h', '5s', '9c', 'Jd', '3h'],
      winners: [{ seat: 0, name: 'anna', amount: 130 }],
      viewer: { holeCards: ['Kh', 'Kd'], net: -60 },
    });
    expect(toHandSummary(historyHand(SHOWDOWN), NAMES, 999).viewer).toBeNull();
  });
});

describe('Hand-Historie gibt nie verdeckte Karten heraus (Zufallsrunden)', () => {
  it('für jeden Betrachter: nur eigene, gezeigte und Board-Karten', () => {
    const hands = [1, 2, 3].flatMap((seed) => playRandomRound(seed, [100, 101, 102, 103, 104, 105].slice(0, 3 + seed)));
    expect(hands.length).toBeGreaterThan(10);
    let shownSeen = 0;
    for (const [i, state] of hands.entries()) {
      const record = toHandRecord(1, i + 1, state);
      const viewers = [...record.players.map((p) => p.userId), 999];
      for (const viewer of viewers) {
        const allowed = new Set<Card>(record.board);
        for (const p of record.players) {
          const shown = record.result?.players.find((x) => x.userId === p.userId)?.cards === 'shown';
          if (shown) shownSeen++;
          if (shown || p.userId === viewer) for (const c of p.holeCards) allowed.add(c);
        }
        const json = JSON.stringify([
          toHandView(historyHand(record), new Map(), viewer),
          toHandSummary(historyHand(record), new Map(), viewer),
        ]);
        const cards = json.match(/"[2-9TJQKA][cdhs]"/g) ?? [];
        for (const c of cards) expect(allowed.has(c.slice(1, 3) as Card)).toBe(true);
        expect(json).not.toMatch(/deck/i);
      }
    }
    expect(shownSeen).toBeGreaterThan(0);
  });
});
