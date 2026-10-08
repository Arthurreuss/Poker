import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, startHand } from './betting';
import { shuffledDeck } from './deck';
import type { Action, HandState, LegalAction } from './hand-state';
import { initialDeck, replayHand, type ReplaySetup } from './replay';
import { createSeededRng, type Rng } from './rng';

function setupOf(hand: HandState): ReplaySetup {
  return {
    players: hand.players.map((p) => ({ id: p.id, seat: p.seat, stack: p.startStack })),
    buttonSeat: hand.buttonSeat,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    blinds: { smallBlindSeat: hand.smallBlindSeat, bigBlindSeat: hand.bigBlindSeat },
    deck: initialDeck(hand),
  };
}

function randomAction(rng: Rng, actions: readonly LegalAction[]): Action {
  const a = actions[rng.int(actions.length)] as LegalAction;
  if (a.type === 'bet' || a.type === 'raise') return { type: a.type, amount: a.min + rng.int(a.max - a.min + 1) };
  return { type: a.type };
}

/** Spielt eine Hand mit Zufallsaktionen und unterschiedlichen Stacks (viele All-ins, Side Pots) zu Ende. */
function playRandomHand(seed: number): HandState {
  const rng = createSeededRng(seed);
  const count = 2 + rng.int(8);
  const seats = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const chosen: number[] = [];
  while (chosen.length < count) {
    const seat = seats.splice(rng.int(seats.length), 1)[0] as number;
    chosen.push(seat);
  }
  const started = startHand({
    players: chosen.map((seat, i) => ({ id: `P${String(i)}`, seat, stack: 5 + rng.int(300) })),
    buttonSeat: chosen[0] as number,
    smallBlind: 5,
    bigBlind: 10,
    // Eigenes Rng fürs Mischen, damit das Deck allein vom Seed abhängt.
    rng: createSeededRng(seed),
  });
  if (!started.ok) throw new Error(started.error.message);
  let state = started.state;
  while (state.phase === 'betting') {
    const legal = legalActions(state);
    if (legal === null) throw new Error('niemand am Zug');
    const result = applyAction(state, legal.playerId, randomAction(rng, legal.actions));
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}

describe('initialDeck', () => {
  it('ergibt direkt nach dem Austeilen das gemischte Deck', () => {
    for (const seed of [1, 2, 3, 42]) {
      const started = startHand({
        players: [
          { id: 'A', seat: 0, stack: 100 },
          { id: 'B', seat: 3, stack: 100 },
          { id: 'C', seat: 7, stack: 100 },
        ],
        buttonSeat: 3,
        smallBlind: 1,
        bigBlind: 2,
        rng: createSeededRng(seed),
      });
      if (!started.ok) throw new Error(started.error.message);
      expect(initialDeck(started.state)).toEqual(shuffledDeck(createSeededRng(seed)));
    }
  });

  it('ist für eine beendete Hand dasselbe Deck wie zu Handbeginn (52 Karten)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const hand = playRandomHand(seed);
      const deck = initialDeck(hand);
      expect(deck).toHaveLength(52);
      expect(new Set(deck).size).toBe(52);
      expect(deck).toEqual(shuffledDeck(createSeededRng(seed)));
    }
  });
});

describe('replayHand', () => {
  it('spielt 300 Zufallshände aus Ausgangslage und Protokoll exakt nach', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const hand = playRandomHand(seed);
      const replayed = replayHand(setupOf(hand), hand.log);
      if (!replayed.ok) throw new Error(`Seed ${String(seed)}: ${replayed.error.message}`);
      expect(replayed.state).toEqual(hand);
    }
  });

  it('meldet Abweichungen statt still ein anderes Ergebnis zu liefern', () => {
    const hand = playRandomHand(7);
    const tampered = hand.log.map((e) => ({ ...e }));
    const last = tampered[tampered.length - 1];
    if (last === undefined) throw new Error('leeres Protokoll');
    tampered[tampered.length - 1] = { ...last, playerId: 'X' };
    expect(replayHand(setupOf(hand), tampered).ok).toBe(false);

    const wrongBlind = hand.log.map((e, i) => (i === 0 ? { ...e, amount: e.amount + 1 } : e));
    const r = replayHand(setupOf(hand), wrongBlind);
    expect(r.ok ? null : r.error.code).toBe('INVALID_SETUP');

    expect(replayHand(setupOf(hand), [...hand.log, { ...last }]).ok).toBe(false);
  });

  it('lehnt Antes ab (D-016)', () => {
    const hand = playRandomHand(3);
    const events = [...hand.log];
    events.splice(2, 0, { street: 'preflop', playerId: 'P0', type: 'ante', amount: 1, to: 0, allIn: false });
    expect(replayHand(setupOf(hand), events).ok).toBe(false);
  });
});
