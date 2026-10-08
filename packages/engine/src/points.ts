/**
 * Punkteformel (D-012) – die **einzige** Stelle, an der Punkte berechnet werden.
 * Platz k von n Spielern → (n − k) Punkte, der Sieger (Platz 1) zusätzlich 1 Bonuspunkt.
 * Geteilte Platzierung (gleichzeitiges Ausscheiden mit gleichem Stack, WP-008): Die Punkte der
 * belegten Plätze werden gemittelt und abgerundet (TDA: geteilte Plätze teilen sich den Preis).
 */

/** Bonuspunkt für den Sieger (D-012). */
export const WINNER_BONUS_POINTS = 1;

/**
 * Punkte für Platz `placement` bei `playerCount` Spielern. Teilen sich `tiedCount` Spieler den Platz
 * (sie belegen die Plätze `placement` … `placement + tiedCount − 1`), bekommt jeder den abgerundeten
 * Durchschnitt dieser Plätze.
 */
export function placementPoints(placement: number, playerCount: number, tiedCount = 1): number {
  if (!Number.isSafeInteger(playerCount) || playerCount < 1) {
    throw new RangeError(`playerCount muss eine positive ganze Zahl sein, war ${String(playerCount)}`);
  }
  if (!Number.isSafeInteger(tiedCount) || tiedCount < 1) {
    throw new RangeError(`tiedCount muss eine positive ganze Zahl sein, war ${String(tiedCount)}`);
  }
  if (!Number.isSafeInteger(placement) || placement < 1 || placement + tiedCount - 1 > playerCount) {
    throw new RangeError(
      `Platz ${String(placement)} (geteilt von ${String(tiedCount)}) passt nicht zu ${String(playerCount)} Spielern`,
    );
  }
  let sum = 0;
  for (let k = placement; k < placement + tiedCount; k++) {
    sum += playerCount - k + (k === 1 ? WINNER_BONUS_POINTS : 0);
  }
  return Math.floor(sum / tiedCount);
}
