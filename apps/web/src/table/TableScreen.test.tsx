// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORIENTATION_STORAGE_KEY, writeOrientationPreference } from '../settings/orientation';
import { mockById } from './dev/mocks';
import { PokerTable } from './PokerTable';
import { TableScreen } from './TableScreen';
import { LANDSCAPE_QUERY } from './useTableLayout';
import type { TableView } from './types';

function mock(id: string): TableView {
  const m = mockById(id);
  if (m === undefined) throw new Error(`Mock ${id} fehlt`);
  return m.view;
}

/** Stellvertreter für Zustand im Tisch (z. B. Raise-Betrag der Aktionsleiste, WP-018). */
function Counter() {
  const [n, setN] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        setN((x) => x + 1);
      }}
    >
      Zähler {n}
    </button>
  );
}

/** Steuerbares matchMedia für `(orientation: landscape)`. */
function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query === LANDSCAPE_QUERY && matches;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    })),
  );
  return {
    rotate(landscape: boolean) {
      matches = landscape;
      act(() => {
        for (const l of listeners) l();
      });
    },
  };
}

function layoutOf(): string | undefined {
  return screen.getByTestId('poker-table').dataset['layout'];
}

beforeEach(() => {
  window.localStorage.removeItem(ORIENTATION_STORAGE_KEY);
  writeOrientationPreference('auto');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PokerTable – Layoutwechsel', () => {
  it('rendert das gewählte Layout', () => {
    render(<PokerTable view={mock('six-flop')} layout="landscape" />);
    expect(layoutOf()).toBe('landscape');
    expect(screen.getByTestId('poker-table').className).toContain('pt-root--landscape');
  });

  it('Wechsel mountet nichts neu: DOM-Knoten und Zustand in der Aktionsleiste bleiben', () => {
    const view = mock('six-flop');
    const { rerender } = render(<PokerTable view={view} layout="portrait" actionBar={<Counter />} />);
    const root = screen.getByTestId('poker-table');
    const seat = screen.getAllByTestId('seat')[1];
    fireEvent.click(screen.getByRole('button', { name: 'Zähler 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zähler 1' }));

    rerender(<PokerTable view={view} layout="landscape" actionBar={<Counter />} />);

    expect(layoutOf()).toBe('landscape');
    expect(screen.getByTestId('poker-table')).toBe(root);
    expect(screen.getAllByTestId('seat')[1]).toBe(seat);
    expect(screen.getByRole('button', { name: 'Zähler 2' })).toBeTruthy();
  });
});

describe('TableScreen – Umschalter (D-009)', () => {
  it('auto folgt der Gerätelage live', () => {
    const media = fakeMatchMedia(false);
    render(<TableScreen view={mock('six-flop')} />);
    expect(layoutOf()).toBe('portrait');
    media.rotate(true);
    expect(layoutOf()).toBe('landscape');
    media.rotate(false);
    expect(layoutOf()).toBe('portrait');
  });

  it('ohne matchMedia (z. B. alte Browser) gilt Hochformat', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<TableScreen view={mock('six-flop')} />);
    expect(layoutOf()).toBe('portrait');
  });

  it('erzwungenes Layout gilt unabhängig von der Gerätelage', () => {
    fakeMatchMedia(false);
    writeOrientationPreference('landscape');
    render(<TableScreen view={mock('six-flop')} />);
    expect(layoutOf()).toBe('landscape');
  });

  it('Tisch-Menü schaltet um, speichert die Einstellung und verliert keinen Zustand', () => {
    const media = fakeMatchMedia(false);
    render(<TableScreen view={mock('six-flop')} actionBar={<Counter />} />);
    const root = screen.getByTestId('poker-table');
    fireEvent.click(screen.getByRole('button', { name: 'Zähler 0' }));

    fireEvent.click(screen.getByRole('button', { name: 'Tisch-Menü' }));
    expect(screen.getByRole('radio', { name: 'Automatisch (Gerät)' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Querformat' }));

    expect(layoutOf()).toBe('landscape');
    expect(window.localStorage.getItem(ORIENTATION_STORAGE_KEY)).toBe('landscape');
    // Menü bleibt offen (eigener Zustand überlebt), Aktionsleiste behält ihren Zustand.
    expect(screen.getByRole('radio', { name: 'Querformat' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Zähler 1' })).toBeTruthy();
    expect(screen.getByTestId('poker-table')).toBe(root);

    // Erzwungenes Querformat bleibt auch beim Drehen ins Hochformat.
    media.rotate(false);
    expect(layoutOf()).toBe('landscape');

    fireEvent.click(screen.getByRole('radio', { name: 'Hochformat' }));
    expect(layoutOf()).toBe('portrait');
    expect(screen.getByRole('button', { name: 'Zähler 1' })).toBeTruthy();
  });

  it('Änderung in den Einstellungen wirkt sofort am Tisch', () => {
    fakeMatchMedia(true);
    render(<TableScreen view={mock('heads-up')} />);
    expect(layoutOf()).toBe('landscape');
    act(() => {
      writeOrientationPreference('portrait');
    });
    expect(layoutOf()).toBe('portrait');
  });

  it('Menü schließt mit Escape und Klick außerhalb, zeigt weitere Einträge', () => {
    render(<TableScreen view={mock('heads-up')} menuItems={<button type="button">Tisch verlassen</button>} />);
    const button = screen.getByRole('button', { name: 'Tisch-Menü' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Tisch verlassen' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByTestId('board'));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
