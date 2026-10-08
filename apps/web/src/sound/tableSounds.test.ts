import { describe, expect, it } from 'vitest';
import { soundsFor } from './tableSounds';

describe('soundsFor', () => {
  it('ordnet Ereignisse Klängen zu', () => {
    expect(soundsFor([{ type: 'check', seat: 1 }])).toEqual([{ name: 'check', delayMs: 0 }]);
    expect(soundsFor([{ type: 'bet', seat: 1, allIn: false }])).toEqual([{ name: 'chips', delayMs: 0 }]);
    expect(soundsFor([{ type: 'yourTurn' }])).toEqual([{ name: 'turn', delayMs: 0 }]);
    expect(soundsFor([{ type: 'board', from: 0, to: 3 }]).map((s) => s.name)).toEqual(['flip', 'flip', 'flip']);
    expect(soundsFor([{ type: 'deal', seats: [1, 2, 0] }])).toHaveLength(6);
  });

  it('Gewinn: eigener Sieg mit Fanfare, nach dem Einsammeln', () => {
    expect(
      soundsFor([
        { type: 'collect', seats: [0, 1] },
        { type: 'win', seats: [0], hero: true },
      ]),
    ).toEqual([
      { name: 'collect', delayMs: 120 },
      { name: 'win', delayMs: 580 },
    ]);
    expect(soundsFor([{ type: 'win', seats: [1], hero: false }])).toEqual([{ name: 'collect', delayMs: 200 }]);
  });

  it('gleiche Klänge im selben Moment nur einmal', () => {
    expect(
      soundsFor([
        { type: 'reveal', seat: 1 },
        { type: 'reveal', seat: 2 },
      ]),
    ).toEqual([{ name: 'flip', delayMs: 0 }]);
  });
});
