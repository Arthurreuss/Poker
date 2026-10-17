// @vitest-environment jsdom
// Showdown-Flip (WP-039): Karten der Mitspieler drehen sich in ca. 1 s um – Rückseite (Geist) dreht weg, die
// offene Karte dreht sich danach auf; ohne Animationen bzw. mit „Bewegung reduzieren“ sofort offen.
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PokerTable } from '../PokerTable';
import type { PlayerSeatView, SeatView, TableView } from '../types';
import { FLIP_CARD_STAGGER_MS, FLIP_HALF_MS, TableFx } from './TableFx';

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
const view = (seats: SeatView[]): TableView => ({
  seats: [...seats, ...Array.from({ length: 9 - seats.length }, () => EMPTY)],
  heroSeat: 0,
  buttonSeat: 0,
  smallBlindSeat: 1,
  bigBlindSeat: 0,
  toActSeat: null,
  board: ['As', 'Kd', '7h', '2d', '9s'],
  pots: [{ amount: 100 }],
  blinds: { small: 10, big: 20 },
  handNumber: 2,
});
const hero = p({ holeCards: { kind: 'visible', cards: ['Ah', 'Ad'] } });
const RIVER = view([hero, p({ holeCards: { kind: 'hidden' } }), p({ holeCards: { kind: 'hidden' } })]);
const SHOWDOWN = view([
  hero,
  p({ holeCards: { kind: 'shown', cards: ['2c', '3c'] } }),
  p({ holeCards: { kind: 'shown', cards: ['Qh', 'Jh'] } }),
]);

interface Call {
  readonly el: Element;
  readonly frames: Keyframe[];
  readonly options: KeyframeAnimationOptions;
}
let calls: Call[];
let reduce = false;

beforeEach(() => {
  reduce = false;
  calls = [];
  Element.prototype.animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, options });
    return { onfinish: null, oncancel: null, cancel: () => undefined };
  }) as unknown as Element['animate'];
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

function showdown(enabled: boolean) {
  const r = render(<PokerTable view={RIVER} overlay={<TableFx view={RIVER} enabled={enabled} />} />);
  r.rerender(<PokerTable view={SHOWDOWN} overlay={<TableFx view={SHOWDOWN} enabled={enabled} />} />);
  return r;
}

const flips = () => calls.filter((c) => JSON.stringify(c.frames).includes('"rotate":"y'));

describe('Showdown-Flip (TableFx, WP-039)', () => {
  it('dreht jede aufgedeckte Karte in ca. 1 s um: Rückseite weg, dann Vorderseite auf', () => {
    const { container } = showdown(true);
    const backs = flips().filter((c) => c.el.classList.contains('fx-flip-back'));
    const faces = flips().filter((c) => c.el.classList.contains('pt-card'));
    // Zwei Mitspieler × zwei Karten; die eigenen Karten drehen sich nicht.
    expect(backs).toHaveLength(4);
    expect(faces).toHaveLength(4);
    expect(faces.every((c) => c.el.closest('[data-hero="true"]') === null)).toBe(true);
    for (const c of faces) {
      expect(c.frames[0]).toMatchObject({ rotate: 'y 90deg' });
      expect(c.options.fill).toBe('backwards'); // während der ersten Hälfte unsichtbar auf der Kante
    }
    const end = Math.max(...faces.map((c) => Number(c.options.duration) + (c.options.delay ?? 0)));
    expect(end).toBe(2 * FLIP_HALF_MS + FLIP_CARD_STAGGER_MS);
    expect(end).toBeGreaterThanOrEqual(900);
    expect(end).toBeLessThanOrEqual(1200);
    // Die Karten stehen sofort offen im DOM, nur die Animation läuft „hinein“.
    expect(container.querySelectorAll('[data-kind="shown"] .pt-card--face')).toHaveLength(4);
    expect(document.querySelectorAll('style')).toHaveLength(0);
  });

  it('ohne Animationen bzw. mit „Bewegung reduzieren“: sofort offen, kein Flip', () => {
    const { container } = showdown(false);
    expect(flips()).toHaveLength(0);
    expect(container.querySelectorAll('[data-kind="shown"] .pt-card--face')).toHaveLength(4);
    expect(container.querySelectorAll('.fx-flip-back')).toHaveLength(0);
    calls = [];
    reduce = true;
    showdown(true);
    expect(flips()).toHaveLength(0);
  });
});
