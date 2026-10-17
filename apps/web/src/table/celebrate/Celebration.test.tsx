// @vitest-environment jsdom
// Feier nach der Hand und Sieger des Tisches (WP-040): Schriftzug immer, Lottie-Animationen nur mit `animate`.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CelebrationView } from '../types';
import { Celebration } from './Celebration';
import { TableWinner } from './TableWinner';

const players: { complete: () => void; destroyed: boolean }[] = [];

vi.mock('./lottie', () => ({
  loadLottie: () =>
    Promise.resolve(() => {
      const player: {
        complete: () => void;
        destroyed: boolean;
        destroy(): void;
        addEventListener(name: string, cb: () => void): void;
      } = {
        complete: () => undefined,
        destroyed: false,
        destroy() {
          player.destroyed = true;
        },
        addEventListener(_: string, cb: () => void) {
          player.complete = cb;
        },
      };
      players.push(player);
      return player;
    }),
}));

beforeEach(() => {
  players.length = 0;
});
afterEach(cleanup);

const flush: CelebrationView = {
  handNumber: 3,
  title: 'Flush',
  detail: 'Lena gewinnt 1.200',
  cards: ['Kh', 'Qh', 'Jh', 'Th', '2h'],
  confetti: 3,
  coins: 2,
};

describe('Celebration', () => {
  it('Schriftzug mit der Gewinnerhand und ihren fünf Karten in einer Reihe', () => {
    render(<Celebration celebration={flush} animate={false} />);
    const banner = screen.getByTestId('celebration-banner');
    expect(banner).toHaveTextContent('Flush');
    expect(banner).toHaveTextContent('Lena gewinnt 1.200');
    const cards = within(screen.getByTestId('celebration-cards')).getAllByRole('img');
    expect(cards.map((c) => c.dataset['card'])).toEqual(['Kh', 'Qh', 'Jh', 'Th', '2h']);
  });

  it('ohne Animationen keine Lottie-Animationen, nur der Schriftzug', () => {
    render(<Celebration celebration={flush} animate={false} />);
    expect(screen.queryAllByTestId('celebration-clip')).toHaveLength(0);
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
  ] as const)('Münz-Stufe %i → Konfetti plus Münzen = %i Animationen', (coins, clips) => {
    render(<Celebration celebration={{ ...flush, coins }} animate />);
    expect(screen.getAllByTestId('celebration-clip')).toHaveLength(clips);
  });

  it('Fold-out: Schriftzug ohne Karten', () => {
    render(
      <Celebration
        celebration={{
          handNumber: 4,
          title: 'Lena gewinnt',
          detail: 'Alle anderen haben gefoldet · 30',
          confetti: 4,
          coins: 0,
        }}
        animate={false}
      />,
    );
    expect(screen.getByTestId('celebration-banner')).toHaveTextContent('Lena gewinnt');
    expect(screen.queryByTestId('celebration-cards')).toBeNull();
  });

  it('eine Animation verschwindet nach dem Abspielen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Celebration celebration={{ ...flush, coins: 0 }} animate />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      await waitFor(() => {
        expect(players).toHaveLength(1);
      });
      act(() => {
        players[0]?.complete();
      });
      expect(screen.queryAllByTestId('celebration-clip')).toHaveLength(0);
      expect(players[0]?.destroyed).toBe(true);
      expect(screen.getByTestId('celebration-banner')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TableWinner', () => {
  it('zeigt Avatar und Namen des Siegers', () => {
    render(<TableWinner winners={[{ name: 'Lena', avatar: 'owl' }]} animate={false} />);
    const winner = screen.getByTestId('table-winner');
    expect(winner).toHaveAccessibleName('Lena gewinnt den Tisch');
    expect(winner).toHaveTextContent('Lena');
    expect(within(winner).getByTestId('avatar').dataset['avatar']).toBe('owl');
    expect(screen.queryAllByTestId('celebration-clip')).toHaveLength(0);
  });

  it('geteilter erster Platz: beide', () => {
    render(
      <TableWinner
        winners={[
          { name: 'Lena', avatar: null },
          { name: 'Mia', avatar: 'cat' },
        ]}
        animate
      />,
    );
    expect(screen.getByTestId('table-winner')).toHaveAccessibleName('Lena und Mia gewinnen den Tisch');
    expect(screen.getAllByTestId('celebration-clip')).toHaveLength(1);
  });
});
