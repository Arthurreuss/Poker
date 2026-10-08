// Impressum/Datenschutz (WP-022): ohne Login erreichbar, Footer mit Spielgeld-Hinweis und Links auf allen Seiten.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { PLAYER, json, mockApi, unauthorized } from '../test/mockApi';

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

function footer() {
  return within(screen.getByRole('contentinfo'));
}

describe('Rechtstexte', () => {
  it.each([
    ['/impressum', 'Impressum'],
    ['/datenschutz', 'Datenschutzerklärung'],
  ])('%s ist ohne Login erreichbar', async (path, title) => {
    mockApi({ 'GET /api/me': unauthorized() });
    renderApp(path);
    await heading(title);
    expect(footer().getByText('Spielgeld – kein Echtgeld')).toBeInTheDocument();
  });

  it('ist auch eingeloggt erreichbar', async () => {
    mockApi({ 'GET /api/me': json(200, { user: PLAYER }) });
    renderApp('/datenschutz');
    await heading('Datenschutzerklärung');
  });

  it('Impressum nennt den Anbieter, ohne offene Platzhalter', async () => {
    mockApi({ 'GET /api/me': unauthorized() });
    renderApp('/impressum');
    await heading('Impressum');
    expect(screen.getAllByText(/Arthur Reuss/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'poker@arthur-reuss.de' })).toHaveAttribute(
      'href',
      'mailto:poker@arthur-reuss.de',
    );
    expect(document.querySelectorAll('[data-placeholder]')).toHaveLength(0);
  });

  it('offene Angaben im Datenschutz-Entwurf sind sichtbar markiert', async () => {
    mockApi({ 'GET /api/me': unauthorized() });
    renderApp('/datenschutz');
    await heading('Datenschutzerklärung');
    for (const p of document.querySelectorAll('[data-placeholder]')) expect(p.textContent).toMatch(/^\[.+\]$/);
  });

  it.each([
    ['/login', 'Anmelden', unauthorized()],
    ['/register', 'Registrieren', unauthorized()],
    ['/', 'Lobby', json(200, { user: PLAYER })],
    ['/settings', 'Einstellungen', json(200, { user: PLAYER })],
  ])('Footer auf %s verlinkt Impressum und Datenschutz', async (path, title, me) => {
    mockApi({ 'GET /api/me': me });
    renderApp(path);
    await heading(title);
    expect(footer().getByText('Spielgeld – kein Echtgeld')).toBeInTheDocument();
    expect(footer().getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', '/impressum');
    expect(footer().getByRole('link', { name: 'Datenschutz' })).toHaveAttribute('href', '/datenschutz');
  });

  it('Link im Footer der Login-Seite öffnet das Impressum', async () => {
    mockApi({ 'GET /api/me': unauthorized() });
    renderApp('/login');
    await heading('Anmelden');
    await userEvent.click(footer().getByRole('link', { name: 'Impressum' }));
    await heading('Impressum');
  });
});
