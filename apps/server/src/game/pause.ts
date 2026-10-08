// Pause nach einer Hand (WP-031): Grundpause für die Showdown-Anzeige plus Zeit für einen All-in-Runout,
// den der Client Straße für Straße aufdeckt (Flop, Turn, River nacheinander, siehe ARCHITECTURE.md
// „Frontend: Animationen und Sounds“). Rein, damit sie ohne Uhr testbar ist.
import type { HandState, Street } from '@poker/engine';

const STREET_INDEX: Record<Street, number> = { preflop: 0, flop: 1, turn: 2, river: 3 };

/** Straßen-Index nach Anzahl Board-Karten (0 → Preflop, 3 → Flop, 4 → Turn, 5 → River). */
function boardStreetIndex(boardLength: number): number {
  if (boardLength >= 5) return 3;
  if (boardLength === 4) return 2;
  if (boardLength === 3) return 1;
  return 0;
}

/**
 * Anzahl Straßen, die nach der letzten Aktion ohne Setzrunde ausgeteilt wurden (All-in-Runout).
 * Nur nach einem Showdown; eine durch Fold beendete Hand hat keinen Runout.
 */
export function runoutStreets(hand: Pick<HandState, 'board' | 'log' | 'showdown'>): number {
  if (hand.showdown === null) return 0;
  const last = hand.log.at(-1);
  const lastStreet = last === undefined ? 0 : STREET_INDEX[last.street];
  return Math.max(0, boardStreetIndex(hand.board.length) - lastStreet);
}

/** Pause bis zur nächsten Hand: Grundpause + je Runout-Straße `perRunoutStreetMs`. */
export function handPauseFor(
  hand: Pick<HandState, 'board' | 'log' | 'showdown'>,
  baseMs: number,
  perRunoutStreetMs: number,
): number {
  return baseMs + runoutStreets(hand) * perRunoutStreetMs;
}
