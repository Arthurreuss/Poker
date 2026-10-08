import { describe, expect, it } from 'vitest';
import type { Card } from './cards';
import { createDeck, shuffledDeck } from './deck';
import { HAND_CATEGORIES, evaluateHand, handValue, type HandCategory } from './hand-eval';
import { createSeededRng } from './rng';

// Bekannte Häufigkeiten aller C(52,5) = 2.598.960 5-Karten-Hände.
const EXPECTED: Record<HandCategory, number> = {
  'straight-flush': 40, // inkl. 4 Royal Flushes
  'four-of-a-kind': 624,
  'full-house': 3_744,
  flush: 5_108,
  straight: 10_200,
  'three-of-a-kind': 54_912,
  'two-pair': 123_552,
  pair: 1_098_240,
  'high-card': 1_302_540,
};

describe('Vollständigkeit: alle 2.598.960 5-Karten-Hände', () => {
  it('ergibt die bekannten Häufigkeiten je Kategorie und 7.462 verschiedene Werte', { timeout: 60_000 }, () => {
    const deck = createDeck();
    const counts = new Map<HandCategory, number>();
    const distinctValues = new Set<number>();
    let royals = 0;
    let total = 0;
    const hand: Card[] = [];
    for (let a = 0; a < 48; a++) {
      for (let b = a + 1; b < 49; b++) {
        for (let c = b + 1; c < 50; c++) {
          for (let d = c + 1; d < 51; d++) {
            for (let e = d + 1; e < 52; e++) {
              hand[0] = deck[a] as Card;
              hand[1] = deck[b] as Card;
              hand[2] = deck[c] as Card;
              hand[3] = deck[d] as Card;
              hand[4] = deck[e] as Card;
              const result = evaluateHand(hand);
              counts.set(result.category, (counts.get(result.category) ?? 0) + 1);
              distinctValues.add(result.value);
              if (result.description === 'Royal Flush') royals++;
              total++;
            }
          }
        }
      }
    }
    expect(total).toBe(2_598_960);
    expect(Object.fromEntries(HAND_CATEGORIES.map((cat) => [cat, counts.get(cat) ?? 0]))).toEqual(EXPECTED);
    expect(royals).toBe(4);
    // Anzahl unterscheidbarer 5-Karten-Hand-Ränge (bekannter Wert) → Wertkodierung ohne Kollisionen/Lücken.
    expect(distinctValues.size).toBe(7_462);
  });
});

describe('Performance', () => {
  it('7-Karten-Bewertung im Mittel < 50 µs (100.000 seeded Hände)', () => {
    const rng = createSeededRng(20261008);
    const hands: Card[][] = [];
    for (let i = 0; i < 100_000; i++) hands.push(shuffledDeck(rng).slice(0, 7));

    // Aufwärmen (JIT), dann messen.
    for (let i = 0; i < 10_000; i++) evaluateHand(hands[i] as Card[]);
    let checksum = 0;
    const start = performance.now();
    for (const hand of hands) checksum += evaluateHand(hand).value;
    const microsPerHand = ((performance.now() - start) * 1000) / hands.length;

    const startValue = performance.now();
    for (const hand of hands) checksum -= handValue(hand);
    const microsPerValue = ((performance.now() - startValue) * 1000) / hands.length;

    console.info(
      `Handbewertung: evaluateHand ${microsPerHand.toFixed(2)} µs, handValue ${microsPerValue.toFixed(2)} µs pro 7-Karten-Hand`,
    );
    expect(checksum).toBe(0);
    // Ziel laut WP-005: < 50 µs. Die Schwelle ist das Ziel selbst; typische Werte liegen weit darunter.
    expect(microsPerHand).toBeLessThan(50);
  });
});
