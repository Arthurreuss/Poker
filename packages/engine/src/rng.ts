/**
 * Injizierbare Zufallsquelle. Die Engine selbst erzeugt keinen Zufall,
 * sondern bekommt ein `Rng` übergeben (Tests: seeded, Betrieb: `@poker/engine/crypto-rng`).
 */
export interface Rng {
  /** Gleichverteilte ganze Zahl in `[0, maxExclusive)`. */
  int(maxExclusive: number): number;
}

const UINT32_RANGE = 0x1_0000_0000;

/** Gemeinsame Validierung für alle `Rng`-Implementierungen. */
export function assertRngBound(maxExclusive: number, upperLimit: number): void {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > upperLimit) {
    throw new RangeError(
      `maxExclusive muss eine ganze Zahl in [1, ${String(upperLimit)}] sein, war ${String(maxExclusive)}`,
    );
  }
}

/**
 * Deterministischer PRNG (mulberry32) – nur für Tests und Simulationen, nicht kryptografisch sicher.
 * `int()` nutzt Rejection Sampling, damit die Verteilung exakt gleichförmig ist.
 */
export function createSeededRng(seed: number): Rng {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`Seed muss eine ganze Zahl sein, war ${String(seed)}`);
  }
  let state = seed >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    int(maxExclusive: number): number {
      assertRngBound(maxExclusive, UINT32_RANGE);
      // Größtes Vielfaches von maxExclusive ≤ 2^32; Werte darüber verwerfen (kein Modulo-Bias).
      const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
      let x = nextUint32();
      while (x >= limit) {
        x = nextUint32();
      }
      return x % maxExclusive;
    },
  };
}
