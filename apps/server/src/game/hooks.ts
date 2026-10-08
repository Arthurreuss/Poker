// Erweiterungspunkte des Spielablaufs (WP-011) – WP-013 speichert hierüber Hände und Ergebnisse.
// Hooks bekommen den vollständigen, ungefilterten Serverzustand (inkl. aller Hole Cards und Deck, D-003:
// niemals an Clients weitergeben). Sie laufen pro Tisch strikt nacheinander in Ereignisreihenfolge, werden
// aber vom Spielablauf nicht abgewartet; Fehler werden geloggt und stören den Tisch nicht.
import type { HandState, RoundStanding, RoundState } from '@poker/engine';

export interface HandStartedEvent {
  tableId: number;
  roundId: number;
  handNumber: number;
  /** Zustand direkt nach dem Austeilen und den Blinds. */
  hand: HandState;
  /** Server-Uhr beim Handstart (ms). */
  atMs: number;
}

export interface HandCompleteEvent {
  tableId: number;
  roundId: number;
  handNumber: number;
  /** Abgeschlossene Hand (`phase === 'complete'`, mit `log`, `payouts`, `showdown`). */
  hand: HandState;
  /** Runde nach der Abrechnung dieser Hand (Stacks, Platzierungen). */
  round: RoundState;
  /** Positionen (`seq` ab 1 im Hand-Protokoll) der Aktionen, die der Server automatisch ausgeführt hat (D-013). */
  autoActionSeqs: number[];
  atMs: number;
}

export interface RoundCompleteEvent {
  tableId: number;
  roundId: number;
  standings: (RoundStanding & { userId: number })[];
  round: RoundState;
  atMs: number;
}

export interface GameHooks {
  onHandStarted?(event: HandStartedEvent): void | Promise<void>;
  onHandComplete?(event: HandCompleteEvent): void | Promise<void>;
  onRoundComplete?(event: RoundCompleteEvent): void | Promise<void>;
}
