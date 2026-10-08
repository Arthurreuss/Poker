// @vitest-environment jsdom
import type { RoundStanding } from '@poker/engine';
import type { TableView as ServerTableView } from '@poker/engine/protocol';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTable } from './GameTable';
import { useTableGame } from './hooks';
import { fakeConnection } from './test/fakeSocket';
import { serverView, startGame, toAct, USERS } from './test/fixtures';

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
  for (const stop of stopAll) stop();
  stopAll = [];
});

function Page({ create }: { create: () => ReturnType<typeof fakeConnection>['connection'] }) {
  const [snapshot, store] = useTableGame(42, create);
  return <GameTable snapshot={snapshot} store={store} onLeave={() => undefined} />;
}

function renderGame(viewer: number) {
  const user = USERS.find((u) => u.id === viewer) ?? USERS[0];
  const fake = fakeConnection({ welcome: { type: 'welcome', protocolVersion: 1, user: { ...user } } });
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
  const state = (table: ServerTableView) => {
    act(() => {
      fake.last().receive({ type: 'table.state', table });
    });
  };
  return { ...fake, state };
}

describe('GameTable', () => {
  it('lädt, zeigt die Aktionsleiste am Zug und sendet die Aktion', async () => {
    const user = userEvent.setup();
    const game = startGame();
    const me = toAct(game);
    const { state, last } = renderGame(me);
    expect(screen.getByText('Tisch wird geladen …')).toBeInTheDocument();
    state(serverView(game, me));
    const bar = screen.getByTestId('action-bar');
    expect(bar.dataset['mode']).toBe('turn');
    await user.click(within(bar).getByRole('button', { name: 'Fold' }));
    expect(last().sent.at(-1)).toMatchObject({ type: 'table.action', tableId: 42, action: { type: 'fold' } });
    expect(within(bar).getByRole('button', { name: 'Fold' })).toBeDisabled();
  });

  it('nicht am Zug: Vorab-Aktionen', () => {
    const game = startGame();
    const me = (toAct(game) % 3) + 1;
    const { state } = renderGame(me);
    state(serverView(game, me));
    expect(screen.getByTestId('action-bar').dataset['mode']).toBe('pre');
    expect(screen.getByRole('button', { name: 'Call any' })).toBeInTheDocument();
  });

  it('vor dem Start: Ersteller startet die Runde', async () => {
    const user = userEvent.setup();
    const { state, last } = renderGame(1);
    state(serverView(null, 1));
    await user.click(screen.getByRole('button', { name: 'Runde starten' }));
    expect(last().sent.at(-1)).toEqual({ type: 'table.start', tableId: 42 });
    expect(screen.getByRole('button', { name: 'Aufstehen' })).toBeInTheDocument();
  });

  it('Verbindungsabbruch: Hinweis mit „Jetzt verbinden“', async () => {
    const user = userEvent.setup();
    const { state, last, sockets } = renderGame(1);
    state(serverView(startGame(), 1));
    act(() => {
      last().serverClose(1006);
    });
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Verbindung unterbrochen');
    await user.click(screen.getByRole('button', { name: 'Jetzt verbinden' }));
    expect(sockets).toHaveLength(2);
  });

  it('anderer Tab übernimmt: Hinweis und bewusst zurückholen', () => {
    const { last } = renderGame(1);
    act(() => {
      last().serverClose(4001);
    });
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('anderen Tab');
    expect(screen.getByRole('button', { name: 'Hier weiterspielen' })).toBeInTheDocument();
  });

  it('Rundenende: Platzierungen mit geteilten Plätzen und Punkten', async () => {
    const user = userEvent.setup();
    const standings: RoundStanding[] = [
      { playerId: '1', seat: 0, placement: 1, sharedPlacement: false, points: 10 },
      { playerId: '2', seat: 1, placement: 2, sharedPlacement: true, points: 4 },
      { playerId: '3', seat: 2, placement: 2, sharedPlacement: true, points: 4 },
    ];
    const { state } = renderGame(1);
    const view = serverView(startGame(), 1);
    if (view.round === null) throw new Error();
    state({ ...view, status: 'finished', round: { ...view.round, phase: 'finished', standings } });
    const dialog = screen.getByRole('dialog', { name: 'Runde beendet' });
    expect(within(dialog).getByText('Du hast gewonnen!')).toBeInTheDocument();
    const rows = within(dialog).getAllByTestId('standing');
    expect(rows.map((r) => r.textContent)).toEqual(['1.anna10', '2.–3. (geteilt)ben4', '2.–3. (geteilt)cleo4']);
    await user.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ergebnis' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
