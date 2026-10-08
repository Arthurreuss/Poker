/**
 * View-Model der Tischansicht (WP-016): darstellungsorientierter, bereits gefilterter Tischzustand.
 * Der Server schickt nur eigene Karten und den öffentlichen Zustand (D-003); das Mapping
 * Protokoll → `TableView` steht in `src/game/adapter.ts` (WP-018). Hier bewusst keine Server-/Protokolltypen.
 * Beschreibung: ARCHITECTURE.md, Abschnitt „Frontend: Tischansicht (Layout-Schicht)“.
 */
import type { Card } from '@poker/engine';

export type { Card };

/** Plätze pro Tisch (D-007). */
export const MAX_SEATS = 9;

/**
 * Hole Cards eines Sitzes aus Sicht des Betrachters:
 * - `none`: keine Karten (nicht in der Hand, gefoldet, ausgeschieden)
 * - `hidden`: hat Karten, sie sind aber verdeckt (fremder Spieler)
 * - `visible`: eigene Karten
 * - `shown`: im Showdown aufgedeckte Karten
 */
export type HoleCardsView =
  | { readonly kind: 'none' }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'visible'; readonly cards: readonly [Card, Card] }
  | { readonly kind: 'shown'; readonly cards: readonly [Card, Card] };

/**
 * - `active`: in der Hand, kann noch handeln
 * - `folded`: hat in dieser Hand gefoldet
 * - `allIn`: Stack ist 0, noch in der Hand
 * - `eliminated`: in dieser Runde ausgeschieden (D-012)
 * „Am Zug“ steht in `TableView.toActSeat`, „getrennt“ in `PlayerSeatView.connected`.
 */
export type SeatStatus = 'active' | 'folded' | 'allIn' | 'eliminated';

export interface PlayerSeatView {
  readonly kind: 'player';
  readonly name: string;
  /** Chips vor dem Spieler (ohne den Einsatz der laufenden Straße). */
  readonly stack: number;
  /** Einsatz in der laufenden Straße; 0 = kein Einsatz. */
  readonly bet: number;
  readonly status: SeatStatus;
  /** `false` = Verbindung getrennt (wird automatisch gecheckt/gefoldet, D-012). */
  readonly connected: boolean;
  readonly holeCards: HoleCardsView;
}

export interface EmptySeatView {
  readonly kind: 'empty';
}

export type SeatView = PlayerSeatView | EmptySeatView;

/** Ein Pot; in `TableView.pots` ist der erste der Main Pot, danach folgen Side Pots. */
export interface PotView {
  readonly amount: number;
}

export interface BlindsView {
  readonly small: number;
  readonly big: number;
  /** Blind-Level (1-basiert), falls die Blinds steigen (D-012). */
  readonly level?: number;
  readonly ante?: number;
}

export interface TableView {
  /** Genau `MAX_SEATS` Einträge, Index = Sitznummer 0–8. */
  readonly seats: readonly SeatView[];
  /** Eigener Sitz (wird immer unten mittig gezeigt); `null` = Zuschauer. */
  readonly heroSeat: number | null;
  readonly buttonSeat: number | null;
  readonly smallBlindSeat: number | null;
  readonly bigBlindSeat: number | null;
  /** Sitz, der am Zug ist; `null` = niemand (z. B. Showdown). */
  readonly toActSeat: number | null;
  /** Restzeit des Spielers am Zug als Anteil 0–1 (Timer läuft auf dem Server, D-013). */
  readonly timeRemaining?: number;
  /** Restliche Zeitbank (s) des Spielers am Zug, solange sie läuft (D-013); sonst nicht gesetzt. */
  readonly timeBankSeconds?: number;
  /** 0, 3, 4 oder 5 Karten. */
  readonly board: readonly Card[];
  /** Main Pot zuerst, danach Side Pots. Leer = noch nichts im Pot. */
  readonly pots: readonly PotView[];
  readonly blinds: BlindsView;
  /** Nummer der laufenden bzw. letzten Hand (WP-031: erkennt neues Austeilen für Animationen/Sounds). */
  readonly handNumber?: number;
  /** Sitze, die in der beendeten Hand einen Pot gewonnen haben (WP-031: Hervorhebung, Chips zum Gewinner). */
  readonly winnerSeats?: readonly number[];
  /** Die fünf Karten der Gewinnerhand (Main Pot), werden am Tisch hervorgehoben (WP-031). */
  readonly winningCards?: readonly Card[];
}
