// Komponenten-Tests des Admin-Dashboards /admin/* (WP-029): Zugriff, Übersicht, Spieler-Aktionen mit Bestätigung,
// Passwort einmalig mit Kopier-Knopf, Tische schließen, Feedback erledigen, Protokoll mit Blättern.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_PAGE_SIZE, type AdminOverview, type AdminTable, type AdminUser, type AuditEntry } from '../api/admin';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ADMIN, PLAYER, json, mockApi, requestBody, type MockRoutes } from '../test/mockApi';

function renderAdmin(
  path: string,
  routes: MockRoutes,
  user: { id: number; username: string; isAdmin: boolean } = ADMIN,
) {
  const fetchMock = mockApi({ 'GET /api/me': json(200, { user }), ...routes });
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method);

const OVERVIEW: AdminOverview = {
  generatedAt: '2026-10-08T12:00:00.000Z',
  tables: { total: 3, open: 1, running: 2, seatedPlayers: 7 },
  onlineUsers: 9,
  rounds: {
    today: { started: 4, finished: 2, aborted: 1, running: 1 },
    week: { started: 23, finished: 21, aborted: 1, running: 1 },
    timeZone: 'Europe/Berlin',
    weekDays: 7,
  },
  feedbackNew: 5,
  health: { db: 'ok', dbLatencyMs: 1.3, uptimeSeconds: 3 * 86_400 + 4 * 3600, nodeVersion: 'v22.20.0', memoryMb: 87 },
};

function user(overrides: Partial<AdminUser>): AdminUser {
  return {
    id: 2,
    username: 'spieler_1',
    isAdmin: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    bannedAt: null,
    sessions: 2,
    ...overrides,
  };
}

const USERS: AdminUser[] = [
  user({ id: ADMIN.id, username: ADMIN.username, isAdmin: true, sessions: 1 }),
  user({ id: 3, username: 'admin_2', isAdmin: true }),
  user({}),
  user({ id: 4, username: 'gesperrt', bannedAt: '2026-10-01T10:00:00.000Z', sessions: 0 }),
];

const TABLE: AdminTable = {
  id: 7,
  name: 'Freitagsrunde',
  isPublic: false,
  status: 'running',
  createdBy: { id: 2, username: 'spieler_1' },
  maxSeats: 6,
  players: [
    { seat: 0, id: 2, username: 'spieler_1', connected: true },
    { seat: 1, id: 5, username: 'weg', connected: false },
  ],
  watchers: 1,
  roundId: 12,
  handNumber: 3,
};

const card = (name: string) => {
  const heading = screen.getByRole('heading', { level: 3, name });
  const li = heading.closest('li');
  if (li === null) throw new Error(`Karte ${name} fehlt`);
  return within(li);
};

describe('Zugriff', () => {
  it('Nicht-Admin sieht weder Menüpunkt noch Seite und lädt keine Admin-Daten', async () => {
    const fetchMock = renderAdmin('/admin', {}, PLAYER);
    await screen.findByRole('heading', { level: 1, name: 'Lobby' });
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin-Bereiche' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/admin'))).toBe(false);
  });

  it('Admin sieht Menüpunkt und Bereiche', async () => {
    renderAdmin('/admin', { 'GET /api/admin/overview': json(200, { overview: OVERVIEW }) });
    await screen.findByRole('heading', { level: 1, name: 'Admin' });
    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Admin-Bereiche' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Übersicht', 'Spieler', 'Tische', 'Feedback', 'Protokoll']);
    expect(within(nav).getByRole('link', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Übersicht', () => {
  it('zeigt Kennzahlen, Health und den Backup-Hinweis', async () => {
    renderAdmin('/admin', { 'GET /api/admin/overview': json(200, { overview: OVERVIEW }) });
    const tiles = within(await screen.findByLabelText('Kennzahlen'));
    expect(tiles.getByText('Aktive Tische').nextSibling).toHaveTextContent('3 · 2 laufend, 1 offen');
    expect(tiles.getByText('Spieler online').nextSibling).toHaveTextContent('9 · 7 am Tisch');
    expect(tiles.getByText('Runden heute').nextSibling).toHaveTextContent('4 · 2 beendet, 1 abgebrochen, 1 laufend');
    expect(tiles.getByText('Runden 7 Tage').nextSibling).toHaveTextContent('23');
    expect(tiles.getByText('Neues Feedback').nextSibling).toHaveTextContent('5');
    const health = within(screen.getByLabelText('Server-Health'));
    expect(health.getByText('Datenbank').nextSibling).toHaveTextContent('OK · 1.3 ms');
    expect(health.getByText('Läuft seit').nextSibling).toHaveTextContent('3 T 4 Std');
    expect(screen.getByText(/Letztes Backup/)).toHaveTextContent('npm run prod:status');
  });

  it('Datenbank weg: Fehler sichtbar, Zahlen als Strich', async () => {
    renderAdmin('/admin', {
      'GET /api/admin/overview': json(200, {
        overview: {
          ...OVERVIEW,
          rounds: null,
          feedbackNew: null,
          health: { ...OVERVIEW.health, db: 'error', dbLatencyMs: null },
        },
      }),
    });
    const health = within(await screen.findByLabelText('Server-Health'));
    expect(health.getByText('Datenbank').nextSibling).toHaveTextContent('Fehler');
    expect(screen.getByText('Runden heute').nextSibling).toHaveTextContent('–');
  });

  it('Aktualisieren lädt neu; Serverfehler wird angezeigt', async () => {
    let n = 0;
    renderAdmin('/admin', {
      'GET /api/admin/overview': () => {
        n += 1;
        return n === 1
          ? json(200, { overview: OVERVIEW })
          : json(500, { error: 'internal', message: 'Interner Fehler' });
      },
    });
    await screen.findByLabelText('Kennzahlen');
    await userEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Interner Fehler');
  });
});

describe('Spieler', () => {
  it('Liste: keine Sperre für Admins und sich selbst, Entsperren für Gesperrte; Suche mit Verzögerung', async () => {
    const fetchMock = renderAdmin('/admin/players', {
      'GET /api/admin/users': json(200, { users: USERS }),
      'GET /api/admin/users?search=sp': json(200, { users: [USERS[2]] }),
    });
    await screen.findByRole('heading', { level: 3, name: 'spieler_1' });
    expect(card(ADMIN.username).queryByRole('button', { name: 'Sperren' })).toBeNull();
    expect(card(ADMIN.username).getByText('Du')).toBeInTheDocument();
    expect(card('admin_2').queryByRole('button', { name: 'Sperren' })).toBeNull();
    expect(card('spieler_1').getByRole('button', { name: 'Sperren' })).toBeInTheDocument();
    expect(card('gesperrt').getByRole('button', { name: 'Entsperren' })).toBeInTheDocument();
    expect(card('gesperrt').queryByRole('button', { name: 'Abmelden' })).toBeNull();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Suche nach Namen' }), 'sp');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 3, name: 'gesperrt' })).toBeNull();
    });
    expect(calls(fetchMock, 'GET', '/api/admin/users?search=s')).toHaveLength(0);
  });

  it('Sperren nur nach Bestätigung, mit Begründung; Abbrechen sendet nichts', async () => {
    let banned = false;
    const fetchMock = renderAdmin('/admin/players', {
      'GET /api/admin/users': () =>
        json(200, { users: banned ? [user({ bannedAt: '2026-10-08T12:00:00.000Z', sessions: 0 })] : [user({})] }),
      'POST /api/admin/users/2/ban': () => {
        banned = true;
        return json(200, { user: user({ bannedAt: '2026-10-08T12:00:00.000Z' }) });
      },
    });
    const u = userEvent.setup();
    await screen.findByRole('heading', { level: 3, name: 'spieler_1' });

    await u.click(card('spieler_1').getByRole('button', { name: 'Sperren' }));
    let dialog = within(screen.getByRole('dialog', { name: 'spieler_1 sperren?' }));
    await u.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls(fetchMock, 'POST', '/api/admin/users/2/ban')).toHaveLength(0);

    await u.click(card('spieler_1').getByRole('button', { name: 'Sperren' }));
    dialog = within(screen.getByRole('dialog', { name: 'spieler_1 sperren?' }));
    await u.type(dialog.getByRole('textbox'), 'Beleidigungen im Chat');
    await u.click(dialog.getByRole('button', { name: 'Sperren' }));
    expect(await screen.findByText('spieler_1 ist gesperrt und wurde abgemeldet.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(requestBody(calls(fetchMock, 'POST', '/api/admin/users/2/ban')[0]?.[1])).toEqual({
      reason: 'Beleidigungen im Chat',
    });
    expect(await screen.findByText('Gesperrt')).toBeInTheDocument();
  });

  it('Fehler des Servers bleibt im Dialog sichtbar', async () => {
    renderAdmin('/admin/players', {
      'GET /api/admin/users': json(200, { users: [user({})] }),
      'POST /api/admin/users/2/sessions/revoke': json(404, { error: 'not_found', message: 'Spieler nicht gefunden' }),
    });
    const u = userEvent.setup();
    await screen.findByRole('heading', { level: 3, name: 'spieler_1' });
    await u.click(card('spieler_1').getByRole('button', { name: 'Abmelden' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Alle Anmeldungen von spieler_1 beenden?' }));
    await u.click(dialog.getByRole('button', { name: 'Abmelden' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Spieler nicht gefunden');
  });

  it('Passwort-Reset: Bestätigung, Passwort genau einmal mit Kopier-Knopf', async () => {
    renderAdmin('/admin/players', {
      'GET /api/admin/users': json(200, { users: [user({})] }),
      'POST /api/admin/users/2/password': json(200, { password: 'Xy7-geheim-Pw-16' }),
    });
    // userEvent.setup() bringt eine eigene Zwischenablage mit – erst danach beobachten.
    const u = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await screen.findByRole('heading', { level: 3, name: 'spieler_1' });
    await u.click(card('spieler_1').getByRole('button', { name: 'Passwort zurücksetzen' }));
    await u.click(
      within(screen.getByRole('dialog', { name: 'Passwort von spieler_1 zurücksetzen?' })).getByRole('button', {
        name: 'Passwort zurücksetzen',
      }),
    );

    const dialog = within(await screen.findByRole('dialog', { name: 'Neues Passwort für spieler_1' }));
    expect(dialog.getByTestId('reset-password')).toHaveTextContent('Xy7-geheim-Pw-16');
    // Escape schließt den Passwort-Dialog nicht versehentlich.
    await u.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Neues Passwort für spieler_1' })).toBeInTheDocument();
    await u.click(dialog.getByRole('button', { name: 'Kopieren' }));
    expect(writeText).toHaveBeenCalledWith('Xy7-geheim-Pw-16');
    expect(dialog.getByText('In die Zwischenablage kopiert.')).toBeInTheDocument();

    await u.click(dialog.getByRole('button', { name: 'Fertig' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Xy7-geheim-Pw-16')).toBeNull();
  });
});

describe('Tische', () => {
  it('zeigt Spieler mit Verbindungsstatus; Schließen nach Bestätigung mit Hinweis auf die abgebrochene Runde', async () => {
    let closed = false;
    const fetchMock = renderAdmin('/admin/tables', {
      'GET /api/admin/tables': () => json(200, { tables: closed ? [] : [TABLE] }),
      'POST /api/admin/tables/7/close': () => {
        closed = true;
        return json(200, { table: { tableId: 7, status: 'running', roundId: 12, seated: 2, roundAborted: true } });
      },
    });
    const u = userEvent.setup();
    await screen.findByRole('heading', { level: 3, name: 'Freitagsrunde' });
    const t = card('Freitagsrunde');
    expect(t.getByText('Privat')).toBeInTheDocument();
    expect(t.getByText(/Hand 3/)).toBeInTheDocument();
    expect(t.getByText('(getrennt)')).toBeInTheDocument();

    await u.click(t.getByRole('button', { name: 'Tisch schließen' }));
    const dialog = within(screen.getByRole('dialog', { name: '„Freitagsrunde“ schließen?' }));
    expect(dialog.getByText(/laufende Runde wird sofort abgebrochen/)).toBeInTheDocument();
    await u.click(dialog.getByRole('button', { name: 'Tisch schließen' }));
    expect(
      await screen.findByText('„Freitagsrunde“ geschlossen – die laufende Runde wurde ohne Punkte abgebrochen.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Gerade ist kein Tisch offen.')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/admin/tables/7/close')).toHaveLength(1);
  });

  it('Escape schließt den Bestätigungsdialog ohne Aktion', async () => {
    const fetchMock = renderAdmin('/admin/tables', { 'GET /api/admin/tables': json(200, { tables: [TABLE] }) });
    const u = userEvent.setup();
    await screen.findByRole('heading', { level: 3, name: 'Freitagsrunde' });
    await u.click(card('Freitagsrunde').getByRole('button', { name: 'Tisch schließen' }));
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls(fetchMock, 'POST', '/api/admin/tables/7/close')).toHaveLength(0);
  });
});

describe('Feedback im Dashboard', () => {
  it('lässt sich als erledigt markieren (Löschfrist-Hinweis D-025)', async () => {
    const item = {
      id: 1,
      userId: 2,
      username: 'spieler_1',
      category: 'bug',
      message: 'Knopf klemmt',
      page: null,
      tableId: null,
      appVersion: null,
      userAgent: null,
      orientation: null,
      status: 'new',
      createdAt: '2026-10-08T12:00:00.000Z',
    };
    const fetchMock = renderAdmin('/admin', {
      'GET /api/admin/overview': json(200, { overview: OVERVIEW }),
      'GET /api/admin/feedback?status=new': json(200, { feedback: [item], counts: { new: 1, read: 0, done: 0 } }),
      'PATCH /api/admin/feedback/1': json(200, { feedback: { ...item, status: 'done' } }),
    });
    const u = userEvent.setup();
    await u.click(
      within(await screen.findByRole('navigation', { name: 'Admin-Bereiche' })).getByRole('link', {
        name: 'Feedback',
      }),
    );
    expect(await screen.findByText(/30 Tage nach dem Erledigen automatisch gelöscht/)).toBeInTheDocument();
    await u.selectOptions(await screen.findByRole('combobox', { name: 'Status von #1' }), 'done');
    await waitFor(() => {
      expect(calls(fetchMock, 'PATCH', '/api/admin/feedback/1')).toHaveLength(1);
    });
    expect(requestBody(calls(fetchMock, 'PATCH', '/api/admin/feedback/1')[0]?.[1])).toEqual({ status: 'done' });
  });
});

describe('Protokoll', () => {
  const entry = (id: number, overrides: Partial<AuditEntry> = {}): AuditEntry => ({
    id,
    createdAt: '2026-10-08T12:00:00.000Z',
    action: 'user.ban',
    source: 'api',
    admin: { id: 1, username: 'arthur' },
    targetUser: { id: 2, username: 'spieler_1' },
    targetTableId: null,
    details: {},
    ...overrides,
  });

  it('zeigt Einträge lesbar, unbekannte Aktionen roh, und blättert', async () => {
    const firstPage = Array.from({ length: AUDIT_PAGE_SIZE }, (_, i) => entry(100 - i));
    firstPage[0] = entry(100, { details: { reason: 'Spam' } });
    firstPage[1] = entry(99, {
      action: 'table.close',
      targetUser: null,
      targetTableId: 7,
      admin: null,
      source: 'cli',
    });
    firstPage[2] = entry(98, { action: 'foo.bar' });
    const last = firstPage.at(-1)?.id ?? 0;
    renderAdmin('/admin/audit', {
      [`GET /api/admin/audit?limit=${String(AUDIT_PAGE_SIZE)}`]: json(200, { entries: firstPage }),
      [`GET /api/admin/audit?limit=${String(AUDIT_PAGE_SIZE)}&before=${String(last)}`]: json(200, {
        entries: [entry(1, { action: 'user.password_reset' })],
      }),
    });
    const list = within(await screen.findByRole('list', { name: 'Einträge' }));
    expect(list.getAllByText('Spieler gesperrt · spieler_1')[0]).toBeInTheDocument();
    expect(list.getByText('Begründung: Spam')).toBeInTheDocument();
    expect(list.getByText('Tisch geschlossen · Tisch #7')).toBeInTheDocument();
    expect(list.getByText(/von CLI · CLI/)).toBeInTheDocument();
    expect(list.getByText('foo.bar · spieler_1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByText('Passwort zurückgesetzt · spieler_1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull();
  });
});
