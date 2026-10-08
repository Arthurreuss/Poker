/**
 * Reine Layout-Funktionen der Tischansicht (Hochformat, WP-016): welche Sitznummer an welcher
 * Position um den ovalen Tisch erscheint. Keine DOM-Abhängigkeit – direkt testbar.
 */
import { MAX_SEATS, type PlayerSeatView, type TableView } from './types';

/** Feste Positionen um den Tisch, im Uhrzeigersinn ab „unten mittig“. */
export type SlotId = 'B' | 'BL' | 'L1' | 'L2' | 'TL' | 'T' | 'TR' | 'R2' | 'R1' | 'BR';

export interface Slot {
  readonly id: SlotId;
  /** Mittelpunkt der Plakette in % der Tischfläche (0–100). */
  readonly x: number;
  readonly y: number;
  /** Ankerpunkt der Einsatz-Chips in % der Tischfläche. */
  readonly betX: number;
  readonly betY: number;
  /** Wie die Einsatz-Chips am Anker ausgerichtet sind (zur Tischmitte hin). */
  readonly betAlign: 'start' | 'center' | 'end';
  /** Seite der Plakette, an der Dealer-Button/Blind-Marker sitzen (zur Tischmitte hin). */
  readonly markerSide: 'left' | 'right';
}

/**
 * Positionen im Hochformat. Seitliche Sitze liegen in zwei Reihen (L2/R2 oben, L1/R1 unten),
 * dazwischen bleibt ein Band für Pots und Board. Werte sind per Screenshot-Test (e2e-visual)
 * abgestimmt.
 */
export const PORTRAIT_SLOTS: Readonly<Record<SlotId, Slot>> = {
  B: { id: 'B', x: 50, y: 91, betX: 50, betY: 63.5, betAlign: 'center', markerSide: 'right' },
  BL: { id: 'BL', x: 15, y: 76, betX: 30, betY: 68.5, betAlign: 'start', markerSide: 'right' },
  L1: { id: 'L1', x: 15, y: 60.5, betX: 30, betY: 63.5, betAlign: 'start', markerSide: 'right' },
  L2: { id: 'L2', x: 15, y: 27, betX: 30, betY: 29.5, betAlign: 'start', markerSide: 'right' },
  TL: { id: 'TL', x: 30, y: 10, betX: 36, betY: 19, betAlign: 'center', markerSide: 'right' },
  T: { id: 'T', x: 50, y: 10, betX: 50, betY: 19.5, betAlign: 'center', markerSide: 'right' },
  TR: { id: 'TR', x: 70, y: 10, betX: 64, betY: 19, betAlign: 'center', markerSide: 'left' },
  R2: { id: 'R2', x: 85, y: 27, betX: 70, betY: 29.5, betAlign: 'end', markerSide: 'left' },
  R1: { id: 'R1', x: 85, y: 60.5, betX: 70, betY: 63.5, betAlign: 'end', markerSide: 'left' },
  BR: { id: 'BR', x: 85, y: 76, betX: 70, betY: 68.5, betAlign: 'end', markerSide: 'left' },
};

/**
 * Welche Positionen bei n belegten Plätzen genutzt werden – im Uhrzeigersinn ab unten mittig,
 * so dass die Spieler gleichmäßig um den Tisch verteilt sind.
 */
export const SLOTS_BY_COUNT: Readonly<Record<number, readonly SlotId[]>> = {
  1: ['B'],
  2: ['B', 'T'],
  3: ['B', 'TL', 'TR'],
  4: ['B', 'L1', 'T', 'R1'],
  5: ['B', 'L1', 'TL', 'TR', 'R1'],
  6: ['B', 'BL', 'L2', 'T', 'R2', 'BR'],
  7: ['B', 'BL', 'L2', 'TL', 'TR', 'R2', 'BR'],
  8: ['B', 'BL', 'L1', 'L2', 'T', 'R2', 'R1', 'BR'],
  9: ['B', 'BL', 'L1', 'L2', 'TL', 'TR', 'R2', 'R1', 'BR'],
};

export interface PlacedSeat {
  /** Sitznummer 0–8 im Tischzustand. */
  readonly seat: number;
  readonly player: PlayerSeatView;
  readonly slot: Slot;
  readonly isHero: boolean;
}

/**
 * Ordnet die belegten Sitze den Positionen zu. Der eigene Sitz ist immer unten mittig (`B`),
 * die übrigen folgen im Uhrzeigersinn in Sitzreihenfolge. Ohne eigenen Sitz (Zuschauer)
 * steht der niedrigste belegte Sitz unten. Leere Sitze werden nicht gezeichnet; die belegten
 * werden je nach Anzahl gleichmäßig verteilt (`SLOTS_BY_COUNT`).
 */
export function placeSeats(view: TableView): PlacedSeat[] {
  if (view.seats.length !== MAX_SEATS) {
    throw new Error(`TableView.seats muss ${String(MAX_SEATS)} Einträge haben, hat ${String(view.seats.length)}`);
  }
  const occupied: { seat: number; player: PlayerSeatView }[] = [];
  view.seats.forEach((s, seat) => {
    if (s.kind === 'player') {
      occupied.push({ seat, player: s });
    }
  });
  if (occupied.length === 0) {
    return [];
  }
  const heroSeat = view.heroSeat;
  const heroIndex = heroSeat === null ? -1 : occupied.findIndex((o) => o.seat === heroSeat);
  const start = heroIndex === -1 ? 0 : heroIndex;
  const rotated = [...occupied.slice(start), ...occupied.slice(0, start)];
  const slotIds = SLOTS_BY_COUNT[rotated.length];
  if (slotIds === undefined) {
    throw new Error(`Keine Sitzaufteilung für ${String(rotated.length)} Spieler`);
  }
  return rotated.map((o, i) => {
    const id = slotIds[i] ?? 'B';
    return { seat: o.seat, player: o.player, slot: PORTRAIT_SLOTS[id], isHero: o.seat === heroSeat };
  });
}

/** Positions-Marker eines Sitzes: Dealer-Button hat Vorrang (Heads-up: Button = Small Blind). */
export function seatMarker(view: TableView, seat: number): 'dealer' | 'sb' | 'bb' | null {
  if (view.buttonSeat === seat) return 'dealer';
  if (view.smallBlindSeat === seat) return 'sb';
  if (view.bigBlindSeat === seat) return 'bb';
  return null;
}
