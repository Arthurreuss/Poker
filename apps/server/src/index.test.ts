import { describe, expect, it } from 'vitest';
import { serverInfo } from './index';

describe('server placeholder', () => {
  it('kann die Engine importieren', () => {
    expect(serverInfo()).toEqual({ name: '@poker/server', engine: '@poker/engine' });
  });
});
