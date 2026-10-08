// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planReveal, RESULT_DELAY_MS, RUNOUT_STEP_MS, useHandReveal } from './presentation';

const board = (n: number) => ['As', 'Kd', '7h', '2c', '9s'].slice(0, n) as never[];
const hand = (n: number, phase: 'betting' | 'complete', handNumber = 1) => ({
  handNumber,
  board: board(n),
  phase,
});

describe('planReveal', () => {
  it('erster Stand (Reload/Reconnect): alles sofort', () => {
    expect(planReveal(null, hand(5, 'complete'))).toEqual([{ atMs: 0, reveal: { board: 5, result: true } }]);
  });

  it('normaler Straßenwechsel: sofort', () => {
    const seen = { handNumber: 1, reveal: { board: 0, result: false } };
    expect(planReveal(seen, hand(3, 'betting'))).toEqual([{ atMs: 0, reveal: { board: 3, result: true } }]);
  });

  it('Showdown nach dem River ohne neue Karten: Ergebnis sofort', () => {
    const seen = { handNumber: 1, reveal: { board: 5, result: false } };
    expect(planReveal(seen, hand(5, 'complete'))).toEqual([{ atMs: 0, reveal: { board: 5, result: true } }]);
  });

  it('All-in preflop: Flop, Turn, River nacheinander, dann das Ergebnis', () => {
    const seen = { handNumber: 1, reveal: { board: 0, result: false } };
    expect(planReveal(seen, hand(5, 'complete'))).toEqual([
      { atMs: 0, reveal: { board: 3, result: false } },
      { atMs: RUNOUT_STEP_MS, reveal: { board: 4, result: false } },
      { atMs: 2 * RUNOUT_STEP_MS, reveal: { board: 5, result: false } },
      { atMs: 2 * RUNOUT_STEP_MS + RESULT_DELAY_MS, reveal: { board: 5, result: true } },
    ]);
  });

  it('All-in am Turn: River, dann das Ergebnis', () => {
    const seen = { handNumber: 1, reveal: { board: 4, result: false } };
    expect(planReveal(seen, hand(5, 'complete'))).toEqual([
      { atMs: 0, reveal: { board: 5, result: false } },
      { atMs: RESULT_DELAY_MS, reveal: { board: 5, result: true } },
    ]);
  });

  it('neue Hand, schon fertig (alle All-in durch die Blinds): ab Preflop gestaffelt', () => {
    const seen = { handNumber: 1, reveal: { board: 5, result: true } };
    expect(planReveal(seen, hand(5, 'complete', 2))).toHaveLength(4);
  });

  it('keine Hand: nichts zurückhalten', () => {
    expect(planReveal({ handNumber: 1, reveal: { board: 5, result: true } }, null)).toEqual([]);
  });
});

describe('useHandReveal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('staffelt einen Runout und hängt nie: neue Hand beendet ihn sofort', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ h }) => useHandReveal(h), { initialProps: { h: hand(0, 'betting') } });
    expect(result.current).toEqual({ reveal: { board: 0, result: true }, resultShown: true });
    rerender({ h: hand(5, 'complete') });
    expect(result.current).toEqual({ reveal: { board: 3, result: false }, resultShown: false });
    act(() => {
      vi.advanceTimersByTime(RUNOUT_STEP_MS);
    });
    expect(result.current.reveal).toEqual({ board: 4, result: false });
    // Neue Hand mitten im Runout: sofort der neue Stand.
    rerender({ h: hand(0, 'betting', 2) });
    expect(result.current).toEqual({ reveal: { board: 0, result: true }, resultShown: true });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.reveal).toEqual({ board: 0, result: true });
  });

  it('läuft bis zum Ergebnis durch', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ h }) => useHandReveal(h), { initialProps: { h: hand(3, 'betting') } });
    rerender({ h: hand(5, 'complete') });
    expect(result.current.reveal).toEqual({ board: 4, result: false });
    act(() => {
      vi.advanceTimersByTime(RUNOUT_STEP_MS);
    });
    expect(result.current.reveal).toEqual({ board: 5, result: false });
    act(() => {
      vi.advanceTimersByTime(RESULT_DELAY_MS);
    });
    expect(result.current).toEqual({ reveal: { board: 5, result: true }, resultShown: true });
  });
});
