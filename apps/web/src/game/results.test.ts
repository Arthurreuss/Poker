import type { StandingView } from '@poker/engine/protocol';
import { describe, expect, it } from 'vitest';
import { describePotResult, handResult, standingRows } from './results';
import { act, serverView, startGame, toAct } from './test/fixtures';

describe('handResult', () => {
  it('noch keine Hand beendet: null', () => {
    expect(handResult(serverView(startGame(), 1))).toBeNull();
  });

  it('alle anderen folden: Gewinner ohne Hand', () => {
    const game = startGame();
    act(game, { type: 'fold' });
    act(game, { type: 'fold' });
    const result = handResult(serverView(game, 1));
    expect(result?.lines).toHaveLength(1);
    expect(result?.lines[0]).toMatchObject({ label: 'Pot', hand: null });
    expect(result?.ownHand).toBeNull();
  });

  it('Showdown: Gewinnerhand und eigene Hand', () => {
    const game = startGame();
    while (game.round.hand?.phase === 'betting') {
      const legal = serverView(game, toAct(game)).round?.hand?.legalActions;
      act(game, legal?.actions.some((a) => a.type === 'check') ? { type: 'check' } : { type: 'call' });
    }
    const result = handResult(serverView(game, 1));
    const line = result?.lines[0];
    expect(line?.label).toBe('Pot');
    expect(line?.hand).toEqual(expect.any(String));
    expect(line?.winners.length).toBeGreaterThan(0);
    expect(result?.ownHand).toEqual(expect.any(String));
  });
});

describe('describePotResult', () => {
  it('ein Gewinner, mit und ohne Hand', () => {
    expect(describePotResult({ label: 'Pot', winners: ['lena'], amount: 1200, hand: 'Full House' })).toBe(
      'lena gewinnt 1.200 – Full House',
    );
    expect(describePotResult({ label: 'Pot', winners: ['lena'], amount: 60, hand: null })).toBe('lena gewinnt 60');
  });

  it('geteilter Pot', () => {
    expect(describePotResult({ label: 'Side Pot 1', winners: ['a', 'b'], amount: 300, hand: 'Straße' })).toBe(
      'a und b teilen sich 300 – Straße',
    );
  });
});

describe('standingRows', () => {
  const s = (id: number, seat: number, placement: number, shared: boolean, points: number): StandingView => ({
    playerId: String(id),
    seat,
    placement,
    sharedPlacement: shared,
    points,
    user: { id, username: `u${String(id)}` },
  });

  it('sortiert nach Platz, geteilte Plätze als Bereich (D-018), eigene Zeile markiert', () => {
    const rows = standingRows(
      [s(4, 3, 3, true, 2), s(1, 0, 1, false, 10), s(3, 2, 3, true, 2), s(2, 1, 2, false, 6)],
      3,
    );
    expect(rows.map((r) => [r.name, r.place, r.shared, r.points, r.isYou])).toEqual([
      ['u1', '1.', false, 10, false],
      ['u2', '2.', false, 6, false],
      ['u3', '3.–4.', true, 2, true],
      ['u4', '3.–4.', true, 2, false],
    ]);
  });
});
