// Eine Verbindung für die ganze App (`ConnectionProvider`): echte Routen, gefälschter WebSocket, der Test spielt den Server.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LobbyTable, TableView as ServerTableView } from '@poker/engine/protocol';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { DEFAULT_SOUND, writeSoundPreference } from '../settings/sound';
import { TURN_VIBRATION } from '../sound/tableSounds';
import { json, mockApi, PLAYER } from '../test/mockApi';
import { fakeConnection } from './test/fakeSocket';
import { serverView, startGame, toAct, turnClockFor as clockFor, USERS } from './test/fixtures';
import { signalTurn } from './TurnBanner';

/** Ersatz für Zurück-Knopf bzw. Adresszeile des Browsers. */
function Browser() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <p data-testid="where">{location.pathname}</p>
      <button
        type="button"
        onClick={() => {
          void navigate('/leaderboard');
        }}
      >
        Adresse: Rangliste
      </button>
    </div>
  );
}

function renderApp(path: string) {
  mockApi({ 'GET /api/me': json(200, { user: PLAYER }), 'GET /api/leaderboard': json(200, { players: [] }) });
  const fake = fakeConnection({ welcome: { type: 'welcome', protocolVersion: 1, user: { ...USERS[1] } } });
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Browser />
        <AppRoutes createConnection={() => fake.connection} />
      </MemoryRouter>
    </AuthProvider>,
  );
  const server = (fn: () => void) => {
    act(fn);
  };
  const state = (table: ServerTableView) => {
    server(() => {
      fake.last().receive({ type: 'table.state', table });
    });
  };
  return { ...fake, server, state };
}

const lobbyTable = (id: number): LobbyTable => ({
  id,
  name: 'Testtisch',
  createdBy: { ...USERS[0] },
  status: 'running',
  seated: 3,
  maxSeats: 9,
  startingStack: 1500,
  blinds: { smallBlind: 10, bigBlind: 20 },
  blindType: 'increasing',
  turnTimeSeconds: 20,
  timeBankSeconds: 60,
});

afterEach(() => {
  writeSoundPreference(DEFAULT_SOUND);
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('Eine Verbindung für die ganze App', () => {
  it('bleibt beim Wechsel Lobby → Tisch → Lobby dieselbe und offen', async () => {
    const user = userEvent.setup();
    const app = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    await waitFor(() => {
      expect(app.sockets).toHaveLength(1);
    });
    app.server(() => {
      app.connect();
      app.last().receive({ type: 'lobby.snapshot', tables: [lobbyTable(42)] });
    });

    await user.click(screen.getByRole('button', { name: 'Zuschauen: Testtisch' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/table/42');
    app.state(serverView(startGame(), 99));
    await user.click(screen.getByRole('button', { name: 'Tisch-Menü' }));
    await user.click(screen.getByRole('button', { name: 'Tisch verlassen' }));

    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    expect(app.sockets).toHaveLength(1);
    expect(app.last().closed).toBeNull();
    expect(app.last().types()).toEqual([
      'hello',
      'lobby.subscribe',
      'lobby.unsubscribe',
      'table.join',
      'table.leave',
      'lobby.subscribe',
    ]);
  });

  it('Rangliste: „Du bist dran“ mit Vibration, ein Tipp führt an den Tisch', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const user = userEvent.setup();
    const game = startGame();
    const me = toAct(game);
    const app = renderApp('/table/42');
    await screen.findByText('Tisch wird geladen …');
    await waitFor(() => {
      expect(app.sockets).toHaveLength(1);
    });
    app.server(() => {
      app.connect();
    });
    app.state(serverView(game, me));

    // Weg vom Tisch (Zurück-Knopf): der Tisch bleibt beobachtet, man gilt als verbunden.
    await user.click(screen.getByRole('button', { name: 'Adresse: Rangliste' }));
    await screen.findByRole('heading', { level: 1, name: 'Rangliste' });
    expect(app.last().types()).not.toContain('table.unwatch');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    app.state(serverView(game, me, { turnClock: clockFor(game) }));
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Du bist dran an „Testtisch“');
    expect(vibrate).toHaveBeenCalledWith(TURN_VIBRATION);

    await user.click(within(banner).getByRole('link', { name: 'Zum Tisch' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/table/42');
    expect(app.last().sent.at(-1)).toEqual({ type: 'table.join', tableId: 42 });
    app.state(serverView(game, me, { turnClock: clockFor(game) }));
    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
    expect(app.sockets).toHaveLength(1);
  });

  it('ohne Vibration in den Einstellungen: Hinweis ja, Vibration nein', async () => {
    writeSoundPreference({ vibrate: false });
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const game = startGame();
    const me = toAct(game);
    const app = renderApp('/leaderboard');
    await screen.findByRole('heading', { level: 1, name: 'Rangliste' });
    await waitFor(() => {
      expect(app.sockets).toHaveLength(1);
    });
    app.server(() => {
      app.connect();
    });
    app.state(serverView(game, me, { turnClock: clockFor(game) }));
    expect(screen.getByRole('alert')).toHaveTextContent('Du bist dran');
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('signalTurn', () => {
  it.each([
    [{ enabled: true, vibrate: true }, true, true],
    [{ enabled: false, vibrate: true }, false, true],
    [{ enabled: true, vibrate: false }, true, false],
    [{ enabled: false, vibrate: false }, false, false],
  ])('%j → Ton %s, Vibration %s', (pref, sound, vibration) => {
    const engine = { setVolume: vi.fn(), play: vi.fn() };
    const vibrate = vi.fn();
    signalTurn({ ...DEFAULT_SOUND, ...pref }, engine, vibrate);
    expect(engine.play).toHaveBeenCalledTimes(sound ? 1 : 0);
    if (sound) expect(engine.play).toHaveBeenCalledWith('turn');
    expect(vibrate).toHaveBeenCalledTimes(vibration ? 1 : 0);
  });
});
