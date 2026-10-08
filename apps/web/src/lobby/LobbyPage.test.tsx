// Lobby- und Einladungsseite mit gefälschtem WebSocket (WP-015): der Test spielt den Server.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { LobbyTable } from '@poker/engine/protocol';
import { AuthProvider } from '../auth/AuthContext';
import { JoinPage } from '../pages/JoinPage';
import { LobbyPage } from '../pages/LobbyPage';
import { PLAYER, json, mockApi } from '../test/mockApi';
import { fakeSocketFactory, type FakeSocket } from './fakeSocket';
import { LobbySocketContext } from './useLobby';

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderAt(path: string) {
  mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
  const f = fakeSocketFactory();
  render(
    <AuthProvider>
      <LobbySocketContext value={f.factory}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<LobbyPage />} />
            <Route path="/join/:code" element={<JoinPage />} />
            <Route path="/table/:id" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </LobbySocketContext>
    </AuthProvider>,
  );
  return f;
}

/** Server-Nachricht zustellen (React-Updates in `act`). */
function server(socket: FakeSocket, fn: (s: FakeSocket) => void) {
  act(() => {
    fn(socket);
  });
}

const table = (id: number, patch: Partial<LobbyTable> = {}): LobbyTable => ({
  id,
  name: `Tisch ${String(id)}`,
  createdBy: { id: 1, username: 'arthur' },
  status: 'open',
  seated: 1,
  maxSeats: 6,
  startingStack: 1500,
  blinds: { smallBlind: 10, bigBlind: 20 },
  blindType: 'increasing',
  turnTimeSeconds: 20,
  timeBankSeconds: 60,
  ...patch,
});

describe('Lobby', () => {
  it('zeigt öffentliche Tische und aktualisiert live (ohne Reload)', async () => {
    const f = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    expect(screen.getByText('Tische werden geladen …')).toBeInTheDocument();
    server(f.latest(), (s) => {
      s.welcome();
      s.receive({ type: 'lobby.snapshot', tables: [] });
    });
    expect(screen.getByText(/kein öffentlicher Tisch/)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Verbindung: Verbunden' })).toBeInTheDocument();

    // Ein anderer Spieler erstellt einen Tisch → erscheint sofort.
    server(f.latest(), (s) => {
      s.receive({ type: 'lobby.update', table: table(5, { name: 'Freitagsrunde' }) });
    });
    const list = screen.getByRole('list', { name: 'Offene Tische' });
    const item = within(list).getByText('Freitagsrunde').closest('li') as HTMLElement;
    expect(item).toHaveTextContent('1/6 Spieler');
    expect(item).toHaveTextContent('Blinds 10/20 (steigend)');
    expect(item).toHaveTextContent('Stack 1.500');
    expect(item).toHaveTextContent('20 s + 60 s Zeitbank');
    expect(item).toHaveTextContent('Offen');

    // Runde startet → Status „Läuft“, Knopf „Zuschauen“.
    server(f.latest(), (s) => {
      s.receive({ type: 'lobby.update', table: table(5, { name: 'Freitagsrunde', status: 'running', seated: 3 }) });
    });
    expect(item).toHaveTextContent('Läuft');
    expect(item).toHaveTextContent('3/6 Spieler');
    expect(within(item).getByRole('button', { name: 'Zuschauen: Freitagsrunde' })).toBeInTheDocument();

    server(f.latest(), (s) => {
      s.receive({ type: 'lobby.remove', tableId: 5 });
    });
    expect(screen.queryByText('Freitagsrunde')).not.toBeInTheDocument();
  });

  it('Beitreten führt zu /table/:id', async () => {
    const f = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    server(f.latest(), (s) => {
      s.welcome();
      s.receive({ type: 'lobby.snapshot', tables: [table(8)] });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Beitreten: Tisch 8' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/table/8');
    // Lobby-Verbindung wird beim Verlassen geschlossen (die Tischseite verbindet sich selbst).
    expect(f.latest().closed).toEqual({ code: 1000, reason: 'lobby closed' });
  });

  it('öffentlichen Tisch erstellen → table.create, danach zum Tisch', async () => {
    const f = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    server(f.latest(), (s) => {
      s.welcome();
      s.receive({ type: 'lobby.snapshot', tables: [] });
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tisch erstellen' }));
    const form = screen.getByRole('form', { name: 'Tisch erstellen' });
    await user.click(within(form).getByRole('button', { name: 'Tisch erstellen' }));
    const sent = f.latest().last('table.create');
    expect(sent.settings).toMatchObject({ name: 'Tisch von spieler_1', isPublic: true, startingStack: 1500 });
    server(f.latest(), (s) => {
      s.receive({ type: 'table.created', requestId: sent.requestId ?? null, tableId: 21, inviteCode: 'pub' });
    });
    expect(await screen.findByTestId('where')).toHaveTextContent('/table/21');
  });

  it('privaten Tisch erstellen → Einladungslink zum Kopieren', async () => {
    // jsdom kennt keine Web Share API → nur „Link kopieren“ (Zwischenablage von user-event).
    expect('share' in navigator).toBe(false);
    const f = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    server(f.latest(), (s) => {
      s.welcome();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tisch erstellen' }));
    await user.click(screen.getByLabelText('Privat (nur per Einladungslink)'));
    const form = screen.getByRole('form', { name: 'Tisch erstellen' });
    await user.click(within(form).getByRole('button', { name: 'Tisch erstellen' }));
    const sent = f.latest().last('table.create');
    expect(sent.settings.isPublic).toBe(false);
    server(f.latest(), (s) => {
      s.receive({ type: 'table.created', requestId: sent.requestId ?? null, tableId: 4, inviteCode: 'geheim_42' });
    });

    const region = await screen.findByRole('region', { name: 'Privater Tisch erstellt' });
    const link = `${window.location.origin}/join/geheim_42`;
    expect(within(region).getByLabelText('Einladungslink')).toHaveValue(link);
    expect(within(region).queryByRole('button', { name: 'Link teilen' })).not.toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Link kopieren' }));
    expect(await navigator.clipboard.readText()).toBe(link);
    expect(await within(region).findByText('Link kopiert')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Zum Tisch' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/table/4');
  });

  it('Teilen über das Teilen-Menü des Geräts (Web Share API)', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    // Touch-Gerät: nur dort wird das Teilen-Menü angeboten (WP-030).
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', media: query }));
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'share');
    });
    const f = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    server(f.latest(), (s) => {
      s.welcome();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tisch erstellen' }));
    await user.clear(screen.getByLabelText('Tischname'));
    await user.type(screen.getByLabelText('Tischname'), 'Geheim');
    await user.click(screen.getByLabelText('Privat (nur per Einladungslink)'));
    await user.click(within(screen.getByRole('form')).getByRole('button', { name: 'Tisch erstellen' }));
    const sent = f.latest().last('table.create');
    server(f.latest(), (s) => {
      s.receive({ type: 'table.created', requestId: sent.requestId ?? null, tableId: 4, inviteCode: 'abc' });
    });
    await user.click(await screen.findByRole('button', { name: 'Link teilen' }));
    expect(share).toHaveBeenCalledWith({
      title: 'Einladung zum Pokertisch',
      text: 'Komm an meinen Tisch „Geheim“',
      url: `${window.location.origin}/join/abc`,
    });
  });

  it('anderer Tab übernimmt (4001) → Hinweis, „Hier weiterspielen“ verbindet neu', async () => {
    const f = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    server(f.latest(), (s) => {
      s.welcome();
      s.serverClose(4001);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('anderen Tab');
    await userEvent.click(screen.getByRole('button', { name: 'Hier weiterspielen' }));
    expect(f.sockets).toHaveLength(2);
  });
});

describe('Einladungsseite /join/:code', () => {
  it('tritt per Code bei und leitet zum Tisch weiter', async () => {
    const f = renderAt('/join/geheim_42');
    await screen.findByRole('heading', { level: 1, name: 'Einladung' });
    server(f.latest(), (s) => {
      s.welcome();
    });
    const join = f.latest().last('table.join');
    expect(join).toMatchObject({ inviteCode: 'geheim_42' });
    expect(f.latest().sent.some((m) => m.type === 'lobby.subscribe')).toBe(false);
    server(f.latest(), (s) => {
      s.receive({ type: 'table.state', table: { id: 9, inviteCode: 'geheim_42' } as never });
    });
    expect(await screen.findByTestId('where')).toHaveTextContent('/table/9');
  });

  it('ungültiger Code → Hinweis und Link zur Lobby', async () => {
    const f = renderAt('/join/falsch');
    await screen.findByRole('heading', { level: 1, name: 'Einladung' });
    server(f.latest(), (s) => {
      s.welcome();
    });
    const requestId = f.latest().last('table.join').requestId ?? null;
    server(f.latest(), (s) => {
      s.receive({ type: 'error', code: 'TABLE_NOT_FOUND', message: 'Tisch nicht gefunden', requestId, tableId: null });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('ungültig oder der Tisch existiert nicht mehr');
    expect(screen.getByRole('link', { name: 'Zur Lobby' })).toHaveAttribute('href', '/');
  });
});
