/**
 * Zustandsmodell einer Hand (WP-006). Alles ist reines, JSON-serialisierbares Datenmodell:
 * keine Klassen, keine Funktionen, keine `undefined`-Felder (statt dessen `null`).
 * Beschreibung der Felder, Phasen und Aktionssemantik: ARCHITECTURE.md,
 * Abschnitt „Engine: Zustandsmodell einer Hand“.
 */
import type { Card } from './cards';
import type { HandCategory } from './hand-eval';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

/**
 * - `betting`: eine Setzrunde läuft, `toActId` ist gesetzt.
 * - `complete`: Hand beendet, `payouts` gesetzt – entweder haben alle bis auf einen gefoldet
 *   (`showdown === null`) oder der Showdown wurde direkt aufgelöst (`showdown` gesetzt, WP-007).
 */
export type HandPhase = 'betting' | 'complete';

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

/** Chips, die ein Spieler am Ende der Hand bekommt (inkl. eigener zurückgegebener Einsätze). */
export interface Payout {
  playerId: string;
  amount: number;
}

/** Ein Pot (Main Pot = erster, danach Side Pots). `eligibleIds` = gewinnberechtigt, nach Sitz sortiert. */
export interface Pot {
  amount: number;
  eligibleIds: string[];
}

/** Ergebnis von `calculatePots`: Pots aus `totalBet` und der nicht gecallte Überschuss. */
export interface PotBreakdown {
  pots: Pot[];
  /** Nicht gecallter Teil des höchsten Einsatzes – geht an den Einzahler zurück. */
  uncalled: Payout | null;
}

/** Bewertete Hand für die Anzeige (Kopie von `HandResult` aus der Handbewertung). */
export interface ShowdownHand {
  category: HandCategory;
  value: number;
  /** Die fünf besten Karten. */
  cards: Card[];
  /** Deutsche Beschreibung, z. B. „Full House, Könige über Zehnen“. */
  description: string;
}

/** Ein Pot nach dem Showdown. */
export interface PotAward extends Pot {
  /** Gewinner in Vergabereihenfolge (ab dem ersten Sitz links vom Button); mehrere = Split. */
  winnerIds: string[];
  /** Gewinnerhand; `null`, wenn nur ein Spieler berechtigt war (Pot ohne Handvergleich). */
  winningHand: ShowdownHand | null;
  /** Anteile je Gewinner; ungerade Chips gehen einzeln an die ersten Gewinner links vom Button. */
  shares: Payout[];
}

/** Ein Spieler im Showdown, in Zeigereihenfolge. */
export interface ShowdownReveal {
  playerId: string;
  /** Hole Cards, wenn der Spieler zeigen muss; `null` = darf mucken (verliert, muss nicht zeigen). */
  shownCards: Card[] | null;
  /** Bewertung mit Board – auch für Mucker, deshalb vom Server zu filtern (D-003). */
  hand: ShowdownHand;
}

/** Showdown-Ergebnis, gesetzt bei `phase === 'complete'` nach einem Showdown. */
export interface ShowdownSummary {
  /** Nicht gecallter Überschuss, der an den Einzahler zurückging (in `payouts` enthalten). */
  uncalled: Payout | null;
  /** Main Pot zuerst, dann Side Pots. */
  pots: PotAward[];
  /** Alle nicht gefoldeten Spieler in Zeigereihenfolge. */
  reveals: ShowdownReveal[];
  /** All-in-Situation: alle Hände werden aufgedeckt (TDA). */
  allHandsShown: boolean;
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
  /** Auszahlungen, sobald `phase === 'complete'` (nach Sitz sortiert, nur Beträge > 0); sonst `null`. */
  payouts: Payout[] | null;
  /** Showdown-Ergebnis (Pots, Gewinner, gezeigte Karten); `null` während der Hand und bei Fold-out. */
  showdown: ShowdownSummary | null;
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
