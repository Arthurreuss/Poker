import { describe, expect, it } from 'vitest';
import { formatChips } from './format';
import {
  LANDSCAPE_SLOTS,
  LANDSCAPE_SLOTS_BY_COUNT,
  PORTRAIT_SLOTS,
  SLOTS_BY_COUNT,
  placeSeats,
  resolveLayout,
  seatMarker,
} from './layout';
import { MOCK_STATES, mockById } from './dev/mocks';
import type { PlayerSeatView, SeatView, TableView } from './types';

function p(name: string): PlayerSeatView {
  return {
    kind: 'player',
    name,
    stack: 1000,
    bet: 0,
    status: 'active',
    connected: true,
    holeCards: { kind: 'hidden' },
  };
}

function table(occupied: number[], heroSeat: number | null): TableView {
  const seats: SeatView[] = Array.from({ length: 9 }, (_, i) =>
    occupied.includes(i) ? p(`S${String(i)}`) : { kind: 'empty' },
  );
  return {
    seats,
    heroSeat,
    buttonSeat: null,
    smallBlindSeat: null,
    bigBlindSeat: null,
    toActSeat: null,
    board: [],
    pots: [],
    blinds: { small: 10, big: 20 },
  };
}

describe('placeSeats – Sitzrotation', () => {
  it('setzt den eigenen Sitz unten mittig, die übrigen im Uhrzeigersinn in Sitzreihenfolge', () => {
    const placed = placeSeats(table([0, 1, 2, 3, 4, 5, 6, 7, 8], 4));
    expect(placed.map((x) => [x.seat, x.slot.id])).toEqual([
      [4, 'B'],
      [5, 'BL'],
      [6, 'L1'],
      [7, 'L2'],
      [8, 'TL'],
      [0, 'TR'],
      [1, 'R2'],
      [2, 'R1'],
      [3, 'BR'],
    ]);
    expect(placed.filter((x) => x.isHero).map((x) => x.seat)).toEqual([4]);
  });

  it('der eigene Sitz ist bei jeder Sitznummer unten mittig', () => {
    for (let hero = 0; hero < 9; hero++) {
      const placed = placeSeats(table([0, 2, 3, 5, 8, hero], hero));
      const heroSlot = placed.find((x) => x.seat === hero)?.slot;
      expect(heroSlot?.id).toBe('B');
      expect(heroSlot?.x).toBe(50);
    }
  });

  it('verteilt wenige Spieler gleichmäßig und überspringt leere Sitze', () => {
    expect(placeSeats(table([1, 7], 7)).map((x) => [x.seat, x.slot.id])).toEqual([
      [7, 'B'],
      [1, 'T'],
    ]);
    expect(placeSeats(table([0, 3, 4, 6, 7, 8], 6)).map((x) => x.slot.id)).toEqual(SLOTS_BY_COUNT[6]);
  });

  it('ohne eigenen Sitz (Zuschauer) steht der niedrigste belegte Sitz unten', () => {
    const placed = placeSeats(table([2, 5, 8], null));
    expect(placed.map((x) => [x.seat, x.slot.id])).toEqual([
      [2, 'B'],
      [5, 'TL'],
      [8, 'TR'],
    ]);
    expect(placed.some((x) => x.isHero)).toBe(false);
  });

  it('hat für 1–9 Spieler eindeutige Positionen, beginnend unten mittig', () => {
    for (let n = 1; n <= 9; n++) {
      const ids = SLOTS_BY_COUNT[n] ?? [];
      expect(ids).toHaveLength(n);
      expect(new Set(ids).size).toBe(n);
      expect(ids[0]).toBe('B');
      for (const id of ids) expect(PORTRAIT_SLOTS[id]).toBeDefined();
    }
  });

  it('verlangt genau 9 Sitze', () => {
    expect(() => placeSeats({ ...table([0], 0), seats: [p('a')] })).toThrow(/9 Einträge/);
  });
});

describe('Querformat (WP-017)', () => {
  it('nutzt dieselbe Sitzrotation mit eigenen Positionen, eigener Sitz unten mittig', () => {
    const view = table([0, 1, 2, 3, 4, 5, 6, 7, 8], 4);
    const portrait = placeSeats(view, 'portrait');
    const landscape = placeSeats(view, 'landscape');
    expect(landscape.map((x) => x.seat)).toEqual(portrait.map((x) => x.seat));
    expect(landscape.map((x) => x.slot)).toEqual((LANDSCAPE_SLOTS_BY_COUNT[9] ?? []).map((id) => LANDSCAPE_SLOTS[id]));
    expect(landscape[0]?.slot).toMatchObject({ id: 'B', x: 50 });
  });

  it('hat für 1–9 Spieler eindeutige Positionen, beginnend unten mittig', () => {
    for (let n = 1; n <= 9; n++) {
      const ids = LANDSCAPE_SLOTS_BY_COUNT[n] ?? [];
      expect(ids).toHaveLength(n);
      expect(new Set(ids).size).toBe(n);
      expect(ids[0]).toBe('B');
    }
  });

  it('bis 8 Spieler links/rechts symmetrisch; die Ecke unten rechts (Aktionsleiste) nur bei 9', () => {
    for (let n = 1; n <= 8; n++) {
      const slots = (LANDSCAPE_SLOTS_BY_COUNT[n] ?? []).map((id) => LANDSCAPE_SLOTS[id]);
      const xs = slots.map((s) => Math.round(s.x * 10)).sort((a, b) => a - b);
      const mirrored = slots.map((s) => Math.round((100 - s.x) * 10)).sort((a, b) => a - b);
      expect(xs, `${String(n)} Spieler`).toEqual(mirrored);
      expect(LANDSCAPE_SLOTS_BY_COUNT[n]).not.toContain('BR');
    }
  });

  it('Standard bleibt Hochformat', () => {
    const view = table([0, 4], 0);
    expect(placeSeats(view)).toEqual(placeSeats(view, 'portrait'));
  });
});

describe('resolveLayout (D-009)', () => {
  it('auto folgt der Ausrichtung des Bildschirms', () => {
    expect(resolveLayout('auto', false)).toBe('portrait');
    expect(resolveLayout('auto', true)).toBe('landscape');
  });

  it('Hoch/Quer erzwingen das Layout unabhängig von der Gerätelage', () => {
    expect(resolveLayout('portrait', true)).toBe('portrait');
    expect(resolveLayout('landscape', false)).toBe('landscape');
  });
});

describe('seatMarker', () => {
  it('Dealer hat Vorrang vor Small Blind (Heads-up)', () => {
    const view = mockById('heads-up')?.view;
    expect(view).toBeDefined();
    if (view === undefined) return;
    expect(seatMarker(view, 2)).toBe('dealer');
    expect(seatMarker(view, 6)).toBe('bb');
    expect(seatMarker(view, 0)).toBeNull();
  });
});

describe('formatChips', () => {
  it('formatiert deutsch und kürzt große Beträge', () => {
    expect(formatChips(0)).toBe('0');
    expect(formatChips(1450)).toBe('1.450');
    expect(formatChips(99_999)).toBe('99.999');
    expect(formatChips(125_500)).toBe('125,5k');
    expect(formatChips(2_000_000)).toBe('2M');
  });
});

describe('Mock-Zustände', () => {
  it('sind gültig: 9 Sitze, eigener Sitz belegt, Marker/Am-Zug auf belegten Sitzen', () => {
    for (const { id, view } of MOCK_STATES) {
      expect(view.seats, id).toHaveLength(9);
      for (const seat of [view.heroSeat, view.buttonSeat, view.smallBlindSeat, view.bigBlindSeat, view.toActSeat]) {
        if (seat !== null) expect(view.seats[seat]?.kind, id).toBe('player');
      }
    }
  });
});
