import type { HandEvent } from '@poker/engine';
import { describe, expect, it } from 'vitest';
import { lastActionsOf } from './lastAction';

function ev(partial: Partial<HandEvent> & Pick<HandEvent, 'type' | 'playerId'>): HandEvent {
  return { street: 'preflop', amount: 0, to: 0, allIn: false, ...partial };
}

describe('lastActionsOf', () => {
  const preflop: HandEvent[] = [
    ev({ type: 'smallBlind', playerId: 'a', amount: 10, to: 10 }),
    ev({ type: 'bigBlind', playerId: 'b', amount: 20, to: 20 }),
    ev({ type: 'call', playerId: 'c', amount: 20, to: 20 }),
    ev({ type: 'raise', playerId: 'a', amount: 50, to: 60 }),
    ev({ type: 'fold', playerId: 'b' }),
  ];

  it('nimmt je Spieler die letzte Aktion der Straße, Blinds zählen nicht', () => {
    const map = lastActionsOf({ phase: 'betting', street: 'preflop', log: preflop });
    expect(Object.fromEntries(map)).toEqual({
      a: { kind: 'raise', amount: 60 },
      b: { kind: 'fold' },
      c: { kind: 'call', amount: 20 },
    });
  });

  it('nur Blinds gesetzt: noch keine Aktion', () => {
    expect(lastActionsOf({ phase: 'betting', street: 'preflop', log: preflop.slice(0, 2) }).size).toBe(0);
  });

  it('neue Straße: alte Aktionen verschwinden, Check und Bet der neuen erscheinen', () => {
    const log = [
      ...preflop,
      ev({ street: 'flop', type: 'check', playerId: 'a' }),
      ev({ street: 'flop', type: 'bet', playerId: 'c', amount: 40, to: 40 }),
    ];
    expect(lastActionsOf({ phase: 'betting', street: 'flop', log: preflop }).size).toBe(0);
    expect(Object.fromEntries(lastActionsOf({ phase: 'betting', street: 'flop', log }))).toEqual({
      a: { kind: 'check' },
      c: { kind: 'bet', amount: 40 },
    });
  });

  it('All-in hat Vorrang vor Call/Bet/Raise', () => {
    const log = [ev({ street: 'turn', type: 'call', playerId: 'a', amount: 35, to: 35, allIn: true })];
    expect(lastActionsOf({ phase: 'betting', street: 'turn', log }).get('a')).toEqual({ kind: 'allIn', amount: 35 });
  });

  it('nach der Hand: keine Schriftzüge', () => {
    expect(lastActionsOf({ phase: 'complete', street: 'preflop', log: preflop }).size).toBe(0);
  });
});
