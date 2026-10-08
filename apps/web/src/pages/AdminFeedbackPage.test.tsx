// Komponenten-Tests für /admin/feedback (WP-024).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { FeedbackItem } from '../api';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ADMIN, PLAYER, json, mockApi, requestBody, type MockRoutes } from '../test/mockApi';

function item(overrides: Partial<FeedbackItem>): FeedbackItem {
  return {
    id: 1,
    userId: 2,
    username: 'spieler_1',
    category: 'bug',
    message: 'Call-Button reagiert nicht',
    page: '/table/7',
    tableId: 7,
    appVersion: 'abc1234',
    userAgent: 'Mozilla/5.0 Test',
    orientation: 'portrait',
    status: 'new',
    createdAt: '2026-10-08T12:00:00.000Z',
    ...overrides,
  };
}

const COUNTS = { new: 2, read: 0, done: 1 };
const NEW_ITEMS = [item({ id: 2, category: 'idea', message: 'Mehr Avatare', userId: null, username: null }), item({})];

function renderAdmin(routes: MockRoutes, user = ADMIN) {
  const fetchMock = mockApi({ 'GET /api/me': json(200, { user }), ...routes });
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/admin/feedback']}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
  return fetchMock;
}

describe('/admin/feedback', () => {
  it('zeigt neues Feedback mit Kontext, anonymisierte Einträge und Zähler', async () => {
    renderAdmin({ 'GET /api/admin/feedback?status=new': json(200, { feedback: NEW_ITEMS, counts: COUNTS }) });
    await screen.findByRole('heading', { level: 2, name: 'Feedback' });
    const entries = await screen.findAllByRole('article');
    expect(entries).toHaveLength(2);
    expect(within(entries[0] as HTMLElement).getByRole('heading')).toHaveTextContent('#2 von gelöschtem Account');
    const second = within(entries[1] as HTMLElement);
    expect(second.getByText('Call-Button reagiert nicht')).toBeInTheDocument();
    expect(second.getByText('Seite /table/7 · Tisch 7 · Version abc1234 · Hochformat')).toBeInTheDocument();
    expect(second.getByText('Mozilla/5.0 Test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu (2)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Erledigt (1)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Alle (3)' })).toBeInTheDocument();
  });

  it('filtert nach Status', async () => {
    const fetchMock = renderAdmin({
      'GET /api/admin/feedback?status=new': json(200, { feedback: NEW_ITEMS, counts: COUNTS }),
      'GET /api/admin/feedback?status=done': json(200, {
        feedback: [item({ id: 3, message: 'Erledigtes', status: 'done' })],
        counts: COUNTS,
      }),
      'GET /api/admin/feedback': json(200, { feedback: [], counts: { new: 0, read: 0, done: 0 } }),
    });
    await screen.findAllByRole('article');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Erledigt/ }));
    expect(await screen.findByText('Erledigtes')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /^Alle/ }));
    expect(await screen.findByText('Kein Feedback.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/admin/feedback');
  });

  it('ändert den Status und lädt die Liste neu', async () => {
    let listCalls = 0;
    const fetchMock = renderAdmin({
      'GET /api/admin/feedback?status=new': () => {
        listCalls += 1;
        return listCalls === 1
          ? json(200, { feedback: NEW_ITEMS, counts: COUNTS })
          : json(200, { feedback: [NEW_ITEMS[0]], counts: { new: 1, read: 1, done: 1 } });
      },
      'PATCH /api/admin/feedback/1': json(200, { feedback: item({ status: 'read' }) }),
    });
    await screen.findAllByRole('article');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status von #1' }), 'read');
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(1);
    });
    expect(screen.getByRole('button', { name: 'Gelesen (1)' })).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/admin/feedback/1' && init?.method === 'PATCH',
    );
    expect(requestBody(patch?.[1])).toEqual({ status: 'read' });
  });

  it('zeigt Fehler beim Statuswechsel', async () => {
    renderAdmin({
      'GET /api/admin/feedback?status=new': json(200, { feedback: NEW_ITEMS, counts: COUNTS }),
      'PATCH /api/admin/feedback/1': json(404, { error: 'not_found', message: 'Feedback nicht gefunden' }),
    });
    await screen.findAllByRole('article');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status von #1' }), 'done');
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback nicht gefunden');
  });

  it('Fehler des Servers (403) wird angezeigt', async () => {
    renderAdmin({
      'GET /api/admin/feedback?status=new': json(403, { error: 'forbidden', message: 'Nur für Admins' }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Nur für Admins');
  });

  it('normale Spieler landen in der Lobby, ohne dass Feedback geladen wird', async () => {
    const fetchMock = renderAdmin({}, PLAYER);
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    expect(fetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/admin'))).toBe(false);
  });
});
