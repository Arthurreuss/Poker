// @vitest-environment jsdom
// Showdown mit Krone (WP-039): Spielseite mit Fake-Verbindung und echten Engine-Ständen. Erst stehen die
// aufgedeckten Karten ohne Ergebnis da (Flip), nach SHOWDOWN_FLIP_MS erscheinen Gewinner, Krone und Auszahlung.
import type { TableView as ServerTableView } from '@poker/engine/protocol';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTable } from './GameTable';
import { useTableGame } from './hooks';
import { SHOWDOWN_FLIP_MS } from './presentation';
import { fakeConnection } from './test/fakeSocket';
import { act as play, serverView, startGame, type Game } from './test/fixtures';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
});

let stopAll: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const stop of stopAll) stop();
  stopAll = [];
});

function Page({ create }: { create: () => ReturnType<typeof fakeConnection>['connection'] }) {
  const [snapshot, store] = useTableGame(42, create);
  return <GameTable snapshot={snapshot} store={store} onLeave={() => undefined} />;
}

function renderGame() {
  const fake = fakeConnection({ welcome: { type: 'welcome', protocolVersion: 1, user: { id: 1, username: 'anna' } } });
  stopAll.push(() => {
    fake.connection.stop();
  });
  render(
    <MemoryRouter>
      <Page create={() => fake.connection} />
    </MemoryRouter>,
  );
  act(() => {
    fake.connect();
  });
  return (table: ServerTableView) => {
    act(() => {
      fake.last().receive({ type: 'table.state', table });
    });
  };
}

/** Alle checken bzw. callen bis zum River; liefert den Stand davor und den Showdown. */
function checkDown(game: Game): { before: ServerTableView; after: ServerTableView } {
  let before = serverView(game, 1);
  while (game.round.hand?.phase === 'betting') {
    before = serverView(game, 1);
    const hand = game.round.hand;
    const me = hand.players.find((p) => p.id === hand.toActId);
    play(game, { type: (me?.streetBet ?? 0) < hand.currentBet ? 'call' : 'check' });
  }
  return { before, after: serverView(game, 1) };
}

/** Erster Seed, dessen Showdown `winners` Gewinner hat und die Runde weiterlaufen lässt. */
function showdownWith(winners: number) {
  for (let seed = 1; seed < 400; seed++) {
    const game = startGame(3, seed);
    const { before, after } = checkDown(game);
    const ids = new Set(after.round?.hand?.showdown?.pots.flatMap((p) => p.winnerIds) ?? []);
    if (after.status === 'running' && ids.size === winners) return { before, after };
  }
  throw new Error('kein passender Seed');
}

const crowns = () => screen.queryAllByTestId('winner-crown');
const tick = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('Showdown mit Krone (GameTable, WP-039)', () => {
  it('Karten erst umdrehen, Gewinner mit Krone nach SHOWDOWN_FLIP_MS', () => {
    vi.useFakeTimers();
    const { before, after } = showdownWith(1);
    const state = renderGame();
    state(before);
    state(after);
    // Karten der Mitspieler sind offen (Flip läuft), Ergebnis noch zurückgehalten.
    expect(screen.getAllByTestId('hole-cards').filter((h) => h.dataset['kind'] === 'shown').length).toBeGreaterThan(0);
    expect(crowns()).toEqual([]);
    expect(document.querySelector('[data-winner="true"]')).toBeNull();
    expect(screen.queryByTestId('hand-result')).toBeNull();
    tick(SHOWDOWN_FLIP_MS - 1);
    expect(crowns()).toEqual([]);
    tick(1);
    const winner = document.querySelector<HTMLElement>('[data-winner="true"]');
    expect(winner).not.toBeNull();
    expect(crowns()).toHaveLength(1);
    expect(within(winner as HTMLElement).getByTestId('winner-crown')).toBeInTheDocument();
    expect(screen.getByTestId('hand-result')).toBeInTheDocument();
  });

  it('Split-Pot: alle Gewinner tragen eine Krone', () => {
    vi.useFakeTimers();
    const { before, after } = showdownWith(2);
    const state = renderGame();
    state(before);
    state(after);
    expect(crowns()).toEqual([]);
    tick(SHOWDOWN_FLIP_MS);
    expect(document.querySelectorAll('[data-winner="true"]')).toHaveLength(2);
    expect(crowns()).toHaveLength(2);
  });

  it('Reload mitten im Showdown: alles sofort, keine Verzögerung', () => {
    const { after } = showdownWith(1);
    const state = renderGame();
    state(after);
    expect(crowns()).toHaveLength(1);
  });
});
