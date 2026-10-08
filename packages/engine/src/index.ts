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

// --- Handbewertung (WP-005) ---
export {
  HAND_CATEGORIES,
  HAND_CATEGORY_NAMES,
  HandEvaluationError,
  compareHands,
  determineWinners,
  evaluateHand,
  handValue,
} from './hand-eval';
export type { HandCategory, HandResult, ShowdownEntry, ShowdownWinners } from './hand-eval';

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
  ActionResult,
  HandState,
  LegalAction,
  LegalActions,
  Payout,
  PlayerStatus,
  Street,
} from './hand-state';

// --- Pots und Showdown (WP-007) ---
export { calculatePots } from './showdown';
export type { PotContributor } from './showdown';
export type { Pot, PotAward, PotBreakdown, ShowdownHand, ShowdownReveal, ShowdownSummary } from './hand-state';

// --- Runde (WP-008) ---
export {
  DEFAULT_TIME_BANK_SECONDS,
  DEFAULT_TURN_TIME_SECONDS,
  applyRoundAction,
  roundBlindLevel,
  startNextHand,
  startRound,
  validateRoundConfig,
} from './round';
export type {
  RoundBlindLevel,
  RoundConfig,
  RoundError,
  RoundErrorCode,
  RoundPhase,
  RoundPlayer,
  RoundSeat,
  RoundStanding,
  RoundState,
  RoundUpdate,
  StartRoundOptions,
} from './round';
export {
  DEFAULT_BLIND_LEVELS,
  DEFAULT_BLIND_STRUCTURE,
  DEFAULT_LEVEL_MINUTES,
  blindLevelIndexAt,
  blindLevels,
} from './blind-structure';
export type { BlindLevel, BlindStructure } from './blind-structure';
export { firstHandPositions, nextHandPositions } from './button';
export type { HandPositions } from './button';
export { WINNER_BONUS_POINTS, placementPoints } from './points';
