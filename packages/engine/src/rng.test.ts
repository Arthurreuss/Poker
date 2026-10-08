import { describe, expect, it } from 'vitest';
import { cryptoRng } from './crypto-rng';
import { createSeededRng, type Rng } from './rng';

function draw(rng: Rng, max: number, n: number): number[] {
  return Array.from({ length: n }, () => rng.int(max));
}

describe('Seeded RNG', () => {
  it('ist deterministisch pro Seed', () => {
    expect(draw(createSeededRng(42), 1000, 50)).toEqual(draw(createSeededRng(42), 1000, 50));
    expect(draw(createSeededRng(42), 1000, 50)).not.toEqual(draw(createSeededRng(43), 1000, 50));
  });

  it('liefert Werte im Bereich, auch an den Grenzen', () => {
    const rng = createSeededRng(7);
    for (const max of [1, 2, 3, 52, 1000, 2 ** 31 + 1, 2 ** 32]) {
      for (const x of draw(rng, max, 200)) {
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(max);
      }
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity, 2 ** 32 + 1])('lehnt Grenze %s ab', (max) => {
    expect(() => createSeededRng(1).int(max)).toThrow(RangeError);
  });

  it('lehnt ungültige Seeds ab', () => {
    expect(() => createSeededRng(1.5)).toThrow(RangeError);
    expect(() => createSeededRng(Number.NaN)).toThrow(RangeError);
  });
});

describe('Crypto RNG (Produktion)', () => {
  it('liefert ganze Zahlen im Bereich', () => {
    for (const max of [1, 2, 52, 1000, 2 ** 40]) {
      for (const x of draw(cryptoRng, max, 200)) {
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(max);
      }
    }
  });

  it('trifft bei kleiner Grenze alle Werte', () => {
    expect(new Set(draw(cryptoRng, 4, 400))).toEqual(new Set([0, 1, 2, 3]));
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 48])('lehnt Grenze %s ab', (max) => {
    expect(() => cryptoRng.int(max)).toThrow(RangeError);
  });
});
