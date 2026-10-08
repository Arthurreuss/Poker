/**
 * Reine Layout-Funktionen der Tischansicht (Hochformat WP-016, Querformat WP-017): welche
 * Sitznummer an welcher Position um den ovalen Tisch erscheint und welches Layout gilt.
 * Keine DOM-Abhängigkeit – direkt testbar.
 */
import type { OrientationPreference } from '../settings/orientation';
import { MAX_SEATS, type PlayerSeatView, type TableView } from './types';

/** Die zwei Layouts der Tischansicht (D-009). */
export type TableLayout = 'portrait' | 'landscape';

/**
 * Welches Layout gilt: `auto` folgt der Ausrichtung des Bildschirms (Viewport), `portrait` und
 * `landscape` erzwingen das Layout unabhängig davon (D-009).
 */
export function resolveLayout(preference: OrientationPreference, deviceLandscape: boolean): TableLayout {
  if (preference === 'auto') return deviceLandscape ? 'landscape' : 'portrait';
  return preference;
}

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
 * Welche Positionen bei n belegten Plätzen im Hochformat genutzt werden – im Uhrzeigersinn ab
 * unten mittig, so dass die Spieler gleichmäßig um den Tisch verteilt sind.
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

/**
 * Positionen im Querformat (WP-017): breiter, flacher Tisch. Die rechte untere Ecke gehört der
 * Aktionsleiste (WP-018), deshalb sitzt `BR` höher als `BL`. Seitliche Sitze: L2/R2 oben,
 * L1/R1 auf halber Höhe. Der eigene Einsatz steht links neben den eigenen Karten.
 * Werte sind per Screenshot-Test (e2e-visual) abgestimmt.
 */
export const LANDSCAPE_SLOTS: Readonly<Record<SlotId, Slot>> = {
  B: { id: 'B', x: 50, y: 88, betX: 43, betY: 74, betAlign: 'end', markerSide: 'right' },
  BL: { id: 'BL', x: 21, y: 80, betX: 30, betY: 68, betAlign: 'start', markerSide: 'right' },
  L1: { id: 'L1', x: 8, y: 47, betX: 16, betY: 42, betAlign: 'start', markerSide: 'right' },
  L2: { id: 'L2', x: 16, y: 22, betX: 24, betY: 30, betAlign: 'start', markerSide: 'right' },
  TL: { id: 'TL', x: 33, y: 19, betX: 37, betY: 33, betAlign: 'center', markerSide: 'right' },
  T: { id: 'T', x: 50, y: 19, betX: 50, betY: 33, betAlign: 'center', markerSide: 'right' },
  TR: { id: 'TR', x: 67, y: 19, betX: 63, betY: 33, betAlign: 'center', markerSide: 'left' },
  R2: { id: 'R2', x: 84, y: 22, betX: 76, betY: 30, betAlign: 'end', markerSide: 'left' },
  R1: { id: 'R1', x: 92, y: 47, betX: 84, betY: 42, betAlign: 'end', markerSide: 'left' },
  BR: { id: 'BR', x: 80, y: 68, betX: 71, betY: 66, betAlign: 'end', markerSide: 'left' },
};

/**
 * Positionen je Spielerzahl im Querformat. `BR` (über der Aktionsleiste) wird nur bei 9 Spielern
 * gebraucht; bis 8 Spieler bleibt die Verteilung links/rechts symmetrisch.
 */
export const LANDSCAPE_SLOTS_BY_COUNT: Readonly<Record<number, readonly SlotId[]>> = {
  1: ['B'],
  2: ['B', 'T'],
  3: ['B', 'TL', 'TR'],
  4: ['B', 'L1', 'T', 'R1'],
  5: ['B', 'L1', 'TL', 'TR', 'R1'],
  6: ['B', 'L1', 'TL', 'T', 'TR', 'R1'],
  7: ['B', 'L1', 'L2', 'TL', 'TR', 'R2', 'R1'],
  8: ['B', 'L1', 'L2', 'TL', 'T', 'TR', 'R2', 'R1'],
  9: ['B', 'BL', 'L1', 'L2', 'TL', 'TR', 'R2', 'R1', 'BR'],
};

interface LayoutTables {
  readonly slots: Readonly<Record<SlotId, Slot>>;
  readonly byCount: Readonly<Record<number, readonly SlotId[]>>;
}

/** Positionstabellen je Layout. */
export const LAYOUT_TABLES: Readonly<Record<TableLayout, LayoutTables>> = {
  portrait: { slots: PORTRAIT_SLOTS, byCount: SLOTS_BY_COUNT },
  landscape: { slots: LANDSCAPE_SLOTS, byCount: LANDSCAPE_SLOTS_BY_COUNT },
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
 * werden je nach Anzahl gleichmäßig verteilt (`SLOTS_BY_COUNT` bzw. `LANDSCAPE_SLOTS_BY_COUNT`).
 */
export function placeSeats(view: TableView, layout: TableLayout = 'portrait'): PlacedSeat[] {
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
  const { slots, byCount } = LAYOUT_TABLES[layout];
  const slotIds = byCount[rotated.length];
  if (slotIds === undefined) {
    throw new Error(`Keine Sitzaufteilung für ${String(rotated.length)} Spieler`);
  }
  return rotated.map((o, i) => {
    const id = slotIds[i] ?? 'B';
    return { seat: o.seat, player: o.player, slot: slots[id], isHero: o.seat === heroSeat };
  });
}

/** Positions-Marker eines Sitzes: Dealer-Button hat Vorrang (Heads-up: Button = Small Blind). */
export function seatMarker(view: TableView, seat: number): 'dealer' | 'sb' | 'bb' | null {
  if (view.buttonSeat === seat) return 'dealer';
  if (view.smallBlindSeat === seat) return 'sb';
  if (view.bigBlindSeat === seat) return 'bb';
  return null;
}
