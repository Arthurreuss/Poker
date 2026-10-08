// Einstellungen → Avatar und Reaktionen (WP-032).
import { AVATAR_IDS } from '@poker/engine/protocol';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { PLAYER, json, mockApi, requestBody } from '../test/mockApi';
import { REACTIONS_STORAGE_KEY } from './reactions';

function renderSettings() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe('Einstellungen – Avatar', () => {
  it('zeigt alle Avatare plus „Kein Avatar“ und speichert die Wahl sofort', async () => {
    const fetchMock = mockApi({
      'GET /api/me': json(200, { user: PLAYER }),
      'PUT /api/me/avatar': (init) => json(200, { user: { ...PLAYER, ...(requestBody(init) as object) } }),
    });
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Avatar' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(AVATAR_IDS.length + 1);
    expect(within(group).getByRole('radio', { name: 'Kein Avatar' })).toBeChecked();

    const user = userEvent.setup();
    await user.click(within(group).getByRole('radio', { name: 'Fuchs' }));
    await waitFor(() => {
      expect(within(group).getByRole('radio', { name: 'Fuchs' })).toBeChecked();
    });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe('/api/me/avatar');
    expect(requestBody(put?.[1])).toEqual({ avatar: 'fox' });

    await user.click(within(group).getByRole('radio', { name: 'Kein Avatar' }));
    await waitFor(() => {
      expect(within(group).getByRole('radio', { name: 'Kein Avatar' })).toBeChecked();
    });
    expect(requestBody(fetchMock.mock.calls.at(-1)?.[1])).toEqual({ avatar: null });
  });

  it('Fehler beim Speichern: Meldung, alte Wahl bleibt', async () => {
    mockApi({
      'GET /api/me': json(200, { user: { ...PLAYER, avatar: 'owl' } }),
      'PUT /api/me/avatar': json(400, { error: 'invalid_request', message: 'Unbekannter Avatar' }),
    });
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Avatar' });
    expect(within(group).getByRole('radio', { name: 'Eule' })).toBeChecked();
    await userEvent.setup().click(within(group).getByRole('radio', { name: 'Hund' }));
    expect(await within(group).findByRole('alert')).toHaveTextContent('Unbekannter Avatar');
    expect(within(group).getByRole('radio', { name: 'Eule' })).toBeChecked();
  });
});

describe('Einstellungen – Reaktionen', () => {
  it('Schalter ist standardmäßig an und speichert lokal', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderSettings();
    const box = await screen.findByRole('checkbox', { name: 'Emoji-Reaktionen anzeigen und senden' });
    expect(box).toBeChecked();
    await userEvent.setup().click(box);
    expect(box).not.toBeChecked();
    expect(window.localStorage.getItem(REACTIONS_STORAGE_KEY)).toBe('off');
  });
});
