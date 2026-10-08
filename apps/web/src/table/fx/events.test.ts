import { describe, expect, it } from 'vitest';
import type { PlayerSeatView, SeatView, TableView } from '../types';
import { diffTableViews } from './events';

const EMPTY: SeatView = { kind: 'empty' };

function p(overrides: Partial<PlayerSeatView> = {}): PlayerSeatView {
  return {
    kind: 'player',
    name: 'x',
    stack: 1000,
    bet: 0,
    status: 'active',
    connected: true,
    holeCards: { kind: 'hidden' },
    ...overrides,
  };
}

function view(seats: SeatView[], overrides: Partial<TableView> = {}): TableView {
  return {
    seats: [...seats, ...Array.from({ length: 9 - seats.length }, () => EMPTY)],
    heroSeat: 0,
    buttonSeat: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    toActSeat: null,
    board: [],
    pots: [],
    blinds: { small: 10, big: 20 },
    handNumber: 1,
    ...overrides,
  };
}

describe('diffTableViews', () => {
  it('ohne vorherige Ansicht keine Ereignisse (erster Stand, Reconnect)', () => {
    expect(diffTableViews(null, view([p(), p()]))).toEqual([]);
  });

  it('neue Hand: Austeilen ab links vom Button, Blinds als Einsätze', () => {
    const before = view([p({ holeCards: { kind: 'none' } }), p({ holeCards: { kind: 'none' } }), p()], {
      handNumber: 1,
    });
    const after = view([p(), p({ bet: 10 }), p({ bet: 20 })], { handNumber: 2, buttonSeat: 0 });
    expect(diffTableViews(before, after)).toEqual([
      { type: 'deal', seats: [1, 2, 0] },
      { type: 'bet', seat: 1, allIn: false },
      { type: 'bet', seat: 2, allIn: false },
    ]);
  });

  it('Einsatz, Fold, Check und „Du bist dran“', () => {
    const a = view([p(), p(), p()], { toActSeat: 1 });
    const b = view([p(), p({ bet: 40, stack: 960 }), p()], { toActSeat: 2 });
    expect(diffTableViews(a, b)).toEqual([{ type: 'bet', seat: 1, allIn: false }]);
    const c = view([p(), p({ bet: 40, stack: 960 }), p({ status: 'folded', holeCards: { kind: 'none' } })], {
      toActSeat: 0,
    });
    expect(diffTableViews(b, c)).toEqual([{ type: 'fold', seat: 2 }, { type: 'yourTurn' }]);
    const d = view([p(), p(), p()], { toActSeat: 2 });
    const e = view([p(), p(), p()], { toActSeat: 0 });
    expect(diffTableViews(d, e)).toEqual([{ type: 'check', seat: 2 }, { type: 'yourTurn' }]);
  });

  it('Straßenende: Einsätze in den Pot, Board-Karten neu', () => {
    const a = view([p({ bet: 20 }), p({ bet: 20 })], { toActSeat: 1 });
    const b = view([p(), p()], { board: ['As', 'Kd', '7h'], pots: [{ amount: 40 }], toActSeat: 1 });
    expect(diffTableViews(a, b)).toEqual([
      { type: 'collect', seats: [0, 1] },
      { type: 'board', from: 0, to: 3 },
    ]);
  });

  it('Showdown: aufgedeckte Karten und Gewinner (nur einmal)', () => {
    const a = view([p({ holeCards: { kind: 'visible', cards: ['Ah', 'Ad'] } }), p()]);
    const b = view([
      p({ holeCards: { kind: 'visible', cards: ['Ah', 'Ad'] } }),
      p({ holeCards: { kind: 'shown', cards: ['2c', '3c'] } }),
    ]);
    const c = { ...b, winnerSeats: [0] };
    expect(diffTableViews(a, b)).toEqual([{ type: 'reveal', seat: 1 }]);
    expect(diffTableViews(b, c)).toEqual([{ type: 'win', seats: [0], hero: true }]);
    expect(diffTableViews(c, { ...c })).toEqual([]);
  });
});
