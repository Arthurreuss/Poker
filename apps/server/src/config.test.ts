import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { PORT: '1234', DATABASE_URL: 'postgres://u:p@db/x', PUBLIC_ORIGIN: 'http://example.test' };

describe('loadConfig', () => {
  it('liest alle Werte aus der Umgebung', () => {
    expect(loadConfig({ ...base, HOST: '0.0.0.0', NODE_ENV: 'production' })).toEqual({
      host: '0.0.0.0',
      port: 1234,
      databaseUrl: 'postgres://u:p@db/x',
      publicOrigin: 'http://example.test',
      nodeEnv: 'production',
      trustProxy: true,
    });
  });

  it('bindet ohne HOST nur lokal und nimmt development als Standard', () => {
    const config = loadConfig(base);
    expect(config.host).toBe('127.0.0.1');
    expect(config.nodeEnv).toBe('development');
    expect(config.trustProxy).toBe(false);
  });

  it.each(['PORT', 'DATABASE_URL', 'PUBLIC_ORIGIN'])('wirft, wenn %s fehlt', (name) => {
    expect(() => loadConfig({ ...base, [name]: undefined })).toThrow(name);
  });

  it('wirft bei ungültigem PORT', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
  });
});
