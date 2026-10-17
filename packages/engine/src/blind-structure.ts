/**
 * Blind-Struktur einer Runde (WP-008, D-012, keine Antes laut D-016).
 * Zeit kommt nur als Parameter in Millisekunden herein – die Engine liest nie die Uhr.
 */

export interface BlindLevel {
  smallBlind: number;
  bigBlind: number;
}

/** Steigende Blinds nach Zeit: jedes Level dauert `levelMinutes` Minuten (D-012). */
export interface TimedBlindStructure {
  type: 'increasing';
  levels: BlindLevel[];
  levelMinutes: number;
}

/** Steigende Blinds nach Händen: jedes Level gilt für `levelHands` Hände (WP-036, D-033). */
export interface HandsBlindStructure {
  type: 'increasing';
  levels: BlindLevel[];
  levelHands: number;
}

/**
 * - `fixed`: dieselben Blinds für die ganze Runde.
 * - `increasing`: `levels` nacheinander, je `levelMinutes` Minuten **oder** je `levelHands` Hände (genau eins
 *   von beiden, D-033); nach dem letzten Level bleibt es dabei. Ohne `levelHands` ist es die Zeit-Variante –
 *   so bleiben gespeicherte Strukturen von vor WP-036 unverändert gültig.
 */
export type BlindStructure = { type: 'fixed'; level: BlindLevel } | TimedBlindStructure | HandsBlindStructure;

/**
 * Standard-Level: Faktor ca. 1,5–1,67 je Stufe. Für Startstacks von 1.500 (75 BB) bis 10.000 (500 BB);
 * die letzten Level liegen über allen Chips eines vollen Tisches mit 10.000 Startstack (9 × 10.000).
 */
export const DEFAULT_BLIND_LEVELS: readonly BlindLevel[] = [
  { smallBlind: 10, bigBlind: 20 },
  { smallBlind: 15, bigBlind: 30 },
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 40, bigBlind: 80 },
  { smallBlind: 60, bigBlind: 120 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 150, bigBlind: 300 },
  { smallBlind: 250, bigBlind: 500 },
  { smallBlind: 400, bigBlind: 800 },
  { smallBlind: 600, bigBlind: 1_200 },
  { smallBlind: 1_000, bigBlind: 2_000 },
  { smallBlind: 1_500, bigBlind: 3_000 },
  { smallBlind: 2_500, bigBlind: 5_000 },
  { smallBlind: 4_000, bigBlind: 8_000 },
  { smallBlind: 6_000, bigBlind: 12_000 },
  { smallBlind: 10_000, bigBlind: 20_000 },
  { smallBlind: 15_000, bigBlind: 30_000 },
  { smallBlind: 25_000, bigBlind: 50_000 },
  { smallBlind: 40_000, bigBlind: 80_000 },
  { smallBlind: 60_000, bigBlind: 120_000 },
  { smallBlind: 100_000, bigBlind: 200_000 },
];

/** Standard-Level-Dauer (D-012: Standard ist steigend). */
export const DEFAULT_LEVEL_MINUTES = 10;

/** Vorschlag für Hände pro Level, wenn die Blinds nach Händen steigen (WP-036, D-033). */
export const DEFAULT_LEVEL_HANDS = 10;

/** Standard-Blind-Struktur: `DEFAULT_BLIND_LEVELS`, steigend alle 10 Minuten. */
export const DEFAULT_BLIND_STRUCTURE: BlindStructure = {
  type: 'increasing',
  levels: DEFAULT_BLIND_LEVELS.map((l) => ({ ...l })),
  levelMinutes: DEFAULT_LEVEL_MINUTES,
};

const MS_PER_MINUTE = 60_000;

/** Alle Level der Struktur (bei `fixed` genau eins). */
export function blindLevels(structure: BlindStructure): readonly BlindLevel[] {
  return structure.type === 'fixed' ? [structure.level] : structure.levels;
}

/** Steigen die Blinds nach Anzahl Hände statt nach Zeit (D-033)? */
export function isHandsBlindStructure(structure: BlindStructure): structure is HandsBlindStructure {
  return structure.type === 'increasing' && 'levelHands' in structure;
}

/**
 * Index des Levels nach `elapsedMs` Millisekunden seit Rundenstart (negativ zählt als 0).
 * Nur für die Zeit-Variante; feste Blinds und die Hände-Variante liefern 0 (siehe `blindLevelIndexForHand`).
 */
export function blindLevelIndexAt(structure: BlindStructure, elapsedMs: number): number {
  if (structure.type === 'fixed' || isHandsBlindStructure(structure)) return 0;
  const index = Math.floor(Math.max(0, elapsedMs) / (structure.levelMinutes * MS_PER_MINUTE));
  return Math.min(index, structure.levels.length - 1);
}

/**
 * Index des Levels für Hand Nummer `handNumber` (ab 1) bei der Hände-Variante: Hände 1 … N → Level 0,
 * N+1 … 2N → Level 1 usw., gekappt auf das letzte Level. Feste Blinds und die Zeit-Variante liefern 0.
 */
export function blindLevelIndexForHand(structure: BlindStructure, handNumber: number): number {
  if (!isHandsBlindStructure(structure)) return 0;
  const index = Math.floor(Math.max(0, handNumber - 1) / structure.levelHands);
  return Math.min(index, structure.levels.length - 1);
}

/**
 * Hände, die ab Hand `handNumber` (diese eingeschlossen) noch auf deren Level gespielt werden, bevor das
 * nächste Level beginnt; `null` bei festen Blinds, bei der Zeit-Variante und im letzten Level.
 */
export function blindLevelHandsLeft(structure: BlindStructure, handNumber: number): number | null {
  if (!isHandsBlindStructure(structure)) return null;
  if (blindLevelIndexForHand(structure, handNumber) >= structure.levels.length - 1) return null;
  return structure.levelHands - (Math.max(0, handNumber - 1) % structure.levelHands);
}

/** Ende von Level `index` in ms seit Rundenstart; `null`, wenn es kein weiteres Level gibt oder die Blinds nicht nach Zeit steigen. */
export function blindLevelEndsAfterMs(structure: BlindStructure, index: number): number | null {
  if (structure.type === 'fixed' || isHandsBlindStructure(structure) || index >= structure.levels.length - 1) {
    return null;
  }
  return (index + 1) * structure.levelMinutes * MS_PER_MINUTE;
}
