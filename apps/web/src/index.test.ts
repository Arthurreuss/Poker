import { describe, expect, it } from 'vitest';
import { appTitle } from './index';

describe('web placeholder', () => {
  it('liefert den App-Titel', () => {
    expect(appTitle()).toBe('Poker');
  });
});
