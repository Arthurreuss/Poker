// Teilen-Button (WP-030): Handy → Teilen-Menü des Geräts, Desktop → Link kopieren mit Bestätigung.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { invitePath, tablePath } from './invite';
import { InviteShare } from './InviteShare';

function device({ touch, share }: { touch: boolean; share?: () => Promise<void> }) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: touch && query === '(pointer: coarse)', media: query }));
  if (share !== undefined) {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'share');
    });
  }
}

describe('InviteShare', () => {
  it('Handy: „Link teilen“ öffnet das Teilen-Menü des Geräts mit dem Link', async () => {
    const share = vi.fn(() => Promise.resolve());
    device({ touch: true, share });
    const user = userEvent.setup();
    render(<InviteShare path={invitePath('code_1')} tableName="Freitag" />);
    await user.click(screen.getByRole('button', { name: 'Link teilen' }));
    expect(share).toHaveBeenCalledWith({
      title: 'Einladung zum Pokertisch',
      text: 'Komm an meinen Tisch „Freitag“',
      url: `${window.location.origin}/join/code_1`,
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    // Kopieren bleibt als zweite Möglichkeit.
    expect(screen.getByRole('button', { name: 'Link kopieren' })).toBeInTheDocument();
  });

  it('Desktop: kein Teilen-Menü (auch wenn der Browser es kann), „Link kopieren“ kopiert mit Bestätigung', async () => {
    const share = vi.fn(() => Promise.resolve());
    device({ touch: false, share });
    const user = userEvent.setup();
    render(<InviteShare path={tablePath(9)} tableName="Offen" />);
    expect(screen.queryByRole('button', { name: 'Link teilen' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));
    const link = `${window.location.origin}/table/9`;
    expect(await navigator.clipboard.readText()).toBe(link);
    expect(screen.getByRole('status')).toHaveTextContent('Link kopiert');
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Einladungslink')).toHaveValue(link);
  });

  it('Handy ohne Erfolg im Teilen-Menü (Fehler, kein Abbruch): wird kopiert', async () => {
    const share = vi.fn(() => Promise.reject(new Error('nicht erlaubt')));
    device({ touch: true, share });
    const user = userEvent.setup();
    render(<InviteShare path={invitePath('x')} tableName="T" />);
    await user.click(screen.getByRole('button', { name: 'Link teilen' }));
    expect(await screen.findByText('Link kopiert')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/join/x`);
  });
});
