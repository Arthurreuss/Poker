// Admin zieht neue Hole Cards (WP-035, D-032): Karten kommen nur aus dem Restdeck, nichts geht verloren oder doppelt.
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, redrawHoleCards, startHand } from './betting';
import type { HandState } from './hand-state';
import { initialDeck, replayHand } from './replay';
import { createSeededRng } from './rng';
import { DEFAULT_BLIND_STRUCTURE } from './blind-structure';
import {
  DEFAULT_TIME_BANK_SECONDS,
  DEFAULT_TURN_TIME_SECONDS,
  redrawRoundHoleCards,
  startNextHand,
  startRound,
} from './round';

function newHand(seed = 1): HandState {
  const started = startHand({
    players: [
      { id: 'A', seat: 0, stack: 1000 },
      { id: 'B', seat: 1, stack: 1000 },
      { id: 'C', seat: 2, stack: 1000 },
    ],
    buttonSeat: 0,
    smallBlind: 5,
    bigBlind: 10,
    rng: createSeededRng(seed),
  });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

function allCards(hand: HandState): string[] {
  return [...hand.players.flatMap((p) => p.holeCards), ...hand.board, ...hand.burned, ...hand.deck];
}

function redraw(hand: HandState, playerId: string, seed: number): HandState {
  const result = redrawHoleCards(hand, playerId, createSeededRng(seed));
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

describe('redrawHoleCards', () => {
  it('tauscht die Karten gegen zwei aus dem Restdeck; die alten kommen ins Deck', () => {
    const hand = newHand();
    const before = JSON.stringify(hand);
    const next = redraw(hand, 'A', 7);
    const oldCards = hand.players[0]?.holeCards ?? [];
    const fresh = next.players[0]?.holeCards ?? [];

    expect(JSON.stringify(hand)).toBe(before); // Eingabe unverändert
    expect(fresh).toHaveLength(2);
    for (const card of fresh) expect(hand.deck).toContain(card);
    for (const card of oldCards) expect(next.deck).toContain(card);
    expect(next.deck).toHaveLength(hand.deck.length);
    expect(next.players.slice(1)).toEqual(hand.players.slice(1));
    expect(next.board).toEqual(hand.board);
    expect(next.log).toEqual(hand.log);
  });

  it('lässt sich beliebig oft wiederholen, ohne dass Karten fehlen oder doppelt sind', () => {
    let hand = newHand(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      hand = redraw(hand, 'B', i);
      for (const card of hand.players[1]?.holeCards ?? []) seen.add(card);
      const cards = allCards(hand);
      expect(cards).toHaveLength(52);
      expect(new Set(cards).size).toBe(52);
    }
    // Mitspieler-Karten kommen nie in Frage.
    for (const p of hand.players.filter((x) => x.id !== 'B')) {
      for (const card of p.holeCards) expect(seen.has(card)).toBe(false);
    }
  });

  it('geht auch nach dem Flop; das Board bleibt', () => {
    let hand = newHand(5);
    while (hand.street === 'preflop') {
      const legal = legalActions(hand);
      if (legal === null) throw new Error('niemand am Zug');
      const call = legal.actions.find((a) => a.type === 'call') ?? { type: 'check' as const };
      const r = applyAction(hand, legal.playerId, { type: call.type });
      if (!r.ok) throw new Error(r.error.message);
      hand = r.state;
    }
    const next = redraw(hand, 'C', 11);
    expect(next.board).toEqual(hand.board);
    for (const card of next.players[2]?.holeCards ?? []) expect(hand.board).not.toContain(card);
    expect(new Set(allCards(next)).size).toBe(52);
  });

  it('bleibt per Replay nachspielbar (gespeichert wird `initialDeck` der fertigen Hand)', () => {
    let hand = redraw(newHand(9), 'A', 1);
    hand = redraw(hand, 'A', 2);
    const rng = createSeededRng(4);
    while (hand.phase === 'betting') {
      const legal = legalActions(hand);
      if (legal === null) throw new Error('niemand am Zug');
      const a = legal.actions[rng.int(legal.actions.length)];
      if (a === undefined) throw new Error('keine Aktion');
      const action = a.type === 'bet' || a.type === 'raise' ? { type: a.type, amount: a.min } : { type: a.type };
      const r = applyAction(hand, legal.playerId, action);
      if (!r.ok) throw new Error(r.error.message);
      hand = r.state;
    }
    const replayed = replayHand(
      {
        players: hand.players.map((p) => ({ id: p.id, seat: p.seat, stack: p.startStack })),
        buttonSeat: hand.buttonSeat,
        smallBlind: hand.smallBlind,
        bigBlind: hand.bigBlind,
        blinds: { smallBlindSeat: hand.smallBlindSeat, bigBlindSeat: hand.bigBlindSeat },
        deck: initialDeck(hand),
      },
      hand.log,
    );
    if (!replayed.ok) throw new Error(replayed.error.message);
    expect(replayed.state).toEqual(hand);
  });

  it('lehnt gefoldete, unbekannte Spieler und beendete Hände ab', () => {
    const hand = newHand();
    const legal = legalActions(hand);
    if (legal === null) throw new Error('niemand am Zug');
    const folded = applyAction(hand, legal.playerId, { type: 'fold' });
    if (!folded.ok) throw new Error(folded.error.message);
    const rng = createSeededRng(1);

    const r1 = redrawHoleCards(folded.state, legal.playerId, rng);
    expect(r1.ok ? null : r1.error.code).toBe('ILLEGAL_ACTION');
    const r2 = redrawHoleCards(hand, 'X', rng);
    expect(r2.ok ? null : r2.error.code).toBe('UNKNOWN_PLAYER');
    const r3 = redrawHoleCards({ ...hand, phase: 'complete' }, 'A', rng);
    expect(r3.ok ? null : r3.error.code).toBe('HAND_NOT_IN_BETTING');
  });
});

describe('redrawRoundHoleCards', () => {
  it('ersetzt nur die Hand der Runde; ohne laufende Hand Fehler', () => {
    const started = startRound(
      {
        startingStack: 1000,
        blindStructure: DEFAULT_BLIND_STRUCTURE,
        turnTimeSeconds: DEFAULT_TURN_TIME_SECONDS,
        timeBankSeconds: DEFAULT_TIME_BANK_SECONDS,
      },
      [
        { id: 'A', seat: 0 },
        { id: 'B', seat: 1 },
      ],
      createSeededRng(1),
    );
    if (!started.ok) throw new Error(started.error.message);
    const waiting = redrawRoundHoleCards(started.round, 'A', createSeededRng(1));
    expect(waiting.ok ? null : waiting.error.code).toBe('NO_HAND_IN_PROGRESS');

    const dealt = startNextHand(started.round, 0, createSeededRng(2));
    if (!dealt.ok) throw new Error(dealt.error.message);
    const update = redrawRoundHoleCards(dealt.round, 'A', createSeededRng(3));
    if (!update.ok) throw new Error(update.error.message);
    expect(update.round.hand?.players[0]?.holeCards).not.toEqual(dealt.round.hand?.players[0]?.holeCards);
    expect({ ...update.round, hand: null }).toEqual({ ...dealt.round, hand: null });
  });
});
