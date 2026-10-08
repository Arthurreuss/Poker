// Einstellungen → Konto löschen (WP-022).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { PLAYER, json, mockApi, requestBody } from '../test/mockApi';

function renderSettings() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function openForm() {
  await screen.findByRole('heading', { level: 1, name: 'Einstellungen' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Konto löschen …' }));
  return user;
}

describe('Konto löschen', () => {
  it('verlangt das Passwort, ohne den Server zu fragen', async () => {
    const fetchMock = mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderSettings();
    const user = await openForm();
    await user.click(screen.getByRole('button', { name: 'Konto endgültig löschen' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwort');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('zeigt den Fehler bei falschem Passwort und bleibt eingeloggt', async () => {
    mockApi({
      'GET /api/me': json(200, { user: PLAYER }),
      'DELETE /api/me': json(403, { error: 'invalid_credentials', message: 'Passwort ist falsch' }),
    });
    renderSettings();
    const user = await openForm();
    await user.type(screen.getByLabelText('Passwort zur Bestätigung'), 'falsch123');
    await user.click(screen.getByRole('button', { name: 'Konto endgültig löschen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwort ist falsch');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Einstellungen');
  });

  it('löscht das Konto und zeigt danach den Login mit Bestätigung', async () => {
    const fetchMock = mockApi({ 'GET /api/me': json(200, { user: PLAYER }), 'DELETE /api/me': json(204) });
    renderSettings();
    const user = await openForm();
    await user.type(screen.getByLabelText('Passwort zur Bestätigung'), 'geheim123');
    await user.click(screen.getByRole('button', { name: 'Konto endgültig löschen' }));

    await screen.findByRole('heading', { level: 1, name: 'Anmelden' });
    expect(screen.getByRole('status')).toHaveTextContent('Dein Konto wurde gelöscht.');
    const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/me' && init?.method === 'DELETE');
    expect(requestBody(call?.[1])).toEqual({ password: 'geheim123' });
  });
});
