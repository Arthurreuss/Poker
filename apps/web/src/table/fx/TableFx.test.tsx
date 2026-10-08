// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PokerTable } from '../PokerTable';
import type { PlayerSeatView, SeatView, TableView } from '../types';
import { TableFx } from './TableFx';

const EMPTY: SeatView = { kind: 'empty' };
const p = (o: Partial<PlayerSeatView> = {}): PlayerSeatView => ({
  kind: 'player',
  name: 'x',
  stack: 1000,
  bet: 0,
  status: 'active',
  connected: true,
  holeCards: { kind: 'none' },
  ...o,
});
const view = (seats: SeatView[], o: Partial<TableView> = {}): TableView => ({
  seats: [...seats, ...Array.from({ length: 9 - seats.length }, () => EMPTY)],
  heroSeat: 0,
  buttonSeat: 0,
  smallBlindSeat: 1,
  bigBlindSeat: 0,
  toActSeat: null,
  board: [],
  pots: [],
  blinds: { small: 10, big: 20 },
  handNumber: 1,
  ...o,
});

/** Ablauf: Hand 1 vorbei → Hand 2 ausgeteilt → Flop → Showdown mit Gewinner. */
const STEPS: TableView[] = [
  view([p(), p()]),
  view([p({ holeCards: { kind: 'visible', cards: ['Ah', 'Ad'] } }), p({ holeCards: { kind: 'hidden' }, bet: 10 })], {
    handNumber: 2,
  }),
  view([p({ holeCards: { kind: 'visible', cards: ['Ah', 'Ad'] } }), p({ holeCards: { kind: 'hidden' } })], {
    handNumber: 2,
    board: ['As', 'Kd', '7h'],
    pots: [{ amount: 40 }],
  }),
  view(
    [
      p({ holeCards: { kind: 'visible', cards: ['Ah', 'Ad'] } }),
      p({ holeCards: { kind: 'shown', cards: ['2c', '3c'] } }),
    ],
    {
      handNumber: 2,
      board: ['As', 'Kd', '7h', '2d', '9s'],
      winnerSeats: [0],
      winningCards: ['Ah', 'Ad', 'As', 'Kd', '9s'],
    },
  ),
];

let animate: ReturnType<typeof vi.fn>;
let reduce = false;

beforeEach(() => {
  reduce = false;
  animate = vi.fn(() => ({ onfinish: null, oncancel: null, cancel: () => undefined }));
  Element.prototype.animate = animate as unknown as Element['animate'];
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduce') ? reduce : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).animate;
});

function play(enabled: boolean) {
  const first = STEPS[0];
  if (first === undefined) throw new Error();
  const r = render(<PokerTable view={first} overlay={<TableFx view={first} enabled={enabled} />} />);
  for (const step of STEPS.slice(1)) {
    r.rerender(<PokerTable view={step} overlay={<TableFx view={step} enabled={enabled} />} />);
  }
  return r;
}

describe('TableFx', () => {
  it('animiert Austeilen, Board, Einsätze und Gewinner (Web Animations API, keine <style>-Elemente)', () => {
    const { container } = play(true);
    expect(animate).toHaveBeenCalled();
    const frames = animate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(frames.some((f) => f.includes('"scale":"0 1"'))).toBe(true); // Board aufdecken
    expect(frames.some((f) => f.includes('"scale":"0.5"'))).toBe(true); // Austeilen
    expect(document.querySelectorAll('style')).toHaveLength(0);
    expect(container.querySelector('[data-testid="table-fx"]')).toHaveAttribute('aria-hidden', 'true');
    // Gewinner hervorgehoben (statisch, unabhängig von Animationen)
    expect(container.querySelector('[data-seat="0"][data-testid="seat"]')).toHaveAttribute('data-winner', 'true');
    expect(container.querySelectorAll('.pt-card--win')).toHaveLength(5);
  });

  it('mit „Bewegung reduzieren“ keine Animationen', () => {
    reduce = true;
    play(true);
    expect(animate).not.toHaveBeenCalled();
  });

  it('mit ausgeschalteten Animationen keine Animationen', () => {
    play(false);
    expect(animate).not.toHaveBeenCalled();
  });
});
