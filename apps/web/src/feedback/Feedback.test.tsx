// Komponenten-Tests für das Feedback-Formular, den Dialog und den Einstieg in der App-Shell (WP-024).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { writeOrientationPreference } from '../settings/orientation';
import { PLAYER, json, mockApi, requestBody } from '../test/mockApi';
import { tableIdFromPath } from './context';
import { useFeedbackDialog } from './FeedbackDialog';
import { FeedbackForm } from './FeedbackForm';

const CREATED = json(201, { feedback: { id: 1, createdAt: '2026-10-08T12:00:00.000Z' } });

function sentBody(fetchMock: ReturnType<typeof mockApi>): unknown {
  const call = fetchMock.mock.calls.find(([url]) => url === '/api/feedback');
  return requestBody(call?.[1]);
}

describe('FeedbackForm', () => {
  it('sendet Kategorie, Text und Kontext und zeigt eine Bestätigung', async () => {
    writeOrientationPreference('landscape');
    const fetchMock = mockApi({ 'POST /api/feedback': CREATED });
    let closed = 0;
    render(
      <FeedbackForm
        page="/table/42"
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    const user = userEvent.setup();
    const send = screen.getByRole('button', { name: 'Senden' });
    expect(send).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Idee' }));
    await user.type(screen.getByLabelText('Deine Nachricht'), '  Mehr Tische bitte  ');
    expect(screen.getByText('21 / 2000')).toBeInTheDocument();
    await user.click(send);

    expect(await screen.findByRole('status')).toHaveTextContent('Dein Feedback ist angekommen.');
    expect(sentBody(fetchMock)).toEqual({
      category: 'idea',
      message: 'Mehr Tische bitte',
      page: '/table/42',
      tableId: 42,
      appVersion: 'test',
      orientation: 'landscape',
    });
    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(closed).toBe(1);
  });

  it('begrenzt den Text auf 2000 Zeichen und zeigt den Zähler', async () => {
    mockApi({});
    render(<FeedbackForm onClose={() => undefined} />);
    const textarea = screen.getByLabelText('Deine Nachricht');
    expect(textarea).toHaveAttribute('maxLength', '2000');
    expect(textarea).toHaveAccessibleDescription('0 / 2000');
    const user = userEvent.setup();
    await user.click(textarea);
    await user.paste('x'.repeat(2100));
    expect(textarea).toHaveValue('x'.repeat(2000));
    expect(screen.getByText('2000 / 2000')).toBeInTheDocument();
  });

  it('ohne Kategorie oder nur mit Leerzeichen lässt sich nichts senden', async () => {
    const fetchMock = mockApi({});
    render(<FeedbackForm onClose={() => undefined} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Deine Nachricht'), 'Text');
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Deine Nachricht'));
    await user.click(screen.getByRole('radio', { name: 'Bug' }));
    await user.type(screen.getByLabelText('Deine Nachricht'), '   ');
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zeigt Fehler des Servers (z. B. Rate-Limit) und behält die Eingabe', async () => {
    mockApi({
      'POST /api/feedback': json(429, { error: 'rate_limited', message: 'Zu viel Feedback in kurzer Zeit' }),
    });
    render(<FeedbackForm onClose={() => undefined} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Sonstiges' }));
    await user.type(screen.getByLabelText('Deine Nachricht'), 'Hallo');
    await user.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Zu viel Feedback in kurzer Zeit');
    expect(screen.getByLabelText('Deine Nachricht')).toHaveValue('Hallo');
    expect(screen.getByRole('radio', { name: 'Sonstiges' })).toBeChecked();
  });
});

/** So bindet z. B. das Tisch-Menü (WP-018) das Formular ein. */
function TableMenuExample() {
  const feedback = useFeedbackDialog({ tableId: 7, page: '/table/abc' });
  return (
    <>
      <button type="button" onClick={feedback.open}>
        Feedback senden
      </button>
      {feedback.dialog}
    </>
  );
}

describe('useFeedbackDialog', () => {
  it('öffnet den Dialog mit übergebener Tisch-ID, schließt mit Escape', async () => {
    writeOrientationPreference('portrait');
    const fetchMock = mockApi({ 'POST /api/feedback': CREATED });
    render(<TableMenuExample />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Feedback senden' }));
    const dialog = screen.getByRole('dialog', { name: 'Feedback senden' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Bug' })).toHaveFocus();

    await user.click(screen.getByRole('radio', { name: 'Bug' }));
    await user.type(screen.getByLabelText('Deine Nachricht'), 'Karte hängt');
    await user.click(screen.getByRole('button', { name: 'Senden' }));
    await screen.findByText('Dein Feedback ist angekommen.');
    expect(sentBody(fetchMock)).toMatchObject({ page: '/table/abc', tableId: 7, orientation: 'portrait' });

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feedback senden' })).toHaveFocus();
  });

  it('Abbrechen und Klick auf den Hintergrund schließen', async () => {
    mockApi({});
    render(<TableMenuExample />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Feedback senden' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Feedback senden' }));
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByTestId('feedback-backdrop') });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Feedback in der App-Shell', () => {
  it('Knopf „Feedback“ im Feedback-Slot öffnet das Formular', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Einstellungen' });
    const slot = document.querySelector('[data-slot="feedback"]');
    const button = screen.getByRole('button', { name: 'Feedback' });
    expect(slot?.contains(button)).toBe(true);
    await userEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Feedback senden' })).toBeInTheDocument();
    });
  });
});

describe('tableIdFromPath', () => {
  it.each([
    ['/table/42', 42],
    ['/table/42/', 42],
    ['/table/abc', null],
    ['/', null],
    ['/tables/1', null],
  ])('%s → %s', (path, expected) => {
    expect(tableIdFromPath(path)).toBe(expected);
  });
});
