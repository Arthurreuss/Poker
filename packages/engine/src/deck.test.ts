import { describe, expect, it } from 'vitest';
import { isCard, type Card } from './cards';
import { createDeck, deal, shuffle, shuffledDeck } from './deck';
import { createSeededRng } from './rng';

/** Chi-Quadrat-Statistik für beobachtete Häufigkeiten bei Gleichverteilung. */
function chiSquare(counts: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = total / counts.length;
  return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
}

/** Kritischer Wert der Chi-Quadrat-Verteilung für p = 0,001 (Wilson-Hilferty-Näherung). */
function chiSquareCritical(df: number): number {
  const z = 3.0902; // Standardnormal-Quantil für 0,999
  const a = 2 / (9 * df);
  return df * (1 - a + z * Math.sqrt(a)) ** 3;
}

function increment(counts: number[], i: number): void {
  const current = counts[i];
  if (current === undefined) throw new Error(`Index außerhalb: ${String(i)}`);
  counts[i] = current + 1;
}

describe('Deck', () => {
  it('enthält genau 52 verschiedene, gültige Karten', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    expect(deck.every(isCard)).toBe(true);
  });

  it('gemischtes Deck ist eine Permutation des vollen Decks', () => {
    const deck = shuffledDeck(createSeededRng(1));
    expect(deck).toHaveLength(52);
    expect([...deck].sort()).toEqual([...createDeck()].sort());
  });

  it('gleicher Seed → gleiche Reihenfolge, anderer Seed → andere', () => {
    expect(shuffledDeck(createSeededRng(123))).toEqual(shuffledDeck(createSeededRng(123)));
    const decks = [1, 2, 3, 4, 5].map((seed) => shuffledDeck(createSeededRng(seed)).join(''));
    expect(new Set(decks).size).toBe(decks.length);
  });

  it('shuffle verändert die Eingabe nicht', () => {
    const input = createDeck();
    const copy = [...input];
    shuffle(input, createSeededRng(9));
    expect(input).toEqual(copy);
  });

  it('gemischtes Deck ist JSON-serialisierbar', () => {
    const deck = shuffledDeck(createSeededRng(5));
    expect(JSON.parse(JSON.stringify(deck))).toEqual(deck);
  });
});

describe('Statistik (fester Seed, daher nicht flaky)', () => {
  it('erste Karte ist gleichverteilt über 52 Karten', () => {
    const rng = createSeededRng(20261008);
    const index = new Map(createDeck().map((c, i) => [c, i]));
    const counts = new Array<number>(52).fill(0);
    const runs = 52 * 400;
    for (let i = 0; i < runs; i++) {
      const first = shuffledDeck(rng)[0] as Card;
      increment(counts, index.get(first) ?? -1);
    }
    expect(chiSquare(counts)).toBeLessThan(chiSquareCritical(51));
  });

  it('eine feste Karte landet gleichverteilt auf allen 52 Positionen', () => {
    const rng = createSeededRng(77);
    const counts = new Array<number>(52).fill(0);
    const runs = 52 * 400;
    for (let i = 0; i < runs; i++) {
      increment(counts, shuffledDeck(rng).indexOf('As'));
    }
    expect(chiSquare(counts)).toBeLessThan(chiSquareCritical(51));
  });

  it('alle 24 Permutationen von 4 Elementen gleich häufig (erkennt naiven Shuffle-Bias)', () => {
    const rng = createSeededRng(3);
    const counts = new Map<string, number>();
    const runs = 24 * 1000;
    for (let i = 0; i < runs; i++) {
      const key = shuffle([0, 1, 2, 3], rng).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    expect(chiSquare([...counts.values()])).toBeLessThan(chiSquareCritical(23));
  });
});

describe('deal', () => {
  it('teilt von oben aus und lässt das Eingabe-Deck unverändert', () => {
    const deck = createDeck();
    const { cards, deck: rest } = deal(deck, 2);
    expect(cards).toEqual(deck.slice(0, 2));
    expect(rest).toEqual(deck.slice(2));
    expect(deck).toHaveLength(52);
  });

  it('ausgeteilte Karten und Rest ergeben zusammen wieder das Deck', () => {
    let deck = shuffledDeck(createSeededRng(11));
    const dealt: Card[] = [];
    for (const n of [2, 2, 3, 1, 1]) {
      const r = deal(deck, n);
      dealt.push(...r.cards);
      deck = r.deck;
    }
    expect(dealt).toHaveLength(9);
    expect(deck).toHaveLength(43);
    expect(new Set([...dealt, ...deck]).size).toBe(52);
  });

  it('0 Karten und alle Karten sind erlaubt', () => {
    const deck = createDeck();
    expect(deal(deck, 0)).toEqual({ cards: [], deck });
    expect(deal(deck, 52)).toEqual({ cards: deck, deck: [] });
  });

  it.each([53, -1, 1.5, Number.NaN])('lehnt Anzahl %s ab', (n) => {
    expect(() => deal(createDeck(), n)).toThrow(RangeError);
  });
});
