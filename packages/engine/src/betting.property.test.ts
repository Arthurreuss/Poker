import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, potTotal, startHand } from './betting';
import type { Action, HandState, LegalAction } from './hand-state';
import { createSeededRng, type Rng } from './rng';

// Property-Test: zufällige legale Aktionsfolgen (seeded) enden immer in einem gültigen Endzustand,
// die Chipsumme bleibt erhalten, und jede angebotene Aktion wird auch akzeptiert.

const HANDS = 400;
const MAX_STEPS = 200;

function randomInt(rng: Rng, min: number, max: number): number {
  return min + rng.int(max - min + 1);
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[rng.int(items.length)];
  if (item === undefined) throw new Error('leere Auswahl');
  return item;
}

function toAction(rng: Rng, legal: LegalAction): Action {
  switch (legal.type) {
    case 'bet':
    case 'raise': {
      // Häufig Mindestbetrag oder Maximum, sonst irgendetwas dazwischen.
      const r = rng.int(4);
      const amount = r === 0 ? legal.min : r === 1 ? legal.max : randomInt(rng, legal.min, legal.max);
      return { type: legal.type, amount };
    }
    case 'call':
      return { type: 'call' };
    default:
      return { type: legal.type };
  }
}

function chipsInPlay(s: HandState): number {
  const stacks = s.players.reduce((sum, p) => sum + p.stack, 0);
  return s.phase === 'complete' ? stacks : stacks + potTotal(s);
}

function checkInvariants(s: HandState, totalChips: number): void {
  expect(chipsInPlay(s)).toBe(totalChips);
  for (const p of s.players) {
    expect(p.stack).toBeGreaterThanOrEqual(0);
    expect(p.streetBet).toBeLessThanOrEqual(p.totalBet);
    // Nach der Auszahlung kann ein All-in-Gewinner wieder Chips haben.
    if (s.phase !== 'complete') expect(p.status === 'allIn').toBe(p.stack === 0 && p.status !== 'folded');
    expect(p.holeCards).toHaveLength(2);
  }
  const cards = [...s.deck, ...s.burned, ...s.board, ...s.players.flatMap((p) => p.holeCards)];
  expect(new Set(cards).size).toBe(52);
  expect(s.board).toHaveLength({ preflop: 0, flop: 3, turn: 4, river: 5 }[s.street]);
  if (s.phase === 'betting') {
    const actor = s.players.find((p) => p.id === s.toActId);
    expect(actor?.status).toBe('active');
  } else {
    expect(s.toActId).toBeNull();
  }
}

describe('Property: zufällige legale Hände', () => {
  it(`${String(HANDS)} Hände mit 2–9 Spielern enden gültig und erhalten die Chips`, () => {
    const rng = createSeededRng(20261008);
    const phases: Record<HandState['phase'], number> = { betting: 0, showdown: 0, complete: 0 };
    for (let hand = 0; hand < HANDS; hand++) {
      const count = randomInt(rng, 2, 9);
      const bigBlind = pick(rng, [2, 10, 100]);
      const players = Array.from({ length: count }, (_, i) => ({
        id: `P${String(i)}`,
        seat: i * 2 + rng.int(2),
        // Teils sehr kleine Stacks, damit Blinds/Antes All-in und Side-Pot-Lagen vorkommen.
        stack: rng.int(4) === 0 ? randomInt(rng, 1, bigBlind * 2) : randomInt(rng, bigBlind, bigBlind * 200),
      }));
      const totalChips = players.reduce((sum, p) => sum + p.stack, 0);
      const started = startHand({
        players,
        buttonSeat: randomInt(rng, 0, 18),
        smallBlind: bigBlind / 2,
        bigBlind,
        ante: rng.int(3) === 0 ? bigBlind / 2 : 0,
        rng,
      });
      if (!started.ok) throw new Error(started.error.message);
      let s = started.state;
      checkInvariants(s, totalChips);

      let steps = 0;
      for (let legal = legalActions(s); legal !== null; legal = legalActions(s)) {
        expect(legal.playerId).toBe(s.toActId);
        const action = toAction(rng, pick(rng, legal.actions));
        const before = JSON.stringify(s);
        const result = applyAction(s, legal.playerId, action);
        if (!result.ok)
          throw new Error(`Angebotene Aktion abgelehnt: ${JSON.stringify(action)} – ${result.error.message}`);
        expect(JSON.stringify(s)).toBe(before); // Eingabe unverändert
        // JSON-Kopie liefert denselben Folgezustand.
        expect(applyAction(JSON.parse(before) as HandState, legal.playerId, action)).toEqual(result);
        s = result.state;
        checkInvariants(s, totalChips);
        steps++;
        expect(steps).toBeLessThan(MAX_STEPS);
      }

      expect(s.phase).not.toBe('betting');
      const remaining = s.players.filter((p) => p.status !== 'folded');
      if (s.phase === 'complete') {
        expect(remaining).toHaveLength(1);
        expect(s.payouts).toEqual([{ playerId: remaining[0]?.id, amount: potTotal(s) }]);
      } else {
        expect(remaining.length).toBeGreaterThanOrEqual(2);
        expect(s.street).toBe('river');
        expect(s.board).toHaveLength(5);
        expect(s.payouts).toBeNull();
      }
      phases[s.phase]++;
    }
    // Beide Endzustände kommen tatsächlich vor.
    expect(phases.showdown).toBeGreaterThan(0);
    expect(phases.complete).toBeGreaterThan(0);
  });
});
