import { describe, expect, it } from 'vitest';
import { applyAction, startHand } from '../betting';
import type { Card } from '../cards';
import { createDeck } from '../deck';
import type { Action, HandState } from '../hand-state';
import { createSeededRng } from '../rng';
import { startNextHand, startRound } from '../round';
import { toClientView, toHandView } from './view';

// D-003: Was ein Empfänger sieht. Spieler A (Sitz 0, Button), B (Sitz 1, SB), C (Sitz 2, BB).
// Austeilen ab links vom Button: B, C, A, B, C, A; dann Burn, Flop, Burn, Turn, Burn, River.

function deckWith(order: Card[]): Card[] {
  return [...order, ...createDeck().filter((c) => !order.includes(c))];
}

// B: As Ah (Drilling Asse), C: 2c 7d, A: 3c 8d; Board Ad Kc 9s 4h 5s.
const MUCK_DECK = deckWith(['As', '2c', '3c', 'Ah', '7d', '8d', 'Qh', 'Ad', 'Kc', '9s', 'Jh', '4h', 'Th', '5s']);
const HOLE: Record<string, Card[]> = { A: ['3c', '8d'], B: ['As', 'Ah'], C: ['2c', '7d'] };
const BURNED: Card[] = ['Qh', 'Jh', 'Th'];

function start(deck: Card[] = MUCK_DECK, stacks: [number, number, number] = [1000, 1000, 1000]): HandState {
  const result = startHand({
    players: [
      { id: 'A', seat: 0, stack: stacks[0] },
      { id: 'B', seat: 1, stack: stacks[1] },
      { id: 'C', seat: 2, stack: stacks[2] },
    ],
    buttonSeat: 0,
    smallBlind: 10,
    bigBlind: 20,
    deck,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function play(state: HandState, steps: [string, Action][]): HandState {
  let s = state;
  for (const [id, action] of steps) {
    const r = applyAction(s, id, action);
    if (!r.ok) throw new Error(`${id} ${action.type}: ${r.error.message}`);
    s = r.state;
  }
  return s;
}

const CHECK_DOWN: [string, Action][] = [
  ['A', { type: 'call' }],
  ['B', { type: 'call' }],
  ['C', { type: 'check' }],
  ...['flop', 'turn', 'river'].flatMap((): [string, Action][] => [
    ['B', { type: 'check' }],
    ['C', { type: 'check' }],
    ['A', { type: 'check' }],
  ]),
];

/** Karten, die im serialisierten Text vorkommen (Karten-Strings in Anführungszeichen). */
function cardsIn(json: string): Set<string> {
  return new Set([...json.matchAll(/"([2-9TJQKA][cdhs])"/g)].map((m) => m[1] as string));
}

describe('toHandView', () => {
  it('zeigt vor dem Showdown nur die eigenen Hole Cards, nie Deck oder Burn-Karten', () => {
    const hand = play(start(), [['A', { type: 'call' }]]);
    for (const viewer of ['A', 'B', 'C']) {
      const view = toHandView(hand, 1, viewer);
      for (const p of view.players) {
        expect(p.holeCards).toEqual(p.playerId === viewer ? HOLE[p.playerId] : null);
      }
      const json = JSON.stringify(view);
      expect(json).not.toMatch(/"deck"|"burned"/);
      const visible = cardsIn(json);
      expect([...visible].sort()).toEqual([...(HOLE[viewer] as Card[])].sort());
    }
  });

  it('Zuschauer sehen keine Hole Cards und keine legalActions', () => {
    const hand = start();
    const view = toHandView(hand, 1, null);
    expect(view.players.every((p) => p.holeCards === null)).toBe(true);
    expect(view.legalActions).toBeNull();
    expect(cardsIn(JSON.stringify(view)).size).toBe(0);
  });

  it('legalActions nur für den Spieler am Zug', () => {
    const hand = start();
    expect(hand.toActId).toBe('A');
    expect(toHandView(hand, 1, 'A').legalActions?.playerId).toBe('A');
    expect(toHandView(hand, 1, 'B').legalActions).toBeNull();
    expect(toHandView(hand, 1, 'C').legalActions).toBeNull();
  });

  it('actionSeq zählt Protokolleinträge, handNumber kommt von außen', () => {
    const hand = start();
    const view = toHandView(hand, 7, 'A');
    expect(view.handNumber).toBe(7);
    expect(view.actionSeq).toBe(2); // Small + Big Blind
    expect(toHandView(play(hand, [['A', { type: 'call' }]]), 7, 'A').actionSeq).toBe(3);
  });

  it('im Showdown nur gezeigte Karten; gemuckte Karten und ihre Bewertung nie', () => {
    const hand = play(start(), CHECK_DOWN);
    expect(hand.phase).toBe('complete');
    const reveals = hand.showdown?.reveals ?? [];
    expect(reveals.map((r) => [r.playerId, r.shownCards])).toEqual([
      ['B', HOLE['B']],
      ['C', null],
      ['A', null],
    ]);

    for (const viewer of ['A', 'B', 'C', null]) {
      const view = toHandView(hand, 1, viewer);
      for (const p of view.players) {
        const expected = p.playerId === 'B' || p.playerId === viewer ? HOLE[p.playerId] : null;
        expect(p.holeCards, `${String(viewer)} sieht ${p.playerId}`).toEqual(expected);
      }
      for (const r of view.showdown?.reveals ?? []) {
        const visible = r.playerId === 'B' || r.playerId === viewer;
        expect(r.hand === null, `${String(viewer)}: Bewertung von ${r.playerId}`).toBe(!visible);
      }
      const visibleCards = cardsIn(JSON.stringify(view));
      for (const [id, cards] of Object.entries(HOLE)) {
        if (id === 'B' || id === viewer) continue;
        for (const c of cards) expect(visibleCards.has(c), `${String(viewer)} sieht ${c} von ${id}`).toBe(false);
      }
      for (const c of BURNED) expect(visibleCards.has(c)).toBe(false);
    }
  });

  it('All-in: alle verbliebenen Hände werden gezeigt', () => {
    const hand = play(start(MUCK_DECK, [100, 100, 100]), [
      ['A', { type: 'allIn' }],
      ['B', { type: 'allIn' }],
      ['C', { type: 'fold' }],
    ]);
    expect(hand.showdown?.allHandsShown).toBe(true);
    const view = toHandView(hand, 1, 'C');
    const byId = Object.fromEntries(view.players.map((p) => [p.playerId, p.holeCards]));
    expect(byId).toEqual({ A: HOLE['A'], B: HOLE['B'], C: HOLE['C'] });
    const viewB = toHandView(hand, 1, 'B');
    expect(viewB.players.find((p) => p.playerId === 'C')?.holeCards).toBeNull();
  });

  it('Fold-out: niemand zeigt Karten', () => {
    const hand = play(start(), [
      ['A', { type: 'fold' }],
      ['B', { type: 'fold' }],
    ]);
    expect(hand.phase).toBe('complete');
    const view = toHandView(hand, 1, 'A');
    expect(view.showdown).toBeNull();
    expect(view.players.filter((p) => p.holeCards !== null).map((p) => p.playerId)).toEqual(['A']);
    expect(view.payouts).toEqual([{ playerId: 'C', amount: 30 }]);
  });

  it('verändert den Eingabezustand nicht und teilt keine Referenzen', () => {
    const hand = play(start(), CHECK_DOWN);
    const before = JSON.stringify(hand);
    const view = toHandView(hand, 1, 'B');
    view.board.push('2h');
    view.players[0]?.holeCards?.push('2h');
    view.showdown?.reveals[0]?.shownCards?.push('2h');
    expect(JSON.stringify(hand)).toBe(before);
  });
});

describe('toClientView', () => {
  it('filtert die Hand der Runde und liefert das Blind-Level', () => {
    const rng = createSeededRng(7);
    const started = startRound(
      {
        startingStack: 1000,
        blindStructure: {
          type: 'increasing',
          levels: [
            { smallBlind: 10, bigBlind: 20 },
            { smallBlind: 20, bigBlind: 40 },
          ],
          levelMinutes: 10,
        },
        turnTimeSeconds: 20,
        timeBankSeconds: 60,
      },
      [
        { id: 'A', seat: 0 },
        { id: 'B', seat: 4 },
      ],
      rng,
      { buttonSeat: 0 },
    );
    if (!started.ok) throw new Error(started.error.message);
    const before = toClientView(started.round, 'A', 0);
    expect(before.hand).toBeNull();
    expect(before.blindLevel).toEqual({ smallBlind: 10, bigBlind: 20, levelIndex: 0, nextLevelAtMs: null });

    const next = startNextHand(started.round, 1_000, rng);
    if (!next.ok) throw new Error(next.error.message);
    const view = toClientView(next.round, 'A', 1_000);
    expect(view.phase).toBe('hand');
    expect(view.handNumber).toBe(1);
    expect(view.hand?.handNumber).toBe(1);
    expect(view.blindLevel.nextLevelAtMs).toBe(1_000 + 600_000);
    expect(view.hand?.players.find((p) => p.playerId === 'A')?.holeCards).toHaveLength(2);
    expect(view.hand?.players.find((p) => p.playerId === 'B')?.holeCards).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/"deck"|"burned"/);
  });
});
