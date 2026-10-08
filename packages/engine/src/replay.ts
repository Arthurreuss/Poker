/**
 * Replay gespeicherter Hände (WP-013): Deck-Rekonstruktion und erneutes Abspielen eines Hand-Protokolls.
 * Rein und deterministisch – kein Rng nötig, das Deck wird vorgegeben. Nutzung: Hand-Historie des Servers
 * (ARCHITECTURE.md, „Datenmodell“ → „Persistenz“).
 */
import { applyAction, startHand, type StartHandPlayer } from './betting';
import type { Card } from './cards';
import type { Action, ActionResult, HandError, HandEvent, HandState } from './hand-state';
import { clockwiseFrom } from './seats';

/** Karten pro Straße nach dem Burn (Flop, Turn, River). */
const STREET_CARDS = [3, 1, 1] as const;

/**
 * Reihenfolge des Decks zu Handbeginn (Index 0 = oben), rekonstruiert aus einem beliebigen Zustand der Hand:
 * Hole Cards in Austeilreihenfolge (zwei Durchgänge ab links vom Button), dann je Straße Burn-Karte und
 * Board-Karten, dann das restliche Deck. `startHand({ deck: initialDeck(hand), … })` teilt dieselben Karten aus.
 */
export function initialDeck(hand: HandState): Card[] {
  const order = clockwiseFrom(hand.players, hand.buttonSeat);
  const cards: Card[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const p of order) {
      const card = p.holeCards[pass];
      if (card === undefined) throw new Error(`Spieler ${p.id} hat keine zwei Hole Cards`);
      cards.push(card);
    }
  }
  let boardIndex = 0;
  for (const [street, burn] of hand.burned.entries()) {
    cards.push(burn);
    for (let i = 0; i < (STREET_CARDS[street] ?? 0); i++) {
      const card = hand.board[boardIndex++];
      if (card === undefined) throw new Error('Board passt nicht zu den verbrannten Karten');
      cards.push(card);
    }
  }
  if (boardIndex !== hand.board.length) throw new Error('Board passt nicht zu den verbrannten Karten');
  cards.push(...hand.deck);
  return cards;
}

/** Ausgangslage einer Hand für das Replay. */
export interface ReplaySetup {
  /** Spieler mit Stack zu Handbeginn (vor den Blinds). */
  players: readonly StartHandPlayer[];
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  /** `smallBlindSeat: null` = Dead Small Blind (WP-008). */
  blinds: { smallBlindSeat: number | null; bigBlindSeat: number };
  /** Deck zu Handbeginn, Index 0 = oben (siehe {@link initialDeck}). */
  deck: readonly Card[];
}

/** Ein Protokolleintrag, wie er gespeichert wird (Teilmenge von `HandEvent`, ohne `to`). */
export type ReplayEvent = Pick<HandEvent, 'street' | 'playerId' | 'type' | 'amount' | 'allIn'>;

/**
 * Spielt eine Hand aus Ausgangslage und Protokoll (inkl. Blinds) neu. Jede Aktion wird über die Engine
 * angewendet und der entstandene Protokolleintrag mit dem gespeicherten verglichen; Abweichungen ergeben einen
 * Fehler. Ergebnis ist der Endzustand (bei vollständigem Protokoll `phase === 'complete'`).
 *
 * Abbildung: `bet`/`raise` → Aktion mit `amount` = Straßeneinsatz danach; mit `allIn` → Aktion `allIn`
 * (deckt auch unvollständige All-in-Raises ab). `call` deckt All-in-Calls ab. Antes gibt es nicht (D-016).
 */
export function replayHand(setup: ReplaySetup, events: readonly ReplayEvent[]): ActionResult {
  const started = startHand({
    players: setup.players,
    buttonSeat: setup.buttonSeat,
    smallBlind: setup.smallBlind,
    bigBlind: setup.bigBlind,
    blinds: setup.blinds,
    deck: setup.deck,
  });
  if (!started.ok) return started;
  let state = started.state;

  const posted = state.log.length;
  for (const [i, logged] of state.log.entries()) {
    const mismatch = compareEvent(logged, events[i], i);
    if (mismatch !== null) return { ok: false, error: { code: 'INVALID_SETUP', message: mismatch } };
  }
  for (let i = posted; i < events.length; i++) {
    const event = events[i] as ReplayEvent;
    const player = state.players.find((p) => p.id === event.playerId);
    if (player === undefined) return mismatchError(`Aktion ${String(i + 1)}: Spieler ${event.playerId} fehlt`);
    const action = toAction(event, player.streetBet);
    if (action === null) return mismatchError(`Aktion ${String(i + 1)}: ${event.type} lässt sich nicht abspielen`);
    const result = applyAction(state, event.playerId, action);
    if (!result.ok) {
      return mismatchError(`Aktion ${String(i + 1)} (${event.type}) abgelehnt: ${result.error.message}`);
    }
    state = result.state;
    const mismatch = compareEvent(state.log[i], event, i);
    if (mismatch !== null) return mismatchError(mismatch);
  }
  if (state.log.length !== events.length) {
    return mismatchError(
      `Protokoll hat ${String(events.length)} Einträge, die Engine erzeugt ${String(state.log.length)}`,
    );
  }
  return { ok: true, state };
}

function toAction(event: ReplayEvent, streetBet: number): Action | null {
  switch (event.type) {
    case 'fold':
    case 'check':
    case 'call':
      return { type: event.type };
    case 'bet':
    case 'raise':
      return event.allIn ? { type: 'allIn' } : { type: event.type, amount: streetBet + event.amount };
    default:
      return null; // Blinds kommen aus startHand, Antes gibt es nicht (D-016)
  }
}

function compareEvent(actual: HandEvent | undefined, expected: ReplayEvent | undefined, i: number): string | null {
  if (actual === undefined || expected === undefined) {
    return `Aktion ${String(i + 1)}: Protokoll und Engine weichen in der Länge ab`;
  }
  const fields = ['street', 'playerId', 'type', 'amount', 'allIn'] as const;
  for (const f of fields) {
    if (actual[f] !== expected[f]) {
      return `Aktion ${String(i + 1)}: ${f} ist ${JSON.stringify(actual[f])}, gespeichert ${JSON.stringify(expected[f])}`;
    }
  }
  return null;
}

function mismatchError(message: string): { ok: false; error: HandError } {
  return { ok: false, error: { code: 'INVALID_ACTION', message } };
}
