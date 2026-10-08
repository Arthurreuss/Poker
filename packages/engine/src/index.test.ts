import { describe, expect, it } from 'vitest';
import { ENGINE_NAME, engineInfo } from './index';

describe('engine placeholder', () => {
  it('liefert den Paketnamen', () => {
    expect(engineInfo()).toEqual({ name: ENGINE_NAME });
  });
});
