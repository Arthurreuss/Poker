import { describe, expect, it } from 'vitest';
import { applyAction, startHand } from './betting';
import { parseCards, type Card } from './cards';
import { createDeck } from './deck';
import type { Action, HandState, PlayerStatus } from './hand-state';
import { clockwiseFrom } from './seats';
import { calculatePots } from './showdown';

// Tabellarische Tests für Pots und Showdown (WP-007).
// Spieler sitzen auf Sitz = Index in der Tabelle; Karten werden über ein präpariertes Deck verteilt.

// ---------------------------------------------------------------------------
// calculatePots: Einsätze → Pots
// ---------------------------------------------------------------------------

type Contribution = [id: string, totalBet: number, status: PlayerStatus];

const potCases: {
  name: string;
  players: Contribution[];
  pots: [amount: number, eligible: string][];
  uncalled: [string, number] | null;
}[] = [
  {
    name: 'alle gleich, ein Pot',
    players: [
      ['A', 100, 'active'],
      ['B', 100, 'active'],
      ['C', 100, 'active'],
    ],
    pots: [[300, 'A B C']],
    uncalled: null,
  },
  {
    name: 'ein kurzer All-in → Main + Side Pot',
    players: [
      ['A', 100, 'allIn'],
      ['B', 300, 'active'],
      ['C', 300, 'active'],
    ],
    pots: [
      [300, 'A B C'],
      [400, 'B C'],
    ],
    uncalled: null,
  },
  {
    name: 'Heads-up, größerer Stack nicht gecallt → Überschuss zurück',
    players: [
      ['A', 1000, 'allIn'],
      ['B', 300, 'allIn'],
    ],
    pots: [[600, 'A B']],
    uncalled: ['A', 700],
  },
  {
    name: 'drei verschiedene All-ins und ein Überdecker',
    players: [
      ['A', 50, 'allIn'],
      ['B', 150, 'allIn'],
      ['C', 300, 'allIn'],
      ['D', 500, 'active'],
    ],
    pots: [
      [200, 'A B C D'],
      [300, 'B C D'],
      [300, 'C D'],
    ],
    uncalled: ['D', 200],
  },
  {
    name: 'gefoldeter Einsatz bleibt als totes Geld in mehreren Pots',
    players: [
      ['A', 100, 'allIn'],
      ['B', 250, 'folded'],
      ['C', 400, 'active'],
      ['D', 400, 'active'],
    ],
    pots: [
      [400, 'A C D'],
      [750, 'C D'],
    ],
    uncalled: null,
  },
  {
    name: 'gefoldeter Spieler mit großem Einsatz: Side Pot nur für einen, Überschuss zurück',
    players: [
      ['A', 5000, 'active'],
      ['B', 300, 'allIn'],
      ['C', 100, 'folded'],
      ['D', 3000, 'folded'],
    ],
    pots: [
      [1000, 'A B'],
      [5400, 'A'],
    ],
    uncalled: ['A', 2000],
  },
];

describe('calculatePots', () => {
  it.each(potCases)('$name', ({ players, pots, uncalled }) => {
    const input = players.map(([id, totalBet, status]) => ({ id, totalBet, status }));
    const result = calculatePots(input);
    expect(result.pots).toEqual(pots.map(([amount, eligible]) => ({ amount, eligibleIds: eligible.split(' ') })));
    expect(result.uncalled).toEqual(uncalled === null ? null : { playerId: uncalled[0], amount: uncalled[1] });
    // Nichts geht verloren.
    const potSum = result.pots.reduce((sum, pot) => sum + pot.amount, 0);
    expect(potSum + (result.uncalled?.amount ?? 0)).toBe(input.reduce((sum, p) => sum + p.totalBet, 0));
  });
});

// ---------------------------------------------------------------------------
// Ganze Hände: Stacks + Aktionen → Pots und Auszahlungen
// ---------------------------------------------------------------------------

interface HandCase {
  name: string;
  /** [id, Stack]; Sitz = Index. */
  players: [string, number][];
  buttonSeat: number;
  blinds: [small: number, big: number];
  ante?: number;
  /** Hole Cards je Spieler, z. B. `'As Ad'`. */
  holes: Record<string, string>;
  board: string;
  actions: [string, Action][];
  pots: { amount: number; eligible: string; winners: string; hand?: string }[];
  uncalled?: [string, number];
  payouts: Record<string, number>;
  stacks: Record<string, number>;
}

const fold: Action = { type: 'fold' };
const check: Action = { type: 'check' };
const call: Action = { type: 'call' };
const allIn: Action = { type: 'allIn' };
const bet = (amount: number): Action => ({ type: 'bet', amount });
const raise = (amount: number): Action => ({ type: 'raise', amount });
const checkAround = (ids: string[]): [string, Action][] => ids.map((id) => [id, check]);

const ROYAL = 'As Ks Qs Js Ts';

const handCases: HandCase[] = [
  {
    name: 'Drei-Wege-All-in mit verschiedenen Stacks, Split im Side Pot',
    players: [
      ['A', 1000],
      ['B', 2000],
      ['C', 3000],
    ],
    buttonSeat: 0,
    blinds: [50, 100],
    holes: { A: 'As Ad', B: 'Ks Qd', C: 'Kc Qs' },
    board: '2h 7d 9s Jc 3h',
    actions: [
      ['A', allIn],
      ['B', allIn],
      ['C', call],
    ],
    pots: [
      { amount: 3000, eligible: 'A B C', winners: 'A', hand: 'Paar, Asse, Kicker Bube, Neun und Sieben' },
      { amount: 2000, eligible: 'B C', winners: 'B C' },
    ],
    payouts: { A: 3000, B: 1000, C: 1000 },
    stacks: { A: 3000, B: 1000, C: 2000 },
  },
  {
    name: 'Board spielt: alle splitten jeden Pot, jeder bekommt seinen Einsatz zurück',
    players: [
      ['A', 1000],
      ['B', 2000],
      ['C', 3000],
    ],
    buttonSeat: 0,
    blinds: [50, 100],
    holes: { A: '2c 3c', B: '4d 5d', C: '6h 7h' },
    board: ROYAL,
    actions: [
      ['A', allIn],
      ['B', allIn],
      ['C', call],
    ],
    pots: [
      { amount: 3000, eligible: 'A B C', winners: 'B C A', hand: 'Royal Flush' },
      { amount: 2000, eligible: 'B C', winners: 'B C' },
    ],
    payouts: { A: 1000, B: 2000, C: 2000 },
    stacks: { A: 1000, B: 2000, C: 3000 },
  },
  {
    name: 'Gefoldeter Spieler mit großem Einsatz: tote Chips, Side Pot ohne Gegner, Überschuss zurück',
    players: [
      ['A', 5000],
      ['B', 300],
      ['C', 5000],
      ['D', 5000],
    ],
    buttonSeat: 0,
    blinds: [50, 100],
    holes: { A: 'Kd Kc', B: 'Ah Ac', C: '2c 3d', D: 'Qs Qh' },
    board: '4s 8h 9d Js 6c',
    actions: [
      ['D', raise(1000)],
      ['A', call],
      ['B', allIn],
      ['C', fold],
      ['D', bet(2000)],
      ['A', allIn],
      ['D', fold],
    ],
    pots: [
      { amount: 1000, eligible: 'A B', winners: 'B' },
      { amount: 5400, eligible: 'A', winners: 'A' },
    ],
    uncalled: ['A', 2000],
    payouts: { A: 7400, B: 1000 },
    stacks: { A: 7400, B: 1000, C: 4900, D: 2000 },
  },
  {
    name: 'Ungerade Chips: zwei Restchips einzeln an die ersten Gewinner links vom Button',
    players: [
      ['A', 1000],
      ['B', 1000],
      ['C', 1000],
      ['D', 1000],
    ],
    buttonSeat: 0,
    blinds: [5, 10],
    ante: 2,
    holes: { A: '2c 3c', B: '4d 5d', C: '6h 7h', D: '8c 9c' },
    board: ROYAL,
    actions: [
      ['D', fold],
      ['A', call],
      ['B', call],
      ['C', check],
      ...checkAround(['B', 'C', 'A', 'B', 'C', 'A', 'B', 'C', 'A']),
    ],
    pots: [{ amount: 38, eligible: 'A B C', winners: 'B C A' }],
    payouts: { A: 12, B: 13, C: 13 },
    stacks: { A: 1000, B: 1001, C: 1001, D: 998 },
  },
  {
    name: 'Ungerader Chip im Side Pot (tote Chips eines Gefoldeten), Board spielt',
    players: [
      ['A', 300],
      ['B', 5000],
      ['C', 5000],
      ['D', 5000],
    ],
    buttonSeat: 0,
    blinds: [50, 100],
    holes: { A: '2c 3c', B: '4d 5d', C: '6h 7h', D: '8c 9c' },
    board: ROYAL,
    actions: [
      ['D', call],
      ['A', allIn],
      ['B', call],
      ['C', call],
      ['D', call],
      ['B', bet(101)],
      ['C', call],
      ['D', raise(400)],
      ['B', fold],
      ['C', call],
      ...checkAround(['C', 'D', 'C', 'D']),
    ],
    pots: [
      { amount: 1200, eligible: 'A C D', winners: 'C D A' },
      { amount: 901, eligible: 'C D', winners: 'C D' },
    ],
    payouts: { A: 400, C: 851, D: 850 },
    stacks: { A: 400, B: 4599, C: 5151, D: 5150 },
  },
  {
    name: 'Ungerader Chip bei Button auf dem letzten Sitz geht an Sitz 0',
    players: [
      ['A', 1000],
      ['B', 1000],
      ['C', 1000],
    ],
    buttonSeat: 2,
    blinds: [5, 10],
    ante: 1,
    holes: { A: '2c 3c', B: '4d 5d', C: '6h 7h' },
    board: ROYAL,
    actions: [
      ['C', call],
      ['A', call],
      ['B', check],
      ['A', check],
      ['B', check],
      ['C', fold],
      ...checkAround(['A', 'B', 'A', 'B']),
    ],
    pots: [{ amount: 33, eligible: 'A B', winners: 'A B' }],
    payouts: { A: 17, B: 16 },
    stacks: { A: 1006, B: 1005, C: 989 },
  },
  {
    name: 'Heads-up-All-in, kürzerer Stack gewinnt: Überschuss zurück an den Größeren',
    players: [
      ['A', 1000],
      ['B', 600],
    ],
    buttonSeat: 0,
    blinds: [50, 100],
    holes: { A: 'Kh Kd', B: 'Ah Ad' },
    board: '2c 5s 8d 9c Js',
    actions: [
      ['A', allIn],
      ['B', call],
    ],
    pots: [{ amount: 1200, eligible: 'A B', winners: 'B' }],
    uncalled: ['A', 400],
    payouts: { A: 400, B: 1200 },
    stacks: { A: 400, B: 1200 },
  },
  {
    name: 'Heads-up-All-in, größerer Stack gewinnt alles',
    players: [
      ['A', 1000],
      ['B', 600],
    ],
    buttonSeat: 0,
    blinds: [50, 100],
    holes: { A: 'Ah Ad', B: 'Kh Kd' },
    board: '2c 5s 8d 9c Js',
    actions: [
      ['A', allIn],
      ['B', call],
    ],
    pots: [{ amount: 1200, eligible: 'A B', winners: 'A', hand: 'Paar, Asse, Kicker Bube, Neun und Acht' }],
    uncalled: ['A', 400],
    payouts: { A: 1600 },
    stacks: { A: 1600, B: 0 },
  },
];

/** Deck so präparieren, dass jeder Spieler `holes` bekommt und das Board `board` ist. */
function riggedDeck(c: HandCase): Card[] {
  const seats = c.players.map(([id], seat) => ({ id, seat }));
  const order = clockwiseFrom(seats, c.buttonSeat);
  const holes = new Map(order.map(({ id }) => [id, parseCards(c.holes[id] ?? '')]));
  const board = parseCards(c.board);
  const used = new Set([...board, ...[...holes.values()].flat()]);
  const rest = createDeck().filter((card) => !used.has(card));
  const take = (): Card => {
    const card = rest.shift();
    if (card === undefined) throw new Error('Deck leer');
    return card;
  };
  const deck: Card[] = [];
  for (const round of [0, 1]) {
    for (const { id } of order) {
      const card = holes.get(id)?.[round];
      if (card === undefined) throw new Error(`Hole Cards für ${id} fehlen`);
      deck.push(card);
    }
  }
  const [f1, f2, f3, turn, river] = board as [Card, Card, Card, Card, Card];
  deck.push(take(), f1, f2, f3, take(), turn, take(), river, ...rest);
  return deck;
}

function playHand(c: HandCase): HandState {
  const started = startHand({
    players: c.players.map(([id, stack], seat) => ({ id, seat, stack })),
    buttonSeat: c.buttonSeat,
    smallBlind: c.blinds[0],
    bigBlind: c.blinds[1],
    ante: c.ante ?? 0,
    deck: riggedDeck(c),
  });
  if (!started.ok) throw new Error(started.error.message);
  return c.actions.reduce((s, [id, action]) => {
    const result = applyAction(s, id, action);
    if (!result.ok) throw new Error(`${id} ${action.type}: ${result.error.message}`);
    return result.state;
  }, started.state);
}

describe('Showdown: Stacks + Aktionen → Pots und Auszahlungen', () => {
  it.each(handCases)('$name', (c) => {
    const s = playHand(c);
    expect(s.phase).toBe('complete');
    expect(s.board).toEqual(parseCards(c.board));
    expect(s.showdown).not.toBeNull();
    const pots = s.showdown?.pots ?? [];
    expect(
      pots.map((pot) => ({
        amount: pot.amount,
        eligible: pot.eligibleIds.join(' '),
        winners: pot.winnerIds.join(' '),
      })),
    ).toEqual(c.pots.map(({ amount, eligible, winners }) => ({ amount, eligible, winners })));
    c.pots.forEach((expected, i) => {
      if (expected.hand !== undefined) expect(pots[i]?.winningHand?.description).toBe(expected.hand);
    });
    expect(s.showdown?.uncalled).toEqual(
      c.uncalled === undefined ? null : { playerId: c.uncalled[0], amount: c.uncalled[1] },
    );
    expect(Object.fromEntries((s.payouts ?? []).map((x) => [x.playerId, x.amount]))).toEqual(c.payouts);
    expect(Object.fromEntries(s.players.map((x) => [x.id, x.stack]))).toEqual(c.stacks);
    const before = c.players.reduce((sum, [, stack]) => sum + stack, 0);
    expect(s.players.reduce((sum, x) => sum + x.stack, 0)).toBe(before);
    // JSON-serialisierbar
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

// ---------------------------------------------------------------------------
// Welche Karten gezeigt werden
// ---------------------------------------------------------------------------

describe('Showdown: Zeigereihenfolge und Mucken', () => {
  const base: HandCase = {
    name: 'drei Spieler ohne All-in',
    players: [
      ['A', 10_000],
      ['B', 10_000],
      ['C', 10_000],
    ],
    buttonSeat: 0,
    blinds: [50, 100],
    holes: { A: 'Ah Ad', B: 'Kh Kd', C: 'Qh Qd' },
    board: '2c 5s 8d 9c Js',
    actions: [['A', call], ['B', call], ['C', check], ...checkAround(['B', 'C', 'A', 'B', 'C', 'A'])],
    pots: [],
    payouts: {},
    stacks: {},
  };
  const shown = (s: HandState) =>
    (s.showdown?.reveals ?? []).map((r) => [r.playerId, r.shownCards === null ? 'muck' : r.shownCards.join(' ')]);

  it('letzter Aggressor auf dem River zeigt zuerst; schlechtere Hände danach dürfen mucken', () => {
    const s = playHand({
      ...base,
      actions: [...base.actions, ['B', check], ['C', bet(100)], ['A', call], ['B', call]],
    });
    expect(shown(s)).toEqual([
      ['C', 'Qh Qd'],
      ['A', 'Ah Ad'],
      ['B', 'muck'],
    ]);
    expect(s.showdown?.allHandsShown).toBe(false);
    expect(s.payouts).toEqual([{ playerId: 'A', amount: 600 }]);
  });

  it('ohne Bet auf dem River zeigt der erste Spieler links vom Button zuerst', () => {
    const s = playHand({ ...base, actions: [...base.actions, ...checkAround(['B', 'C', 'A'])] });
    expect(shown(s)).toEqual([
      ['B', 'Kh Kd'],
      ['C', 'muck'],
      ['A', 'Ah Ad'],
    ]);
    // Hand auch für Mucker bewertet (Server filtert), Gewinner sieht man im Pot.
    expect(s.showdown?.reveals.map((r) => r.hand.category)).toEqual(['pair', 'pair', 'pair']);
    expect(s.showdown?.pots[0]?.winningHand?.description).toBe('Paar, Asse, Kicker Bube, Neun und Acht');
  });

  it('All-in-Situation: alle Hände werden aufgedeckt', () => {
    const s = playHand(handCases[2] as HandCase);
    expect(s.showdown?.allHandsShown).toBe(true);
    expect(shown(s)).toEqual([
      ['B', 'Ah Ac'],
      ['A', 'Kd Kc'],
    ]);
  });
});
