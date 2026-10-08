import { describe, expect, it } from 'vitest';
import * as engine from './index';

describe('öffentliche API', () => {
  it('Platzhalter bleibt für apps/server erhalten', () => {
    expect(engine.engineInfo()).toEqual({ name: engine.ENGINE_NAME });
  });

  it('exportiert Karten-, Deck- und RNG-Funktionen, aber keinen Node-Zufall', () => {
    const deck = engine.shuffledDeck(engine.createSeededRng(1));
    expect(engine.deal(deck, 2).cards).toHaveLength(2);
    expect(engine.parseCard('As')).toBe('As');
    expect('cryptoRng' in engine).toBe(false);
  });

  it('exportiert die Pot-Berechnung (WP-007)', () => {
    const { pots, uncalled } = engine.calculatePots([
      { id: 'A', totalBet: 100, status: 'allIn' },
      { id: 'B', totalBet: 300, status: 'active' },
    ]);
    expect(pots).toEqual([{ amount: 200, eligibleIds: ['A', 'B'] }]);
    expect(uncalled).toEqual({ playerId: 'B', amount: 200 });
  });
});
