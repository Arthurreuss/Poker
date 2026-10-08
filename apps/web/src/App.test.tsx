import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ADMIN, PLAYER, json, mockApi, requestBody, unauthorized } from './test/mockApi';

function renderApp(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('Geschützte Routen', () => {
  it('leitet ohne Login auf /login um und nach dem Login zurück zur Zielseite', async () => {
    const fetchMock = mockApi({
      'GET /api/me': unauthorized(),
      'POST /api/login': json(200, { user: PLAYER }),
    });
    renderApp('/settings');
    await heading('Anmelden');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Benutzername'), 'spieler_1');
    await user.type(screen.getByLabelText('Passwort'), 'geheim123');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    await heading('Einstellungen');
    const loginCall = fetchMock.mock.calls.find(([url]) => url === '/api/login');
    expect(requestBody(loginCall?.[1])).toEqual({ username: 'spieler_1', password: 'geheim123' });
  });

  it('eingeloggt bleibt man auf der Seite', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderApp('/leaderboard');
    await heading('Rangliste');
  });

  it('/login leitet Eingeloggte zur Lobby', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderApp('/login');
    await heading('Lobby');
  });

  it('/table/:id verbindet sich mit dem Tisch (WP-018)', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    const urls: string[] = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        onopen = null;
        onmessage = null;
        onclose = null;
        onerror = null;
        readyState = 0;
        constructor(url: string) {
          urls.push(url);
        }
        send() {}
        close() {}
      },
    );
    renderApp('/table/42');
    expect(await screen.findByText('Tisch wird geladen …')).toBeInTheDocument();
    expect(urls).toEqual([expect.stringMatching(/\/ws$/)]);
  });

  it('/table/:id ohne gültige Nummer', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderApp('/table/abc');
    await heading('Tisch nicht gefunden');
  });
});

describe('Login', () => {
  it('prüft Pflichtfelder ohne Serveraufruf', async () => {
    const fetchMock = mockApi({ 'GET /api/me': unauthorized() });
    renderApp('/login');
    await heading('Anmelden');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(screen.getByText('Benutzername fehlt')).toBeInTheDocument();
    expect(screen.getByText('Passwort fehlt')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/login')).toBe(false);
  });

  it.each([
    [401, 'invalid_credentials', 'Benutzername oder Passwort ist falsch'],
    [429, 'rate_limited', 'Zu viele Versuche – bitte kurz warten'],
  ])('zeigt Serverfehler %i (%s)', async (status, error, message) => {
    mockApi({ 'GET /api/me': unauthorized(), 'POST /api/login': json(status, { error, message }) });
    renderApp('/login');
    await heading('Anmelden');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Benutzername'), 'spieler_1');
    await user.type(screen.getByLabelText('Passwort'), 'falsch123');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Anmelden');
  });

  it('zeigt Hinweis, wenn der Server nicht erreichbar ist', async () => {
    mockApi({ 'GET /api/me': unauthorized(), 'POST /api/login': new TypeError('Failed to fetch') });
    renderApp('/login');
    await heading('Anmelden');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Benutzername'), 'spieler_1');
    await user.type(screen.getByLabelText('Passwort'), 'geheim123');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server nicht erreichbar');
  });
});

describe('Registrierung', () => {
  async function fillAndSubmit(username: string, password: string, repeat = password) {
    const user = userEvent.setup();
    if (username !== '') await user.type(screen.getByLabelText('Benutzername'), username);
    if (password !== '') await user.type(screen.getByLabelText('Passwort'), password);
    if (repeat !== '') await user.type(screen.getByLabelText('Passwort wiederholen'), repeat);
    await user.click(screen.getByRole('button', { name: 'Konto anlegen' }));
  }

  it('zeigt den Spielgeld-Hinweis (D-001)', async () => {
    mockApi({ 'GET /api/me': unauthorized() });
    renderApp('/register');
    await heading('Registrieren');
    expect(screen.getByText(/Spielgeld – kein Echtgeld/)).toBeInTheDocument();
  });

  it.each([
    ['ab', 'geheim123', 'geheim123', 'Benutzername muss 3–20 Zeichen lang sein'],
    ['mit leer', 'geheim123', 'geheim123', 'Benutzername darf nur Buchstaben'],
    ['spieler', 'kurz', 'kurz', 'Passwort muss mindestens 8 Zeichen lang sein'],
    ['spieler', 'geheim123', 'geheim124', 'Passwörter stimmen nicht überein'],
  ])('validiert %j/%j clientseitig', async (username, password, repeat, message) => {
    const fetchMock = mockApi({ 'GET /api/me': unauthorized() });
    renderApp('/register');
    await heading('Registrieren');
    await fillAndSubmit(username, password, repeat);
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/register')).toBe(false);
  });

  it.each([
    [409, 'username_taken', 'Benutzername ist bereits vergeben'],
    [429, 'rate_limited', 'Zu viele Versuche – bitte kurz warten'],
    [400, 'invalid_request', 'Passwort darf höchstens 128 Zeichen lang sein'],
  ])('zeigt Serverfehler %i (%s)', async (status, error, message) => {
    mockApi({ 'GET /api/me': unauthorized(), 'POST /api/register': json(status, { error, message }) });
    renderApp('/register');
    await heading('Registrieren');
    await fillAndSubmit('spieler_1', 'geheim123');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('meldet nach Erfolg direkt an und zeigt die Lobby', async () => {
    const fetchMock = mockApi({ 'GET /api/me': unauthorized(), 'POST /api/register': json(201, { user: PLAYER }) });
    renderApp('/register');
    await heading('Registrieren');
    await fillAndSubmit('spieler_1', 'geheim123');
    await heading('Lobby');
    expect(screen.getByText(/Hallo spieler_1/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/register');
    expect(requestBody(call?.[1])).toEqual({ username: 'spieler_1', password: 'geheim123' });
  });
});

describe('App-Shell', () => {
  it('zeigt Menü ohne Admin für normale Spieler', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderApp('/');
    await heading('Lobby');
    const nav = screen.getByRole('navigation', { name: 'Hauptmenü' });
    for (const name of ['Lobby', 'Rangliste', 'Einstellungen']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(nav.querySelector('[data-slot]')).toBeNull();
    expect(document.querySelector('[data-slot="feedback"]')).not.toBeNull();
  });

  it('zeigt Admin-Menü nur für Admins', async () => {
    mockApi({ 'GET /api/me': json(200, { user: ADMIN }) });
    renderApp('/');
    await heading('Lobby');
    await userEvent.click(screen.getByRole('link', { name: 'Admin' }));
    await heading('Admin');
  });

  it('/admin leitet Nicht-Admins zur Lobby', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderApp('/admin/feedback');
    await heading('Lobby');
  });

  it('/admin/* ist für Admins erreichbar', async () => {
    mockApi({ 'GET /api/me': json(200, { user: ADMIN }) });
    renderApp('/admin/feedback');
    await heading('Admin');
  });

  it('Abmelden ruft den Server, zeigt den Login und danach geht es zur Lobby', async () => {
    const fetchMock = mockApi({
      'GET /api/me': json(200, { user: PLAYER }),
      'POST /api/logout': json(204),
      'POST /api/login': json(200, { user: PLAYER }),
    });
    renderApp('/settings');
    await heading('Einstellungen');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Abmelden/ }));
    await heading('Anmelden');
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/logout')).toBe(true);
    });
    // Kein Rücksprung auf die Seite, auf der man sich abgemeldet hat.
    await user.type(screen.getByLabelText('Benutzername'), 'spieler_1');
    await user.type(screen.getByLabelText('Passwort'), 'geheim123');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    await heading('Lobby');
  });

  it('Einstellungen speichern die Ausrichtung', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderApp('/settings');
    await heading('Einstellungen');
    expect(screen.getByLabelText('Automatisch (Gerät)')).toBeChecked();
    await userEvent.click(screen.getByLabelText('Querformat'));
    expect(screen.getByLabelText('Querformat')).toBeChecked();
    expect(window.localStorage.getItem('poker.orientation')).toBe('landscape');
  });

  it('Einstellungen schalten die Animationen am Tisch ab (WP-018)', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderApp('/settings');
    await heading('Einstellungen');
    const toggle = screen.getByLabelText('Animationen (Karten, Chips)');
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(window.localStorage.getItem('poker.animations')).toBe('off');
  });
});
