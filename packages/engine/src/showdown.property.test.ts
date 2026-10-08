import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, potTotal, startHand } from './betting';
import type { Action, HandState, LegalAction } from './hand-state';
import { createSeededRng, type Rng } from './rng';
import { calculatePots } from './showdown';

// Property-Test (WP-007): viele zufällige Hände mit 2–9 Spielern bis zum Ende inkl. Showdown.
// Prüft Chip-Erhaltung, keine negativen Stacks, Pots = Σ totalBet, Pots nur an Berechtigte.

const HANDS = 1500;

function randomInt(rng: Rng, min: number, max: number): number {
  return min + rng.int(max - min + 1);
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[rng.int(items.length)];
  if (item === undefined) throw new Error('leere Auswahl');
  return item;
}

/** Zufällige legale Aktion; Fold seltener, damit viele Hände bis zum Showdown laufen. */
function randomAction(rng: Rng, actions: readonly LegalAction[]): Action {
  const nonFold = actions.filter((a) => a.type !== 'fold');
  const legal = nonFold.length > 0 && rng.int(6) !== 0 ? pick(rng, nonFold) : pick(rng, actions);
  switch (legal.type) {
    case 'bet':
    case 'raise': {
      const r = rng.int(3);
      const amount = r === 0 ? legal.min : r === 1 ? legal.max : randomInt(rng, legal.min, legal.max);
      return { type: legal.type, amount };
    }
    default:
      return { type: legal.type };
  }
}

function playRandomHand(rng: Rng): { start: number; state: HandState } {
  const count = randomInt(rng, 2, 9);
  const bigBlind = pick(rng, [2, 10, 100]);
  const players = Array.from({ length: count }, (_, i) => ({
    id: `P${String(i)}`,
    seat: i * 2 + rng.int(2),
    // Teils kleine Stacks, damit viele Side Pots entstehen; ungerade Werte für ungerade Chips.
    stack: rng.int(3) === 0 ? randomInt(rng, 1, bigBlind * 5) : randomInt(rng, bigBlind, bigBlind * 100),
  }));
  const started = startHand({
    players,
    buttonSeat: randomInt(rng, 0, 18),
    smallBlind: bigBlind / 2,
    bigBlind,
    ante: rng.int(3) === 0 ? randomInt(rng, 1, bigBlind) : 0,
    rng,
  });
  if (!started.ok) throw new Error(started.error.message);
  let s = started.state;
  for (let legal = legalActions(s); legal !== null; legal = legalActions(s)) {
    const result = applyAction(s, legal.playerId, randomAction(rng, legal.actions));
    if (!result.ok) throw new Error(result.error.message);
    s = result.state;
  }
  return { start: players.reduce((sum, p) => sum + p.stack, 0), state: s };
}

describe('Property: Pots und Showdown', () => {
  it(`${String(HANDS)} zufällige Hände: Chips bleiben erhalten, Pots gehen nur an Berechtigte`, () => {
    const rng = createSeededRng(7_007);
    const seen = { showdowns: 0, sidePots: 0, splits: 0, uncalled: 0 };
    for (let hand = 0; hand < HANDS; hand++) {
      const { start, state: s } = playRandomHand(rng);
      expect(s.phase).toBe('complete');
      expect(s.toActId).toBeNull();

      // Chip-Erhaltung und keine negativen Stacks.
      expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(start);
      for (const p of s.players) expect(p.stack).toBeGreaterThanOrEqual(0);
      const payouts = s.payouts ?? [];
      expect(payouts.reduce((sum, x) => sum + x.amount, 0)).toBe(potTotal(s));
      for (const x of payouts) expect(x.amount).toBeGreaterThan(0);
      for (const p of s.players) {
        const paid = payouts.find((x) => x.playerId === p.id)?.amount ?? 0;
        expect(p.stack).toBe(p.startStack - p.totalBet + paid);
      }

      const sd = s.showdown;
      if (sd === null) continue;
      seen.showdowns++;
      const live = s.players.filter((p) => p.status !== 'folded').map((p) => p.id);
      expect(live.length).toBeGreaterThanOrEqual(2);
      expect(s.board).toHaveLength(5);

      // Pots + Rückgabe = Σ totalBet; identisch mit calculatePots.
      const potSum = sd.pots.reduce((sum, pot) => sum + pot.amount, 0);
      expect(potSum + (sd.uncalled?.amount ?? 0)).toBe(potTotal(s));
      expect({
        pots: sd.pots.map(({ amount, eligibleIds }) => ({ amount, eligibleIds })),
        uncalled: sd.uncalled,
      }).toEqual(calculatePots(s.players));
      if (sd.uncalled !== null) {
        expect(live).toContain(sd.uncalled.playerId);
        seen.uncalled++;
      }
      if (sd.pots.length > 1) seen.sidePots++;

      // Jeder Pot nur an Berechtigte, vollständig verteilt, gleichmäßig (±1 Chip).
      for (const pot of sd.pots) {
        expect(pot.amount).toBeGreaterThan(0);
        expect(pot.eligibleIds.length).toBeGreaterThan(0);
        for (const id of pot.eligibleIds) expect(live).toContain(id);
        for (const id of pot.winnerIds) expect(pot.eligibleIds).toContain(id);
        expect(pot.shares.map((x) => x.playerId)).toEqual(pot.winnerIds);
        expect(pot.shares.reduce((sum, x) => sum + x.amount, 0)).toBe(pot.amount);
        const amounts = pot.shares.map((x) => x.amount);
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
        // Ungerade Chips gehen an die vorderen Gewinner (Reihenfolge ab links vom Button).
        expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
        if (pot.winnerIds.length > 1) seen.splits++;
        if (pot.eligibleIds.length >= 2) {
          // Gewinner haben die beste Hand unter den Berechtigten.
          const values = pot.eligibleIds.map((id) => sd.reveals.find((r) => r.playerId === id)?.hand.value ?? -1);
          expect(pot.winningHand?.value).toBe(Math.max(...values));
        }
      }

      // Jeder Spieler im Showdown genau einmal; Gewinner umkämpfter Pots zeigen immer.
      expect([...sd.reveals.map((r) => r.playerId)].sort()).toEqual([...live].sort());
      for (const pot of sd.pots.filter((x) => x.eligibleIds.length >= 2)) {
        for (const id of pot.winnerIds) {
          expect(sd.reveals.find((r) => r.playerId === id)?.shownCards).not.toBeNull();
        }
      }
      if (sd.allHandsShown) for (const r of sd.reveals) expect(r.shownCards).not.toBeNull();

      // Endzustand bleibt JSON-serialisierbar.
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }
    // Die interessanten Fälle kommen tatsächlich vor.
    expect(seen.showdowns).toBeGreaterThan(HANDS / 4);
    expect(seen.sidePots).toBeGreaterThan(20);
    expect(seen.splits).toBeGreaterThan(5);
    expect(seen.uncalled).toBeGreaterThan(20);
  });
});
