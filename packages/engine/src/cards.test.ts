import { describe, expect, it } from 'vitest';
import {
  CardParseError,
  RANKS,
  SUITS,
  cardRank,
  cardSuit,
  formatCards,
  isCard,
  makeCard,
  parseCard,
  parseCards,
  rankValue,
} from './cards';

describe('Karten', () => {
  it('Roundtrip parse/format für alle 52 Karten', () => {
    for (const rank of RANKS) {
      for (const suit of SUITS) {
        const card = makeCard(rank, suit);
        expect(parseCard(card)).toBe(card);
        expect(cardRank(card)).toBe(rank);
        expect(cardSuit(card)).toBe(suit);
        expect(JSON.parse(JSON.stringify(card))).toBe(card);
      }
    }
  });

  it('parseCards/formatCards sind zueinander invers', () => {
    const text = 'As Td 2c 9h';
    expect(parseCards(text)).toEqual(['As', 'Td', '2c', '9h']);
    expect(formatCards(parseCards(text))).toBe(text);
    expect(parseCards('  Kh   Qs ')).toEqual(['Kh', 'Qs']);
    expect(parseCards('')).toEqual([]);
  });

  it.each(['', 'A', 'Asx', 'as', 'AS', '1s', '10s', 'Ax', ' As', 'sA'])('lehnt %j ab', (text) => {
    expect(() => parseCard(text)).toThrow(CardParseError);
    expect(isCard(text)).toBe(false);
  });

  it('isCard lehnt Nicht-Strings ab', () => {
    for (const value of [null, undefined, 14, {}, ['A', 's']]) {
      expect(isCard(value)).toBe(false);
    }
  });

  it('parseCards meldet ungültige und doppelte Karten', () => {
    expect(() => parseCards('As Xx')).toThrow(CardParseError);
    expect(() => parseCards('As Kd As')).toThrow(/doppelt/);
  });

  it('rankValue: 2 → 2, T → 10, A → 14', () => {
    expect(rankValue('2')).toBe(2);
    expect(rankValue('T')).toBe(10);
    expect(rankValue('A')).toBe(14);
  });
});
