/**
 * Produktions-Zufallsquelle. Einzige Datei der Engine mit Node-Abhängigkeit;
 * deshalb nicht über `index.ts`, sondern als Subpfad `@poker/engine/crypto-rng` exportiert.
 */
import { randomInt } from 'node:crypto';
import { assertRngBound, type Rng } from './rng';

/** `crypto.randomInt` erlaubt höchstens 2^48 − 1 als obere Grenze. */
const MAX_RANGE = 2 ** 48 - 1;

/** Kryptografisch sicheres, unverzerrtes `Rng` auf Basis von `crypto.randomInt`. */
export const cryptoRng: Rng = {
  int(maxExclusive: number): number {
    assertRngBound(maxExclusive, MAX_RANGE);
    return randomInt(maxExclusive);
  },
};
