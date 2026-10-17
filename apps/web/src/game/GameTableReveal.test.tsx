// @vitest-environment jsdom
// Admin deckt am Tisch verdeckte Karten auf (WP-033, D-027): Spielseite mit Fake-Verbindung – Anfrage beim ersten
// Tipp, Antwort dreht um, Zurück- und erneutes Umdrehen ohne Anfrage, nach Handende vergessen; Nicht-Admins nie.
// Außerdem WP-035 (D-032): Tipp auf die eigenen Karten zieht neue.
import type { ServerMessage, TableView as ServerTableView } from '@poker/engine/protocol';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTable } from './GameTable';
import { useTableGame } from './hooks';
import { fakeConnection } from './test/fakeSocket';
import { act as playAction, serverView, startGame, USERS } from './test/fixtures';

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

function renderGame(viewer: number, isAdmin: boolean) {
  const user = USERS.find((u) => u.id === viewer) ?? USERS[0];
  const fake = fakeConnection({ welcome: { type: 'welcome', protocolVersion: 1, user: { ...user }, isAdmin } });
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
  const receive = (message: ServerMessage) => {
    act(() => {
      fake.last().receive(message);
    });
  };
  const state = (table: ServerTableView) => {
    receive({ type: 'table.state', table });
  };
  const reveals = () => fake.last().sent.filter((m) => m.type === 'admin.revealCards');
  const redraws = () => fake.last().sent.filter((m) => m.type === 'admin.redrawCards');
  return { ...fake, state, receive, reveals, redraws };
}

function seatEl(seat: number): HTMLElement {
  const el = screen.getAllByTestId('seat').find((s) => s.dataset['seat'] === String(seat));
  if (el === undefined) throw new Error(`Sitz ${String(seat)} nicht gerendert`);
  return el;
}

describe('Admin deckt Karten auf (GameTable)', () => {
  it('erster Tipp fragt an, Antwort dreht um; zurück und wieder ohne neue Anfrage; nach Handende vergessen', async () => {
    const user = userEvent.setup();
    const game = startGame();
    const { state, receive, reveals } = renderGame(1, true);
    state(serverView(game, 1));
    const button = () => within(seatEl(1)).getByRole('button', { name: /Karten von ben/ });

    await user.click(button());
    expect(reveals()).toEqual([{ type: 'admin.revealCards', tableId: 42, seat: 1, requestId: 'reveal:1' }]);
    expect(button().dataset['revealed']).toBe('false'); // Antwort steht noch aus

    const real = game.round.hand?.players.find((p) => p.id === '2')?.holeCards ?? [];
    receive({ type: 'admin.cards', requestId: 'reveal:1', tableId: 42, handNumber: 1, seat: 1, cards: [...real] });
    expect(button().dataset['revealed']).toBe('true');
    expect(
      within(button())
        .getAllByRole('img')
        .map((c) => c.dataset['card']),
    ).toEqual(real);

    await user.click(button());
    expect(button().dataset['revealed']).toBe('false');
    await user.click(button());
    expect(button().dataset['revealed']).toBe('true');
    expect(reveals()).toHaveLength(1);

    // Neuer Zustand derselben Hand: bleibt aufgedeckt.
    playAction(game, { type: 'call' });
    state(serverView(game, 1));
    expect(button().dataset['revealed']).toBe('true');

    // Hand endet (alle anderen folden) → Karten vergessen.
    while (game.round.hand?.phase === 'betting') playAction(game, { type: 'fold' });
    state(serverView(game, 1));
    expect(screen.queryAllByTestId('hole-cards').some((h) => h.dataset['revealed'] === 'true')).toBe(false);
  });

  it('Ablehnung durch den Server: Hinweis, Aktionsleiste bleibt unberührt', async () => {
    const user = userEvent.setup();
    const game = startGame();
    const { state, receive } = renderGame(1, true);
    state(serverView(game, 1));
    await user.click(within(seatEl(2)).getByRole('button', { name: /Karten von cleo/ }));
    receive({
      type: 'error',
      code: 'FORBIDDEN',
      message: 'Nur Admins können verdeckte Karten aufdecken',
      requestId: 'reveal:2',
      tableId: 42,
    });
    expect(screen.getByText('Nur Admins können verdeckte Karten aufdecken')).toBeInTheDocument();
    expect(within(seatEl(2)).getByRole('button').dataset['revealed']).toBe('false');
  });

  it('Nicht-Admin: verdeckte Karten sind kein Schalter', () => {
    const game = startGame();
    const player = renderGame(1, false);
    player.state(serverView(game, 1));
    expect(screen.getAllByTestId('hole-cards').some((h) => h.dataset['kind'] === 'hidden')).toBe(true);
    expect(screen.queryAllByRole('button', { name: /Karten von/ })).toEqual([]);
  });

  it('Admin, der nur zuschaut, kann nicht aufdecken', () => {
    const game = startGame(2);
    const { state } = renderGame(3, true); // cleo sitzt bei 2 Spielern nicht
    state(serverView(game, 3));
    expect(screen.getAllByTestId('hole-cards').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: /Karten von/ })).toEqual([]);
  });
});

describe('Admin zieht neue eigene Karten (GameTable)', () => {
  const redrawButton = () => screen.queryByRole('button', { name: 'Neue Karten ziehen' });

  it('Tipp auf die eigenen Karten sendet admin.redrawCards, beliebig oft; Ablehnung erscheint als Hinweis', async () => {
    const user = userEvent.setup();
    const game = startGame();
    const { state, receive, redraws } = renderGame(1, true);
    state(serverView(game, 1));
    const button = redrawButton();
    if (button === null) throw new Error('kein Schalter');
    expect(button.dataset['kind']).toBe('visible');

    await user.click(button);
    await user.click(button);
    expect(redraws()).toEqual([
      { type: 'admin.redrawCards', tableId: 42, requestId: 'redraw:1' },
      { type: 'admin.redrawCards', tableId: 42, requestId: 'redraw:2' },
    ]);

    receive({
      type: 'error',
      code: 'NO_HAND_IN_PROGRESS',
      message: 'Gerade läuft keine Hand',
      requestId: 'redraw:2',
      tableId: 42,
    });
    expect(screen.getByText('Gerade läuft keine Hand')).toBeInTheDocument();
  });

  it('nicht für Nicht-Admins', () => {
    const game = startGame();
    const player = renderGame(1, false);
    player.state(serverView(game, 1));
    expect(redrawButton()).toBeNull();
  });

  it('nach dem Fold des Admins kein Schalter mehr', () => {
    const game = startGame();
    const { state } = renderGame(1, true);
    while (game.round.hand?.toActId !== '1') playAction(game, { type: 'call' });
    playAction(game, { type: 'fold' });
    state(serverView(game, 1));
    expect(redrawButton()).toBeNull();
  });
});
