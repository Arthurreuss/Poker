import { describe, expect, it } from 'vitest';
import { legalActions } from './betting';
import { DEFAULT_BLIND_STRUCTURE, blindLevels, type BlindStructure } from './blind-structure';
import type { Action, LegalAction } from './hand-state';
import { placementPoints } from './points';
import { createSeededRng, type Rng } from './rng';
import {
  applyRoundAction,
  startNextHand,
  startRound,
  type RoundSeat,
  type RoundState,
  type RoundUpdate,
} from './round';

// Simulation (WP-008): komplette Runden mit seeded Zufalls-Bots. Prüft je Runde: genau ein Sieger,
// Chip-Erhaltung über alle Hände, Platzierungen 1..n korrekt (geteilt nur bei gleichem Stack),
// Punktesumme passend zur Formel, Big Blind rückt genau einen Spieler weiter, Heads-up Button = SB.

const MAX_HANDS = 3_000;

function ok(result: RoundUpdate): RoundState {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.round;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[rng.int(items.length)];
  if (item === undefined) throw new Error('leere Auswahl');
  return item;
}

/**
 * Bot: aggressiv = oft Bet/Raise (Minimum, Maximum oder dazwischen) und All-in, kurze Runden;
 * passiv = meist Check/Call/Fold mit kleinen Bets – die Runde endet erst durch steigende Blinds.
 */
function botAction(rng: Rng, actions: readonly LegalAction[], aggressive: boolean): Action {
  const roll = rng.int(20);
  const find = (type: LegalAction['type']) => actions.find((a) => a.type === type);
  const passive = find('check') ?? find('call');
  let choice: LegalAction | undefined;
  if (roll < 4) choice = find('fold');
  else if (roll < (aggressive ? 12 : 18)) choice = passive;
  else if (roll < (aggressive ? 18 : 20)) choice = find('bet') ?? find('raise');
  else choice = find('allIn');
  choice ??= passive ?? pick(rng, actions);
  if (choice.type === 'bet' || choice.type === 'raise') {
    const r = aggressive ? rng.int(3) : 0;
    const amount = r === 0 ? choice.min : r === 1 ? choice.max : choice.min + rng.int(choice.max - choice.min + 1);
    return { type: choice.type, amount };
  }
  return { type: choice.type };
}

function randomSeats(rng: Rng, count: number): RoundSeat[] {
  const free = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return Array.from({ length: count }, (_, i) => {
    const seat = free.splice(rng.int(free.length), 1)[0] as number;
    return { id: `P${String(i)}`, seat };
  });
}

const STRUCTURES: readonly BlindStructure[] = [
  DEFAULT_BLIND_STRUCTURE,
  {
    type: 'increasing',
    levelMinutes: 5,
    levels: [
      { smallBlind: 25, bigBlind: 50 },
      { smallBlind: 50, bigBlind: 100 },
      { smallBlind: 100, bigBlind: 200 },
    ],
  },
  { type: 'fixed', level: { smallBlind: 50, bigBlind: 100 } },
];

interface Stats {
  hands: number;
  sharedPlacements: number;
  deadSmallBlinds: number;
  deadButtons: number;
  headsUpTransitions: number;
  levelChanges: number;
}

function simulateRound(seed: number, playerCount: number, stats: Stats): RoundState {
  const rng = createSeededRng(seed);
  const players = randomSeats(rng, playerCount);
  const startingStack = pick(rng, [1_500, 3_000, 10_000]);
  const blindStructure = pick(rng, STRUCTURES);
  // Passive Bots nur mit der Standardstruktur (deren letzte Level liegen über allen Chips),
  // sonst endet die Runde nicht in vertretbarer Zeit.
  const aggressive = blindStructure !== DEFAULT_BLIND_STRUCTURE || rng.int(2) === 0;
  let round = ok(startRound({ startingStack, blindStructure, turnTimeSeconds: 20, timeBankSeconds: 60 }, players, rng));
  const total = playerCount * startingStack;
  let now = 1_000_000 + rng.int(1_000_000);
  let previous: RoundState | null = null;

  while (round.phase !== 'finished') {
    if (round.handNumber >= MAX_HANDS) throw new Error(`Seed ${String(seed)}: Runde endet nicht`);
    const alive = round.players.filter((p) => p.stack > 0);
    round = ok(startNextHand(round, now, rng));
    stats.hands++;
    const hand = round.hand;
    const pos = round.positions;
    if (hand === null || pos === null) throw new Error('Hand fehlt');

    // Blinds des Levels zu Handbeginn, nur noch spielende Spieler.
    const level = blindLevels(round.config.blindStructure)[round.levelIndex];
    expect(hand.bigBlind).toBe(level?.bigBlind);
    expect(hand.players.map((p) => p.id)).toEqual(alive.map((p) => p.id));

    // Big Blind rückt genau einen Spieler weiter, niemand zahlt ihn zweimal hintereinander.
    if (previous?.positions != null) {
      const prevBb = previous.positions.bigBlindSeat;
      const seatsLeft = alive.map((p) => p.seat);
      const expectedBb = seatsLeft.find((s) => s > prevBb) ?? seatsLeft[0];
      expect(pos.bigBlindSeat).toBe(expectedBb);
      expect(pos.bigBlindSeat).not.toBe(prevBb);
      if (alive.length === 2 && previous.hand !== null && previous.hand.players.length > 2) stats.headsUpTransitions++;
    }
    if (alive.length === 2) expect(hand.smallBlindSeat).toBe(hand.buttonSeat);
    if (previous !== null && round.levelIndex > previous.levelIndex) stats.levelChanges++;
    if (pos.smallBlindSeat === null) stats.deadSmallBlinds++;
    if (!alive.some((p) => p.seat === pos.buttonSeat)) stats.deadButtons++;

    while (round.phase === 'hand' && round.hand !== null) {
      const legal = legalActions(round.hand);
      if (legal === null) throw new Error('niemand am Zug');
      round = ok(applyRoundAction(round, legal.playerId, botAction(rng, legal.actions, aggressive)));
    }

    // Chip-Erhaltung über die ganze Runde.
    expect(round.players.reduce((sum, p) => sum + p.stack, 0)).toBe(total);
    for (const p of round.players) {
      expect(p.stack).toBeGreaterThanOrEqual(0);
      if (p.stack > 0) expect(p.placement).toBe(round.phase === 'finished' ? 1 : null);
      else expect(p.placement).not.toBeNull();
    }
    previous = round;
    now += 15_000 + rng.int(120_000);
  }
  return round;
}

function checkFinished(round: RoundState, stats: Stats): void {
  const n = round.players.length;
  const standings = round.standings ?? [];
  expect(standings).toHaveLength(n);

  // Genau ein Sieger mit allen Chips.
  const winners = round.players.filter((p) => p.stack > 0);
  expect(winners).toHaveLength(1);
  expect(winners[0]?.placement).toBe(1);
  expect(standings.filter((s) => s.placement === 1)).toHaveLength(1);

  // Platzierungen 1..n: Gruppe auf Platz p mit t Spielern → nächster Platz p + t.
  const placements = standings.map((s) => s.placement);
  let expected = 1;
  let expectedPoints = 0;
  for (let i = 0; i < n;) {
    const p = placements[i] as number;
    expect(p).toBe(expected);
    let j = i;
    while (j < n && placements[j] === p) j++;
    const tied = j - i;
    for (const s of standings.slice(i, j)) {
      expect(s.sharedPlacement).toBe(tied > 1);
      expect(s.points).toBe(placementPoints(p, n, tied));
    }
    if (tied > 1) stats.sharedPlacements++;
    expectedPoints += placementPoints(p, n, tied) * tied;
    expected += tied;
    i = j;
  }
  expect(expected).toBe(n + 1);

  // Punktesumme: ohne geteilte Plätze genau n(n−1)/2 + 1, mit geteilten höchstens das (abgerundet).
  const sum = standings.reduce((s, x) => s + x.points, 0);
  expect(sum).toBe(expectedPoints);
  if (standings.every((s) => !s.sharedPlacement)) expect(sum).toBe((n * (n - 1)) / 2 + 1);
  else expect(sum).toBeLessThanOrEqual((n * (n - 1)) / 2 + 1);

  // Platzierung folgt dem Ausscheiden: später ausgeschieden = besserer Platz.
  for (const a of round.players) {
    for (const b of round.players) {
      if (a.eliminatedInHand !== null && b.eliminatedInHand !== null && a.eliminatedInHand < b.eliminatedInHand) {
        expect(a.placement).toBeGreaterThan(b.placement as number);
      }
    }
  }
}

describe('Simulation kompletter Runden mit Zufalls-Bots', () => {
  it.each([
    ['2 Spieler', 2, 500],
    ['9 Spieler', 9, 200],
  ])('%s (%i Spieler, %i Seeds): immer genau ein Sieger, Chips und Punkte stimmen', (_label, count, seeds) => {
    const stats: Stats = {
      hands: 0,
      sharedPlacements: 0,
      deadSmallBlinds: 0,
      deadButtons: 0,
      headsUpTransitions: 0,
      levelChanges: 0,
    };
    for (let seed = 0; seed < seeds; seed++) checkFinished(simulateRound(seed * 7 + count, count, stats), stats);
    expect(stats.hands).toBeGreaterThan(seeds);
    expect(stats.levelChanges).toBeGreaterThan(0);
    if (count === 9) {
      // Die Szenarien kommen in den Simulationen tatsächlich vor.
      expect(stats.deadSmallBlinds).toBeGreaterThan(0);
      expect(stats.deadButtons).toBeGreaterThan(0);
      expect(stats.headsUpTransitions).toBeGreaterThan(0);
      expect(stats.sharedPlacements).toBeGreaterThan(0);
    }
  });

  it('3–8 Spieler, 60 Seeds', () => {
    const stats: Stats = {
      hands: 0,
      sharedPlacements: 0,
      deadSmallBlinds: 0,
      deadButtons: 0,
      headsUpTransitions: 0,
      levelChanges: 0,
    };
    for (let seed = 0; seed < 60; seed++) {
      const count = 3 + (seed % 6);
      checkFinished(simulateRound(10_000 + seed, count, stats), stats);
    }
    expect(stats.headsUpTransitions).toBeGreaterThan(0);
  });
});
