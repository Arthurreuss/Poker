// Öffentliche API von @poker/engine (ohne I/O). Produktions-Zufall: `@poker/engine/crypto-rng`.

// Platzhalter aus WP-001 – wird noch von apps/server importiert.
export const ENGINE_NAME = '@poker/engine';

export function engineInfo(): { name: string } {
  return { name: ENGINE_NAME };
}

export {
  RANKS,
  SUITS,
  CardParseError,
  cardRank,
  cardSuit,
  formatCards,
  isCard,
  isRank,
  isSuit,
  makeCard,
  parseCard,
  parseCards,
  rankValue,
} from './cards';
export type { Card, Rank, Suit } from './cards';
export { createDeck, deal, shuffle, shuffledDeck } from './deck';
export type { DealResult } from './deck';
export { createSeededRng } from './rng';
export type { Rng } from './rng';

// --- Setzrunden (WP-006) ---
export { applyAction, legalActions, potTotal, startHand } from './betting';
export type { StartHandOptions, StartHandPlayer } from './betting';
export type {
  Action,
  HandError,
  HandErrorCode,
  HandEvent,
  HandPhase,
  HandPlayer,
  HandResult,
  HandState,
  LegalAction,
  LegalActions,
  Payout,
  PlayerStatus,
  Street,
} from './hand-state';
