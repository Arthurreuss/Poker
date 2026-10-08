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

  it('exportiert das Rundenmodell (WP-008)', () => {
    const started = engine.startRound(
      {
        startingStack: 1_500,
        blindStructure: engine.DEFAULT_BLIND_STRUCTURE,
        turnTimeSeconds: 20,
        timeBankSeconds: 60,
      },
      [
        { id: 'A', seat: 0 },
        { id: 'B', seat: 1 },
      ],
      engine.createSeededRng(1),
    );
    expect(started.ok).toBe(true);
    expect(engine.placementPoints(1, 9)).toBe(9);
    expect(engine.DEFAULT_TURN_TIME_SECONDS).toBe(20);
    expect(engine.DEFAULT_TIME_BANK_SECONDS).toBe(60);
  });
});
