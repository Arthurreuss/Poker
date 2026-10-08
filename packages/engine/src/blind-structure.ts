/**
 * Blind-Struktur einer Runde (WP-008, D-012, keine Antes laut D-016).
 * Zeit kommt nur als Parameter in Millisekunden herein – die Engine liest nie die Uhr.
 */

export interface BlindLevel {
  smallBlind: number;
  bigBlind: number;
}

/**
 * - `fixed`: dieselben Blinds für die ganze Runde.
 * - `increasing`: `levels` nacheinander, je `levelMinutes` Minuten; nach dem letzten Level bleibt es dabei.
 */
export type BlindStructure =
  { type: 'fixed'; level: BlindLevel } | { type: 'increasing'; levels: BlindLevel[]; levelMinutes: number };

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

/** Index des Levels nach `elapsedMs` Millisekunden seit Rundenstart (negativ zählt als 0). */
export function blindLevelIndexAt(structure: BlindStructure, elapsedMs: number): number {
  if (structure.type === 'fixed') return 0;
  const index = Math.floor(Math.max(0, elapsedMs) / (structure.levelMinutes * MS_PER_MINUTE));
  return Math.min(index, structure.levels.length - 1);
}

/** Ende von Level `index` in ms seit Rundenstart; `null`, wenn es kein weiteres Level gibt. */
export function blindLevelEndsAfterMs(structure: BlindStructure, index: number): number | null {
  if (structure.type === 'fixed' || index >= structure.levels.length - 1) return null;
  return (index + 1) * structure.levelMinutes * MS_PER_MINUTE;
}
