/**
 * Zustandsmodell einer Hand (WP-006). Alles ist reines, JSON-serialisierbares Datenmodell:
 * keine Klassen, keine Funktionen, keine `undefined`-Felder (statt dessen `null`).
 * Beschreibung der Felder, Phasen und Aktionssemantik: ARCHITECTURE.md,
 * Abschnitt „Engine: Zustandsmodell einer Hand“.
 */
import type { Card } from './cards';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

/**
 * - `betting`: eine Setzrunde läuft, `toActId` ist gesetzt.
 * - `showdown`: River-Setzrunde beendet (oder Board durchgelaufen), mindestens zwei Spieler übrig;
 *   Pot-Aufteilung übernimmt WP-007.
 * - `complete`: Hand beendet, `payouts` gesetzt (bisher nur „alle bis auf einen gefoldet“).
 */
export type HandPhase = 'betting' | 'showdown' | 'complete';

/** `allIn` = Stack ist 0, der Spieler ist noch in der Hand, handelt aber nicht mehr. */
export type PlayerStatus = 'active' | 'folded' | 'allIn';

export interface HandPlayer {
  id: string;
  seat: number;
  /** Stack vor der Hand (vor Antes und Blinds). */
  startStack: number;
  /** Chips, die der Spieler noch vor sich hat. */
  stack: number;
  holeCards: Card[];
  status: PlayerStatus;
  /** Einsatz in der aktuellen Straße (Blinds zählen preflop mit, Antes nicht). */
  streetBet: number;
  /** Gesamteinsatz in dieser Hand inkl. Ante und Blinds – Grundlage für Side Pots (WP-007). */
  totalBet: number;
  /** Hat in der aktuellen Straße schon freiwillig gehandelt (Blinds/Antes zählen nicht). */
  hasActed: boolean;
}

/** Eintrag im Hand-Protokoll. `amount` = in diesem Schritt eingezahlte Chips, `to` = `streetBet` danach. */
export interface HandEvent {
  street: Street;
  playerId: string;
  type: 'ante' | 'smallBlind' | 'bigBlind' | 'fold' | 'check' | 'call' | 'bet' | 'raise';
  amount: number;
  to: number;
  /** Spieler ist durch diesen Schritt All-in. */
  allIn: boolean;
}

export interface Payout {
  playerId: string;
  amount: number;
}

export interface HandState {
  smallBlind: number;
  bigBlind: number;
  ante: number;
  buttonSeat: number;
  /** `null` = kein Small Blind in dieser Hand (Dead Small Blind, WP-008). */
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  /** Nach Sitz aufsteigend sortiert; „links“ = nächsthöherer Sitz (zyklisch). */
  players: HandPlayer[];
  /** Restliches Deck, Index 0 = oberste Karte. */
  deck: Card[];
  burned: Card[];
  board: Card[];
  street: Street;
  phase: HandPhase;
  /** Wer am Zug ist; `null`, wenn `phase !== 'betting'`. */
  toActId: string | null;
  /** Höchster zu bringender Einsatz dieser Straße (preflop mindestens der Big Blind). */
  currentBet: number;
  /** Größe des letzten vollständigen Bets/Raises dieser Straße (mindestens Big Blind). */
  minRaise: number;
  log: HandEvent[];
  /** Auszahlungen, sobald `phase === 'complete'`; sonst `null`. */
  payouts: Payout[] | null;
}

/**
 * Aktion eines Spielers. `bet`/`raise`: `amount` ist der **Gesamteinsatz dieser Straße danach**
 * („raise to“), nicht der Zuwachs.
 */
export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allIn' };

/**
 * Eine erlaubte Aktion. `call.amount` und `allIn.amount` = einzuzahlende Chips;
 * `bet`/`raise`: `min`/`max` als Gesamteinsatz der Straße („to“); `allIn.to` = Straßeneinsatz danach.
 */
export type LegalAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call'; amount: number }
  | { type: 'bet'; min: number; max: number }
  | { type: 'raise'; min: number; max: number }
  | { type: 'allIn'; amount: number; to: number };

export interface LegalActions {
  playerId: string;
  /** Chips, die zum Mitgehen fehlen (gekappt auf den Stack). */
  toCall: number;
  actions: LegalAction[];
}

export type HandErrorCode =
  | 'INVALID_SETUP'
  | 'HAND_NOT_IN_BETTING'
  | 'UNKNOWN_PLAYER'
  | 'NOT_YOUR_TURN'
  | 'INVALID_ACTION'
  | 'ILLEGAL_ACTION'
  | 'AMOUNT_TOO_SMALL'
  | 'AMOUNT_TOO_LARGE';

export interface HandError {
  code: HandErrorCode;
  message: string;
}

export type ActionResult = { ok: true; state: HandState } | { ok: false; error: HandError };
