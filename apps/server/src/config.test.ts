import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { PORT: '1234', DATABASE_URL: 'postgres://u:p@db/x', PUBLIC_ORIGIN: 'http://example.test' };

describe('loadConfig', () => {
  it('liest alle Werte aus der Umgebung', () => {
    expect(
      loadConfig({ ...base, HOST: '0.0.0.0', NODE_ENV: 'production', LOG_FILE: '/var/log/poker/server.log' }),
    ).toEqual({
      host: '0.0.0.0',
      port: 1234,
      databaseUrl: 'postgres://u:p@db/x',
      publicOrigins: ['http://example.test'],
      nodeEnv: 'production',
      trustProxy: true,
      logFile: '/var/log/poker/server.log',
    });
  });

  it('bindet ohne HOST nur lokal und nimmt development als Standard', () => {
    const config = loadConfig(base);
    expect(config.host).toBe('127.0.0.1');
    expect(config.nodeEnv).toBe('development');
    expect(config.trustProxy).toBe(false);
    // Ohne LOG_FILE (bzw. leer) loggt der Server nach stdout.
    expect(config.logFile).toBeNull();
    expect(loadConfig({ ...base, LOG_FILE: ' ' }).logFile).toBeNull();
  });

  it.each(['PORT', 'DATABASE_URL', 'PUBLIC_ORIGIN'])('wirft, wenn %s fehlt', (name) => {
    expect(() => loadConfig({ ...base, [name]: undefined })).toThrow(name);
  });

  it('erlaubt mehrere Origins, durch Komma getrennt (D-023)', () => {
    const config = loadConfig({ ...base, PUBLIC_ORIGIN: 'https://a.example, https://b.example' });
    expect(config.publicOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it.each(['https://a.example/', 'https://a.example/pfad', 'a.example', 'https://a.example,kaputt'])(
    'wirft bei ungültiger Origin %s',
    (value) => {
      expect(() => loadConfig({ ...base, PUBLIC_ORIGIN: value })).toThrow('PUBLIC_ORIGIN');
    },
  );

  it('wirft bei ungültigem PORT', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
  });
});
