import type { LegalAction, LegalActions } from '@poker/engine';
import { describe, expect, it } from 'vitest';
import {
  actionOptions,
  clampWager,
  potWager,
  preActionChoices,
  preActionValid,
  resolvePreAction,
  wagerAction,
  wagerPresets,
  type PreAction,
  type WagerRange,
} from './logic';

const legal = (actions: LegalAction[], toCall = 0): LegalActions => ({ playerId: '1', toCall, actions });

describe('actionOptions', () => {
  it('Check + Bet ohne Einsatz', () => {
    const o = actionOptions(
      legal([
        { type: 'fold' },
        { type: 'check' },
        { type: 'bet', min: 20, max: 1500 },
        { type: 'allIn', amount: 1500, to: 1500 },
      ]),
    );
    expect(o).toEqual({
      fold: true,
      check: true,
      call: null,
      callIsAllIn: false,
      wager: { type: 'bet', min: 20, max: 1500, allInTo: 1500 },
      shortAllIn: null,
    });
  });

  it('Call + Raise; Höchstbetrag ist All-in', () => {
    const o = actionOptions(
      legal(
        [
          { type: 'fold' },
          { type: 'call', amount: 40 },
          { type: 'raise', min: 80, max: 980 },
          { type: 'allIn', amount: 960, to: 980 },
        ],
        40,
      ),
    );
    expect(o.call).toBe(40);
    expect(o.check).toBe(false);
    expect(o.wager).toEqual({ type: 'raise', min: 80, max: 980, allInTo: 980 });
    expect(o.shortAllIn).toBeNull();
  });

  it('Call bringt All-in: kein Raise, Call ist All-in', () => {
    const o = actionOptions(
      legal([{ type: 'fold' }, { type: 'call', amount: 300 }, { type: 'allIn', amount: 300, to: 340 }], 300),
    );
    expect(o.callIsAllIn).toBe(true);
    expect(o.wager).toBeNull();
    expect(o.shortAllIn).toBeNull();
  });

  it('All-in unter dem Mindest-Raise als eigener Knopf', () => {
    const o = actionOptions(
      legal([{ type: 'fold' }, { type: 'call', amount: 100 }, { type: 'allIn', amount: 150, to: 200 }], 100),
    );
    expect(o.wager).toBeNull();
    expect(o.shortAllIn).toEqual({ amount: 150, to: 200 });
  });

  it('nur Fold: nichts anderes bedienbar', () => {
    const o = actionOptions(legal([{ type: 'fold' }]));
    expect(o).toMatchObject({ fold: true, check: false, call: null, wager: null, shortAllIn: null });
  });
});

const RANGE: WagerRange = { type: 'raise', min: 80, max: 980, allInTo: 980 };

describe('Einsatz', () => {
  it('clampWager hält die Grenzen ein und rundet', () => {
    expect(clampWager(10, RANGE)).toBe(80);
    expect(clampWager(5000, RANGE)).toBe(980);
    expect(clampWager(123.6, RANGE)).toBe(124);
    expect(clampWager(Number.NaN, RANGE)).toBe(80);
  });

  it('wagerAction: Höchstbetrag als All-in, sonst Raise auf den Betrag', () => {
    expect(wagerAction(200, RANGE)).toEqual({ type: 'raise', amount: 200 });
    expect(wagerAction(980, RANGE)).toEqual({ type: 'allIn' });
    expect(wagerAction(1, RANGE)).toEqual({ type: 'raise', amount: 80 });
    expect(wagerAction(500, { type: 'bet', min: 20, max: 500, allInTo: null })).toEqual({ type: 'bet', amount: 500 });
  });

  it('Pot-Schnellwahl rechnet mit dem Pot nach dem eigenen Call', () => {
    // Pot 70, zu callen 20, höchster Einsatz 40 → Pot-Raise auf 40 + 90
    const ctx = { pot: 70, toCall: 20, currentBet: 40 };
    expect(potWager(1, ctx, RANGE)).toBe(130);
    expect(potWager(0.5, ctx, RANGE)).toBe(85);
    expect(wagerPresets(ctx, RANGE)).toEqual([
      { label: '½ Pot', value: 85 },
      { label: 'Pot', value: 130 },
      { label: 'All-in', value: 980 },
    ]);
  });

  it('Schnellwahl wird auf die Grenzen geklemmt', () => {
    const ctx = { pot: 30, toCall: 20, currentBet: 20 };
    const range: WagerRange = { type: 'raise', min: 40, max: 60, allInTo: 60 };
    expect(wagerPresets(ctx, range).map((p) => p.value)).toEqual([45, 60, 60]);
    expect(potWager(0.1, ctx, range)).toBe(40);
  });
});

describe('Vorab-Aktionen', () => {
  const pre = (kind: PreAction['kind'], amount = 0): PreAction => ({ kind, amount, handNumber: 3, street: 'flop' });

  it('Auswahl je nach offenem Betrag', () => {
    expect(preActionChoices(0).map((c) => c.label)).toEqual(['Check/Fold', 'Check', 'Call any']);
    expect(preActionChoices(40)).toEqual([
      { kind: 'checkFold', label: 'Fold', amount: 0 },
      { kind: 'call', label: 'Call', amount: 40 },
      { kind: 'callAny', label: 'Call any', amount: 0 },
    ]);
  });

  it('verfallen mit neuer Straße oder Hand', () => {
    for (const kind of ['checkFold', 'check', 'call', 'callAny'] as const) {
      expect(preActionValid(pre(kind, 40), { handNumber: 3, street: 'turn', toCall: 40 })).toBe(false);
      expect(preActionValid(pre(kind, 40), { handNumber: 4, street: 'flop', toCall: 40 })).toBe(false);
    }
  });

  it('Check verfällt bei einem Einsatz, Call bei geändertem Betrag; Check/Fold und Call any bleiben', () => {
    const state = (toCall: number) => ({ handNumber: 3, street: 'flop' as const, toCall });
    expect(preActionValid(pre('check'), state(0))).toBe(true);
    expect(preActionValid(pre('check'), state(50))).toBe(false);
    expect(preActionValid(pre('call', 40), state(40))).toBe(true);
    expect(preActionValid(pre('call', 40), state(120))).toBe(false);
    expect(preActionValid(pre('checkFold'), state(500))).toBe(true);
    expect(preActionValid(pre('callAny'), state(500))).toBe(true);
  });

  it('löst nur legale Aktionen aus', () => {
    const facingBet = legal([{ type: 'fold' }, { type: 'call', amount: 40 }, { type: 'raise', min: 80, max: 500 }], 40);
    const noBet = legal([{ type: 'fold' }, { type: 'check' }, { type: 'bet', min: 20, max: 500 }]);
    expect(resolvePreAction(pre('checkFold'), noBet)).toEqual({ type: 'check' });
    expect(resolvePreAction(pre('checkFold'), facingBet)).toEqual({ type: 'fold' });
    expect(resolvePreAction(pre('check'), facingBet)).toBeNull();
    expect(resolvePreAction(pre('call', 40), facingBet)).toEqual({ type: 'call' });
    expect(resolvePreAction(pre('call', 30), facingBet)).toBeNull();
    expect(resolvePreAction(pre('callAny'), facingBet)).toEqual({ type: 'call' });
    expect(resolvePreAction(pre('callAny'), noBet)).toEqual({ type: 'check' });
  });
});
