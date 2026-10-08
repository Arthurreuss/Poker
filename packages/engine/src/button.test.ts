import { describe, expect, it } from 'vitest';
import { firstHandPositions, nextHandPositions, type HandPositions } from './button';

const pos = (buttonSeat: number, smallBlindSeat: number | null, bigBlindSeat: number, sbPosition?: number) => ({
  buttonSeat,
  smallBlindPositionSeat: sbPosition ?? smallBlindSeat ?? -1,
  smallBlindSeat,
  bigBlindSeat,
});

describe('firstHandPositions', () => {
  it('mehrere Spieler: Blinds sind die nächsten beiden besetzten Sitze links vom Button', () => {
    expect(firstHandPositions([0, 3, 5, 8], 5)).toEqual(pos(5, 8, 0));
    expect(firstHandPositions([8, 0, 3], 0)).toEqual(pos(0, 3, 8));
  });

  it('Heads-up: Button = Small Blind', () => {
    expect(firstHandPositions([2, 6], 6)).toEqual(pos(6, 6, 2));
    expect(firstHandPositions([2, 6], 2)).toEqual(pos(2, 2, 6));
  });
});

describe('nextHandPositions (TDA: Dead Button, Big Blind rückt genau einen Spieler weiter)', () => {
  const sixMax = pos(0, 1, 2); // Sitze 0–5, Button 0, SB 1, BB 2
  it.each<[string, HandPositions, number[], HandPositions]>([
    ['normal 3-handed', pos(0, 1, 2), [0, 1, 2], pos(1, 2, 0)],
    ['normal, Lücke in den Sitzen', pos(1, 4, 7), [1, 4, 7, 8], pos(4, 7, 8)],
    ['Spieler zwischen BB und nächstem BB ausgeschieden', sixMax, [0, 1, 2, 4, 5], pos(1, 2, 4)],
    ['Big Blind ausgeschieden → kein Small Blind', sixMax, [0, 1, 3, 4, 5], pos(1, null, 3, 2)],
    ['Small Blind ausgeschieden → Dead Button', sixMax, [0, 2, 3, 4, 5], pos(1, 2, 3)],
    ['Button ausgeschieden → normal weiter', sixMax, [1, 2, 3, 4, 5], pos(1, 2, 3)],
    ['SB und BB ausgeschieden → Dead Button und kein Small Blind', sixMax, [0, 3, 4, 5], pos(1, null, 3, 2)],
    ['nach Dead Small Blind: Button auf leerem Sitz', pos(1, null, 3, 2), [0, 1, 3, 4, 5], pos(2, 3, 4)],
    ['danach wieder normal', pos(2, 3, 4), [0, 1, 3, 4, 5], pos(3, 4, 5)],
    ['Big Blind wandert über das Tischende', pos(3, 4, 5), [0, 1, 3, 4, 5], pos(4, 5, 0)],
  ])('%s', (_label, previous, alive, expected) => {
    expect(nextHandPositions(previous, alive)).toEqual(expected);
  });

  it.each<[string, HandPositions, number[], HandPositions]>([
    // 3 → 2 Spieler: Button A (0), SB B (1), BB C (2)
    ['BB ausgeschieden: B wird Button/SB, A Big Blind', pos(0, 1, 2), [0, 1], pos(1, 1, 0)],
    ['SB ausgeschieden: C (voriger BB) wird Button/SB, A Big Blind', pos(0, 1, 2), [0, 2], pos(2, 2, 0)],
    ['Button ausgeschieden: C (voriger BB) wird Button/SB, B Big Blind', pos(0, 1, 2), [1, 2], pos(2, 2, 1)],
    ['4 → 2, SB und BB ausgeschieden', pos(0, 1, 2), [0, 3], pos(0, 0, 3)],
    ['4 → 2, Button und SB ausgeschieden', pos(0, 1, 2), [2, 3], pos(2, 2, 3)],
    ['Heads-up läuft weiter: Rollen tauschen', pos(1, 1, 0), [0, 1], pos(0, 0, 1)],
  ])('Heads-up: %s', (_label, previous, alive, expected) => {
    const next = nextHandPositions(previous, alive);
    expect(next).toEqual(expected);
    // Button = Small Blind, und wer eben Big Blind war, ist es nicht noch einmal.
    expect(next.smallBlindSeat).toBe(next.buttonSeat);
    expect(next.bigBlindSeat).not.toBe(previous.bigBlindSeat);
  });

  it('bei vielen Händen zahlt jeder genau einmal pro Umlauf den Big Blind', () => {
    let p = firstHandPositions([0, 2, 3, 7], 0);
    const bigBlinds: number[] = [p.bigBlindSeat];
    for (let i = 0; i < 7; i++) {
      p = nextHandPositions(p, [0, 2, 3, 7]);
      bigBlinds.push(p.bigBlindSeat);
    }
    expect(bigBlinds).toEqual([3, 7, 0, 2, 3, 7, 0, 2]);
  });
});
