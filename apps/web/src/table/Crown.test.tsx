// @vitest-environment jsdom
// Krone am Gewinner (WP-039): nur an Sitzen in `winnerSeats`, bei Split-Pot an allen.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockById } from './dev/mocks';
import { PokerTable } from './PokerTable';
import type { TableView } from './types';

afterEach(cleanup);

function mock(id: string): TableView {
  const m = mockById(id);
  if (m === undefined) throw new Error(`Mock ${id} fehlt`);
  return m.view;
}

function seatEl(seat: number): HTMLElement {
  const el = screen.getAllByTestId('seat').find((s) => s.dataset['seat'] === String(seat));
  if (el === undefined) throw new Error(`Sitz ${String(seat)} nicht gerendert`);
  return el;
}

describe('PokerTable – Krone am Gewinner (WP-039)', () => {
  it('ohne Ergebnis keine Krone', () => {
    render(<PokerTable view={mock('six-flop')} />);
    expect(screen.queryAllByTestId('winner-crown')).toEqual([]);
  });

  it('ein Gewinner: Krone nur an seinem Platz, benannt für Screenreader', () => {
    render(<PokerTable view={{ ...mock('six-flop'), winnerSeats: [1] }} />);
    const crowns = screen.getAllByTestId('winner-crown');
    expect(crowns).toHaveLength(1);
    expect(within(seatEl(1)).getByRole('img', { name: 'Lena gewinnt' })).toBe(crowns[0]);
    expect(seatEl(1)).toHaveAttribute('data-winner', 'true');
  });

  it('Split-Pot: alle Gewinner tragen eine Krone, auch der eigene Platz', () => {
    render(<PokerTable view={{ ...mock('six-flop'), winnerSeats: [0, 1] }} />);
    expect(screen.getAllByTestId('winner-crown')).toHaveLength(2);
    expect(within(seatEl(0)).getByTestId('winner-crown')).toBeInTheDocument();
    expect(within(seatEl(1)).getByTestId('winner-crown')).toBeInTheDocument();
    expect(within(seatEl(7)).queryByTestId('winner-crown')).toBeNull();
  });
});
