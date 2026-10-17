import type { Card } from '@poker/engine';
import { describe, expect, it } from 'vitest';
import { heroHandName } from './handName';

const cards = (text: string): Card[] => (text === '' ? [] : (text.split(' ') as Card[]));
const name = (hole: string, board = ''): string => {
  const [a, b] = cards(hole);
  if (a === undefined || b === undefined) throw new Error('zwei Karten');
  return heroHandName([a, b], cards(board)).short;
};

describe('heroHandName – preflop (eigene Ableitung)', () => {
  it('Paar mit Rang im Plural', () => {
    expect(name('Ah As')).toBe('Paar Asse');
    expect(name('7c 7d')).toBe('Paar Siebenen');
  });

  it('sonst höchste Karte, unabhängig von der Reihenfolge', () => {
    expect(name('2c Kd')).toBe('Höchste Karte König');
    expect(name('Td 9s')).toBe('Höchste Karte Zehn');
  });

  it('kurz = lang', () => {
    expect(heroHandName(['Ah', 'As'], [])).toEqual({ short: 'Paar Asse', long: 'Paar Asse' });
  });
});

describe('heroHandName – mit Board (Engine)', () => {
  it('benennt jede Kategorie kurz', () => {
    expect(name('Ah 2c', 'Kd 9s 5h')).toBe('Höchste Karte Ass');
    expect(name('Kh 2c', 'Kd 9s 5h')).toBe('Paar Könige');
    expect(name('Kh 9c', 'Kd 9s 5h')).toBe('Zwei Paare');
    expect(name('Kh Kc', 'Kd 9s 5h')).toBe('Drilling Könige');
    expect(name('7h 8c', '9d Ts Jh')).toBe('Straße');
    expect(name('2h 8h', 'Kh 9h 5h')).toBe('Flush');
    expect(name('Kh Kc', 'Kd 9s 9h')).toBe('Full House');
    expect(name('Kh Kc', 'Kd Ks 9h')).toBe('Vierling Könige');
    expect(name('7h 8h', '9h Th Jh')).toBe('Straight Flush');
    expect(name('Ah Kh', 'Qh Jh Th')).toBe('Royal Flush');
  });

  it('nutzt Turn und River (beste fünf aus sieben)', () => {
    expect(name('Ah 2c', 'Kd 9s 5h 2d')).toBe('Paar Zweien');
    expect(name('Ah 2c', 'Kd 9s 5h 2d Ad')).toBe('Zwei Paare');
  });

  it('lang = Beschreibung der Engine', () => {
    expect(heroHandName(['Kh', '9c'], cards('Kd 9s 5h')).long).toBe('Zwei Paare, Könige und Neunen, Kicker Fünf');
  });
});
