import { describe, expect, it } from 'vitest';
import { lastActionText, timerStage } from './SeatHints';

describe('lastActionText', () => {
  it('kurze Schriftzüge, Beträge mit Tausenderpunkt', () => {
    expect(lastActionText({ kind: 'check' })).toBe('Check');
    expect(lastActionText({ kind: 'fold' })).toBe('Fold');
    expect(lastActionText({ kind: 'call', amount: 40 })).toBe('Call');
    expect(lastActionText({ kind: 'bet', amount: 40 })).toBe('Bet 40');
    expect(lastActionText({ kind: 'raise', amount: 1_200 })).toBe('Raise 1.200');
    expect(lastActionText({ kind: 'allIn', amount: 900 })).toBe('All-in');
  });
});

describe('timerStage', () => {
  it('normal → gelb ab der Hälfte → rot im letzten Viertel; Zeitbank eigene Stufe', () => {
    expect(timerStage(1, false)).toBe('ok');
    expect(timerStage(0.5, false)).toBe('ok');
    expect(timerStage(0.49, false)).toBe('mid');
    expect(timerStage(0.25, false)).toBe('mid');
    expect(timerStage(0.24, false)).toBe('low');
    expect(timerStage(0.1, true)).toBe('bank');
  });
});
