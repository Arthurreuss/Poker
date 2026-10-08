// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { Card } from './Card';
import { mockById } from './dev/mocks';
import { PokerTable } from './PokerTable';
import type { TableView } from './types';

afterEach(cleanup);

function mock(id: string): TableView {
  const m = mockById(id);
  if (m === undefined) throw new Error(`Mock ${id} fehlt`);
  return m.view;
}

function seatEl(seat: number): HTMLElement {
  const el = screen.getAllByTestId('seat').find((s) => s.dataset['seat'] === String(seat));
  if (el === undefined) throw new Error(`Sitz ${String(seat)} nicht gerendert`);
  return el;
}

describe('PokerTable – Sitze', () => {
  it('zeichnet nur belegte Sitze, eigener Sitz unten mittig', () => {
    render(<PokerTable view={mock('six-flop')} />);
    const seats = screen.getAllByTestId('seat');
    expect(seats).toHaveLength(6);
    expect(seatEl(0).dataset['slot']).toBe('B');
    expect(seatEl(0).dataset['hero']).toBe('true');
    // Nächster Sitz nach dem eigenen erscheint links unten (Uhrzeigersinn).
    expect(seatEl(1).dataset['slot']).toBe('BL');
    expect(seatEl(7).dataset['slot']).toBe('BR');
  });

  it('zeigt Name und Stack auf der Plakette', () => {
    render(<PokerTable view={mock('six-flop')} />);
    const lena = within(seatEl(1));
    expect(lena.getByTestId('seat-name').textContent).toBe('Lena');
    expect(lena.getByTestId('seat-stack').textContent).toBe('12.300');
  });
});

describe('PokerTable – Karten', () => {
  it('eigene Karten sichtbar und groß, fremde verdeckt, gefoldete ohne Karten', () => {
    render(<PokerTable view={mock('six-flop')} />);
    const hero = within(seatEl(0));
    expect(hero.getByTestId('hole-cards').dataset['kind']).toBe('visible');
    const heroCards = within(hero.getByTestId('hole-cards'));
    expect(heroCards.getAllByRole('img').map((c) => c.getAttribute('aria-label'))).toEqual(['Herz Dame', 'Kreuz Dame']);
    expect(heroCards.getAllByRole('img')[0]?.className).toContain('pt-card--hero');

    const lena = within(seatEl(1));
    expect(lena.getAllByRole('img').map((c) => c.getAttribute('aria-label'))).toEqual([
      'verdeckte Karte',
      'verdeckte Karte',
    ]);
    expect(lena.getAllByRole('img')[0]?.className).toContain('pt-card--seat');

    expect(within(seatEl(2)).queryByTestId('hole-cards')).toBeNull();
  });

  it('zeigt im Showdown aufgedeckte Karten fremder Spieler', () => {
    render(<PokerTable view={mock('six-showdown')} />);
    const lena = within(seatEl(1));
    expect(lena.getByTestId('hole-cards').dataset['kind']).toBe('shown');
    expect(lena.getAllByRole('img').map((c) => c.getAttribute('aria-label'))).toEqual(['Kreuz Ass', 'Karo Dame']);
  });

  it('zeigt das Board mit reservierten Plätzen', () => {
    render(<PokerTable view={mock('nine-allin')} />);
    const board = screen.getByTestId('board');
    expect(
      within(board)
        .getAllByRole('img')
        .map((c) => c.dataset['card']),
    ).toEqual(['Ah', '9c', '9d', '4s']);
    expect(board.children).toHaveLength(5);
  });

  it('Vier-Farben-Deck färbt Karo und Kreuz anders', () => {
    const { container } = render(
      <>
        <Card card="Td" size="board" fourColor />
        <Card card="Tc" size="board" fourColor />
        <Card card="Th" size="board" />
      </>,
    );
    expect(container.querySelectorAll('.pt-ink-blue').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pt-ink-green').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pt-ink-red').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img').map((c) => c.getAttribute('aria-label'))).toEqual([
      'Karo Zehn',
      'Kreuz Zehn',
      'Herz Zehn',
    ]);
  });
});

describe('PokerTable – Status', () => {
  it('markiert Fold, All-in, getrennt und ausgeschieden', () => {
    render(<PokerTable view={mock('six-disconnected')} />);
    expect(within(seatEl(6)).getByTestId('status').textContent).toBe('Fold');
    expect(within(seatEl(8)).getByTestId('seat-stack').textContent).toBe('All-in');
    expect(within(seatEl(8)).getByTestId('status').textContent).toBe('Getrennt');
    expect(within(seatEl(8)).getByLabelText('Verbindung getrennt')).toBeTruthy();
    expect(seatEl(8).dataset['connected']).toBe('false');
    expect(within(seatEl(2)).getByTestId('seat-stack').textContent).toBe('Ausgeschieden');
    expect(within(seatEl(3)).queryByTestId('status')).toBeNull();
  });

  it('zeigt, wer am Zug ist, mit Restzeit', () => {
    render(<PokerTable view={mock('six-flop')} />);
    expect(seatEl(7).dataset['toAct']).toBe('true');
    const timers = screen.getAllByTestId('timer');
    expect(timers).toHaveLength(1);
    expect(within(seatEl(7)).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('45');
  });

  it('zeigt keinen Timer-Ring ohne Restzeit vom Server (WP-018)', () => {
    const view: TableView = { ...mock('six-flop') };
    delete (view as { timeRemaining?: number }).timeRemaining;
    render(<PokerTable view={view} />);
    expect(seatEl(7).dataset['toAct']).toBe('true');
    expect(screen.queryByTestId('timer')).toBeNull();
  });

  it('färbt den Ring bei wenig Restzeit rot und zeigt die laufende Zeitbank', () => {
    render(<PokerTable view={{ ...mock('six-flop'), timeRemaining: 0, timeBankSeconds: 42 }} />);
    expect(screen.getByTestId('timer').getAttribute('class')).toContain('pt-timer-ring--low');
    expect(within(seatEl(7)).getByTestId('time-bank').textContent).toBe('Zeitbank 42 s');
  });

  it('zeigt Dealer-Button und Blind-Marker', () => {
    render(<PokerTable view={mock('six-flop')} />);
    expect(within(seatEl(4)).getByTestId('marker').dataset['marker']).toBe('dealer');
    expect(within(seatEl(5)).getByLabelText('Small Blind')).toBeTruthy();
    expect(within(seatEl(7)).getByLabelText('Big Blind')).toBeTruthy();
    expect(screen.getAllByTestId('marker')).toHaveLength(3);
  });
});

describe('PokerTable – Einsätze und Pots', () => {
  it('zeigt Einsätze nur für Sitze mit Einsatz', () => {
    render(<PokerTable view={mock('six-flop')} />);
    expect(screen.getAllByTestId('bet').map((b) => b.textContent)).toEqual(['600', '600', '1.800']);
  });

  it('ein Pot heißt „Pot“', () => {
    render(<PokerTable view={mock('six-flop')} />);
    expect(screen.getAllByTestId('pot').map((p) => p.textContent)).toEqual(['Pot3.600']);
  });

  it('Main Pot und Side Pots', () => {
    render(<PokerTable view={mock('nine-allin')} />);
    expect(screen.getAllByTestId('pot').map((p) => p.textContent)).toEqual([
      'Main Pot6.400',
      'Side Pot 15.700',
      'Side Pot 24.200',
    ]);
  });

  it('ohne Pot keine Pot-Anzeige; Blinds/Level in der Kopfzeile', () => {
    render(<PokerTable view={mock('heads-up')} />);
    expect(screen.queryAllByTestId('pot')).toHaveLength(0);
    expect(screen.getByTestId('blinds').textContent).toBe('Level 2 · Blinds 50/100');
  });

  it('lässt unten Platz für die Aktionsleiste', () => {
    render(<PokerTable view={mock('heads-up')} actionBar={<button type="button">Fold</button>} />);
    expect(within(screen.getByTestId('action-slot')).getByRole('button').textContent).toBe('Fold');
  });
});

describe('PokerTable – reine Darstellung', () => {
  it('gleicher Zustand ergibt gleiches Markup', () => {
    const view = mock('nine-allin');
    expect(renderToStaticMarkup(<PokerTable view={view} />)).toBe(renderToStaticMarkup(<PokerTable view={view} />));
  });
});

describe('PokerTable – Avatare und Reaktionen (WP-032)', () => {
  it('Avatar an der Plakette, gegenüber dem Marker; ohne Avatar keiner', () => {
    render(<PokerTable view={mock('six-flop')} />);
    const avatarOf = (seat: number) => within(seatEl(seat)).queryByTestId('avatar');
    expect(avatarOf(0)?.dataset['avatar']).toBe('fox');
    expect(avatarOf(0)?.getAttribute('class')).toContain('pt-plate-avatar--left');
    expect(avatarOf(7)?.getAttribute('class')).toContain('pt-plate-avatar--right'); // Marker links (TR/R)
    expect(avatarOf(2)).toBeNull();
  });

  it('Reaktionen über dem jeweiligen Sitz, Reaktions-Knopf nur mit Inhalt', () => {
    const { rerender } = render(
      <PokerTable view={mock('six-flop')} reactionPicker={<button type="button">R</button>} />,
    );
    expect(within(seatEl(4)).getByRole('img', { name: 'Mia: Lachen' })).toHaveTextContent('😂');
    expect(within(seatEl(1)).queryByTestId('reaction')).toBeNull();
    expect(screen.getByTestId('react-slot')).toHaveTextContent('R');
    rerender(<PokerTable view={{ ...mock('six-flop'), reactions: [] }} />);
    expect(screen.queryByTestId('reaction')).toBeNull();
    expect(screen.queryByTestId('react-slot')).toBeNull();
  });
});
