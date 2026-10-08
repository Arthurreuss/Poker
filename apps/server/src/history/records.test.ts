// Hand-Historie ohne DB (WP-013): Abbildung Handzustand → gespeicherte Form und Replay über die Engine.
import { describe, expect, it } from 'vitest';
import {
  applyRoundAction,
  createSeededRng,
  legalActions,
  startNextHand,
  startRound,
  type Action,
  type HandState,
  type Rng,
} from '@poker/engine';
import { toHandRecord, toReplayEvent } from './records';
import { replayHandRecord } from './replay';

function randomAction(rng: Rng, hand: HandState): { playerId: string; action: Action } {
  const legal = legalActions(hand);
  if (legal === null) throw new Error('niemand am Zug');
  // Meist passiv (Check/Call), damit es auch Showdowns ohne All-in gibt (Mucks), sonst zufällig.
  const passive = legal.actions.find((x) => x.type === 'check' || x.type === 'call');
  const roll = rng.int(20);
  const others = legal.actions.filter((x) => x.type !== 'allIn');
  const a =
    roll === 0 ? legal.actions.at(-1) : roll < 12 && passive !== undefined ? passive : others[rng.int(others.length)];
  if (a === undefined) throw new Error('keine Aktion');
  const action: Action =
    a.type === 'bet' || a.type === 'raise'
      ? { type: a.type, amount: a.min + rng.int(a.max - a.min + 1) }
      : { type: a.type };
  return { playerId: legal.playerId, action };
}

/** Spielt eine komplette Runde mit Zufallsaktionen und liefert alle beendeten Hände. */
function playRound(seed: number, players: number): HandState[] {
  const rng = createSeededRng(seed);
  const started = startRound(
    {
      startingStack: 1000,
      blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
      turnTimeSeconds: 20,
      timeBankSeconds: 60,
    },
    Array.from({ length: players }, (_, i) => ({ id: String(100 + i), seat: (i * 2) % 9 })),
    rng,
  );
  if (!started.ok) throw new Error(started.error.message);
  let round = started.round;
  const hands: HandState[] = [];
  for (let n = 0; round.phase !== 'finished' && n < 5_000; n++) {
    if (round.phase === 'waiting') {
      const next = startNextHand(round, 0, rng);
      if (!next.ok) throw new Error(next.error.message);
      round = next.round;
    } else if (round.hand !== null) {
      const { playerId, action } = randomAction(rng, round.hand);
      const next = applyRoundAction(round, playerId, action);
      if (!next.ok) throw new Error(next.error.message);
      round = next.round;
    }
    if (round.hand?.phase === 'complete' && hands.at(-1) !== round.hand) hands.push(round.hand);
  }
  return hands;
}

describe('toHandRecord', () => {
  const hands = [1, 2, 3, 4].flatMap((seed) => playRound(seed, 2 + seed));

  it('bildet Spieler, Blinds, Deck, Board, Aktionen und Ergebnis ab', () => {
    expect(hands.length).toBeGreaterThan(20);
    for (const hand of hands) {
      const r = toHandRecord(7, 3, hand);
      expect(r).toMatchObject({
        roundId: 7,
        handNumber: 3,
        buttonSeat: hand.buttonSeat,
        bigBlindSeat: hand.bigBlindSeat,
      });
      expect(r.deck).toHaveLength(52);
      expect(r.board).toEqual(hand.board);
      expect(r.players.map((p) => [p.userId, p.seat, p.stack, p.holeCards])).toEqual(
        hand.players.map((p) => [Number(p.id), p.seat, p.startStack, p.holeCards]),
      );
      expect(r.actions.map((a) => a.seq)).toEqual(hand.log.map((_, i) => i + 1));
      expect(r.actions.every((a) => !a.isAutomatic)).toBe(true);
      expect(toHandRecord(7, 3, hand, [2]).actions.map((a) => a.isAutomatic)).toEqual(hand.log.map((_, i) => i === 1));
      expect(r.actions.slice(0, 2).map((a) => a.action)).toContain('big_blind');
      expect(r.actions.map(toReplayEvent)).toEqual(
        hand.log.map(({ street, playerId, type, amount, allIn }) => ({ street, playerId, type, amount, allIn })),
      );
      const payoutSum = (r.result?.payouts ?? []).reduce((s, p) => s + p.amount, 0);
      expect(payoutSum).toBe(hand.players.reduce((s, p) => s + p.totalBet, 0));
    }
  });

  it('markiert Hole Cards als gezeigt, gemuckt oder verdeckt (D-003)', () => {
    const seen = new Set<string>();
    for (const hand of hands) {
      const r = toHandRecord(1, 1, hand);
      const reveals = new Map((hand.showdown?.reveals ?? []).map((x) => [Number(x.playerId), x]));
      for (const p of r.result?.players ?? []) {
        const reveal = reveals.get(p.userId);
        const expected = reveal === undefined ? 'hidden' : reveal.shownCards === null ? 'mucked' : 'shown';
        expect(p.cards).toBe(expected);
        expect(p.hand !== null).toBe(expected === 'shown');
        if (p.folded) expect(p.cards).toBe('hidden');
        seen.add(p.cards);
      }
    }
    expect([...seen].sort()).toEqual(['hidden', 'mucked', 'shown']);
  });

  it('laufende Hand: ohne Board, Aktionen und Ergebnis, aber mit Deck und Hole Cards', () => {
    const started = startRound(
      {
        startingStack: 100,
        blindStructure: { type: 'fixed', level: { smallBlind: 1, bigBlind: 2 } },
        turnTimeSeconds: 20,
        timeBankSeconds: 60,
      },
      [
        { id: '1', seat: 0 },
        { id: '2', seat: 1 },
      ],
      createSeededRng(5),
    );
    if (!started.ok) throw new Error(started.error.message);
    const next = startNextHand(started.round, 0, createSeededRng(6));
    if (!next.ok || next.round.hand === null) throw new Error('keine Hand');
    const r = toHandRecord(1, 1, next.round.hand);
    expect(r.result).toBeNull();
    expect(r.actions).toEqual([]);
    expect(r.board).toEqual([]);
    expect(r.deck).toHaveLength(52);
    expect(r.players.every((p) => p.holeCards.length === 2)).toBe(true);
  });
});

describe('replayHandRecord', () => {
  it('spielt jede gespeicherte Hand mit demselben Deck nach und erhält denselben Datensatz', () => {
    for (const seed of [11, 12, 13]) {
      for (const hand of playRound(seed, 6)) {
        const stored = toHandRecord(1, 1, hand);
        const replayed = replayHandRecord(structuredClone(stored));
        if (!replayed.ok) throw new Error(replayed.message);
        expect(replayed.record).toEqual(stored);
        expect(replayed.state.payouts).toEqual(hand.payouts);
        expect(replayed.state.showdown).toEqual(hand.showdown);
      }
    }
  });

  it('erkennt manipulierte oder unvollständige Datensätze', () => {
    const hand = playRound(21, 3).find((h) => h.log.length > 3);
    if (hand === undefined) throw new Error('keine passende Hand');
    const stored = toHandRecord(1, 1, hand);
    expect(replayHandRecord({ ...stored, result: null }).ok).toBe(false);
    expect(replayHandRecord({ ...stored, actions: stored.actions.slice(0, -1) }).ok).toBe(false);
    const swapped = [...stored.deck];
    [swapped[0], swapped[51]] = [swapped[51] as never, swapped[0] as never];
    const r = replayHandRecord({ ...stored, deck: swapped });
    // Anderes Deck → andere Karten; das Protokoll kann trotzdem passen, das Ergebnis aber nicht mehr.
    expect(r.ok && JSON.stringify(r.record) === JSON.stringify(stored)).toBe(false);
  });
});
