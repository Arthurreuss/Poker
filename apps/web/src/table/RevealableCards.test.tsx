// @vitest-environment jsdom
// Admin dreht verdeckte Karten um (WP-033, D-027): Komponenten-Test der Tischansicht mit `reveal`-Prop.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockById } from './dev/mocks';
import { PokerTable } from './PokerTable';
import type { Card, TableView } from './types';

afterEach(cleanup);

function mock(id: string): TableView {
  const m = mockById(id);
  if (m === undefined) throw new Error(`Mock ${id} fehlt`);
  return m.view;
}

const KNOWN: ReadonlyMap<number, readonly Card[]> = new Map([[1, ['As', 'Kd'] as const]]);

/** Wie im Spiel: Tipp → umdrehen bzw. zurück; Karten für Sitz 1 sind „vom Server“ schon da. */
function AdminTable({ onToggle }: { onToggle: (seat: number) => void }) {
  const [faceUp, setFaceUp] = useState<ReadonlySet<number>>(new Set());
  return (
    <PokerTable
      view={mock('six-flop')}
      reveal={{
        cards: KNOWN,
        faceUp,
        onToggle: (seat) => {
          onToggle(seat);
          setFaceUp((prev) => {
            const next = new Set(prev);
            if (!next.delete(seat)) next.add(seat);
            return next;
          });
        },
      }}
    />
  );
}

function seatEl(seat: number): HTMLElement {
  const el = screen.getAllByTestId('seat').find((s) => s.dataset['seat'] === String(seat));
  if (el === undefined) throw new Error(`Sitz ${String(seat)} nicht gerendert`);
  return el;
}

describe('Admin: verdeckte Karten umdrehen', () => {
  it('ohne reveal-Prop sind verdeckte Karten kein Schalter', () => {
    render(<PokerTable view={mock('six-flop')} />);
    expect(screen.queryAllByRole('button', { name: /Karten von/ })).toEqual([]);
    expect(within(seatEl(1)).getByTestId('hole-cards').dataset['kind']).toBe('hidden');
  });

  it('Tipp dreht die Karten um, erneuter Tipp zurück', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<AdminTable onToggle={onToggle} />);
    const seat = within(seatEl(1));
    const button = seat.getByRole('button', { name: 'Karten von Lena aufdecken' });
    expect(button.dataset['revealed']).toBe('false');
    expect(
      within(button)
        .getAllByRole('img')
        .map((c) => c.dataset['card']),
    ).toEqual(['back', 'back']);

    await user.click(button);
    expect(onToggle).toHaveBeenLastCalledWith(1);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.dataset['revealed']).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Karten von Lena verdecken');
    expect(
      within(button)
        .getAllByRole('img')
        .map((c) => c.dataset['card']),
    ).toEqual(['As', 'Kd']);
    expect(button.querySelectorAll('.pt-flip--up')).toHaveLength(2);

    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelectorAll('.pt-flip--up')).toHaveLength(0);
    expect(
      within(button)
        .getAllByRole('img')
        .map((c) => c.dataset['card']),
    ).toEqual(['back', 'back']);
  });

  it('nur fremde verdeckte Karten: eigene Karten und leere Plätze sind kein Schalter', () => {
    render(<AdminTable onToggle={() => undefined} />);
    expect(within(seatEl(0)).queryByRole('button')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: /^Karten von .* aufdecken$/ });
    const hiddenSeats = screen
      .getAllByTestId('seat')
      .filter(
        (s) => s.dataset['hero'] !== 'true' && within(s).queryByTestId('hole-cards')?.dataset['kind'] === 'hidden',
      );
    expect(buttons).toHaveLength(hiddenSeats.length);
  });

  it('ohne Karten vom Server bleibt die Rückseite (Antwort steht noch aus)', async () => {
    const user = userEvent.setup();
    render(<AdminTable onToggle={() => undefined} />);
    const other = screen
      .getAllByTestId('seat')
      .find((s) => s.dataset['seat'] !== '1' && within(s).queryByRole('button') !== null);
    if (other === undefined) throw new Error('kein zweiter verdeckter Platz');
    const button = within(other).getByRole('button');
    await user.click(button);
    expect(button.dataset['revealed']).toBe('false');
    expect(
      within(button)
        .getAllByRole('img')
        .map((c) => c.dataset['card']),
    ).toEqual(['back', 'back']);
  });
});
