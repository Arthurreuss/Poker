/**
 * Button- und Blind-Wanderung über die Hände einer Runde (WP-008), Dead-Button-Regel nach TDA:
 * Der Big Blind rückt immer genau einen (noch spielenden) Spieler weiter. Small Blind ist der Sitz des
 * vorigen Big Blinds, der Button der Sitz des vorigen Small Blinds – auch wenn diese Sitze inzwischen
 * leer sind (dann kein Small Blind bzw. Button auf leerem Sitz). Heads-up: Button = Small Blind, und
 * niemand zahlt zweimal hintereinander den Big Blind.
 */
import { clockwiseFrom } from './seats';

/** Positionen einer Hand. */
export interface HandPositions {
  /** Sitz des Buttons; bei Dead Button ein leerer Sitz. */
  buttonSeat: number;
  /** Sitz, auf dem der Small Blind fällig ist (auch wenn er leer ist) – Grundlage für den nächsten Button. */
  smallBlindPositionSeat: number;
  /** Sitz, der den Small Blind tatsächlich zahlt; `null` = kein Small Blind (Sitz leer). */
  smallBlindSeat: number | null;
  bigBlindSeat: number;
}

const bySeat = (seats: readonly number[]) => [...seats].sort((a, b) => a - b).map((seat) => ({ seat }));

/** Erster Spieler links von `seat` (nächsthöherer besetzter Sitz, zyklisch); `seat` selbst zählt nicht. */
function nextSeat(sorted: readonly { seat: number }[], seat: number): number {
  const next = clockwiseFrom(sorted, seat).find((p) => p.seat !== seat);
  if (next === undefined) throw new Error('Interner Fehler: kein weiterer Spieler');
  return next.seat;
}

/** Positionen der ersten Hand: Button auf `buttonSeat` (besetzt), Blinds regulär links davon. */
export function firstHandPositions(seats: readonly number[], buttonSeat: number): HandPositions {
  const sorted = bySeat(seats);
  if (sorted.length < 2) throw new Error('Interner Fehler: mindestens zwei Spieler nötig');
  if (sorted.length === 2) {
    return {
      buttonSeat,
      smallBlindPositionSeat: buttonSeat,
      smallBlindSeat: buttonSeat,
      bigBlindSeat: nextSeat(sorted, buttonSeat),
    };
  }
  const smallBlindSeat = nextSeat(sorted, buttonSeat);
  return {
    buttonSeat,
    smallBlindPositionSeat: smallBlindSeat,
    smallBlindSeat,
    bigBlindSeat: nextSeat(sorted, smallBlindSeat),
  };
}

/**
 * Positionen der nächsten Hand aus den vorigen Positionen und den Sitzen der noch spielenden Spieler
 * (Stack > 0, mindestens zwei).
 */
export function nextHandPositions(previous: HandPositions, aliveSeats: readonly number[]): HandPositions {
  const sorted = bySeat(aliveSeats);
  if (sorted.length < 2) throw new Error('Interner Fehler: mindestens zwei Spieler nötig');
  // Big Blind: genau ein Spieler weiter (der nächste noch spielende links vom vorigen Big Blind).
  const bigBlindSeat = nextSeat(sorted, previous.bigBlindSeat);
  if (sorted.length === 2) {
    // Heads-up: der andere Spieler ist Button und Small Blind. Ist der vorige Big Blind noch dabei,
    // ist er das – er zahlt also nicht zweimal hintereinander den Big Blind.
    const other = sorted.find((p) => p.seat !== bigBlindSeat)?.seat;
    if (other === undefined) throw new Error('Interner Fehler: Heads-up ohne zweiten Spieler');
    return { buttonSeat: other, smallBlindPositionSeat: other, smallBlindSeat: other, bigBlindSeat };
  }
  // Mehr als zwei: Small Blind auf dem Sitz des vorigen Big Blinds (leer → kein Small Blind),
  // Button auf der vorigen Small-Blind-Position (leer → Dead Button).
  const smallBlindPositionSeat = previous.bigBlindSeat;
  const smallBlindSeat = sorted.some((p) => p.seat === smallBlindPositionSeat) ? smallBlindPositionSeat : null;
  return { buttonSeat: previous.smallBlindPositionSeat, smallBlindPositionSeat, smallBlindSeat, bigBlindSeat };
}
