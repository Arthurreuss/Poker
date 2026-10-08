import { describe, expect, it } from 'vitest';
import { WINNER_BONUS_POINTS, placementPoints } from './points';

describe('placementPoints (D-012: Platz k von n → n − k, Sieger +1)', () => {
  it.each([
    // [Platz, Spieler, Punkte]
    [1, 2, 2],
    [2, 2, 0],
    [1, 3, 3],
    [2, 3, 1],
    [3, 3, 0],
    [1, 9, 9],
    [2, 9, 7],
    [5, 9, 4],
    [9, 9, 0],
  ])('Platz %i von %i → %i Punkte', (placement, n, points) => {
    expect(placementPoints(placement, n)).toBe(points);
  });

  it('Summe über alle Plätze = n(n−1)/2 + Bonus', () => {
    for (let n = 2; n <= 9; n++) {
      let sum = 0;
      for (let k = 1; k <= n; k++) sum += placementPoints(k, n);
      expect(sum).toBe((n * (n - 1)) / 2 + WINNER_BONUS_POINTS);
    }
  });

  it.each([
    // [Platz, Spieler, geteilt von, Punkte je Spieler]
    [2, 5, 2, 2], // (3 + 2) / 2 = 2,5 → 2
    [4, 5, 2, 0], // (1 + 0) / 2 = 0,5 → 0
    [2, 4, 3, 1], // (2 + 1 + 0) / 3 = 1
    [3, 9, 2, 5], // (6 + 5) / 2 = 5,5 → 5
    [2, 9, 8, 3], // (7 + … + 0) / 8 = 3,5 → 3
    [3, 3, 1, 0],
  ])(
    'geteilter Platz %i von %i (%i Spieler) → je %i Punkte (Durchschnitt, abgerundet)',
    (placement, n, tied, points) => {
      expect(placementPoints(placement, n, tied)).toBe(points);
    },
  );

  it.each([
    [0, 3, 1],
    [4, 3, 1],
    [2, 3, 3],
    [1, 0, 1],
    [1.5, 3, 1],
    [1, 3, 0],
  ])('ungültig: Platz %s von %s (geteilt %s) → RangeError', (placement, n, tied) => {
    expect(() => placementPoints(placement, n, tied)).toThrow(RangeError);
  });
});
