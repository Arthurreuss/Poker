import { describe, expect, it } from 'vitest';
import { appTitle, fetchHealth, healthLabel } from './health';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (input) => {
    expect(input).toBe('/api/health');
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

describe('fetchHealth', () => {
  it('meldet ok, wenn Server und DB ok sind', async () => {
    expect(await fetchHealth(fakeFetch(200, { status: 'ok', db: 'ok' }))).toEqual({ kind: 'ok' });
  });

  it('meldet Fehler bei 503', async () => {
    expect(await fetchHealth(fakeFetch(503, { status: 'error', db: 'error' }))).toEqual({
      kind: 'error',
      detail: 'HTTP 503, db: error',
    });
  });

  it('meldet Fehler, wenn der Server nicht erreichbar ist', async () => {
    const failing: typeof fetch = () => Promise.reject(new Error('Failed to fetch'));
    expect(await fetchHealth(failing)).toEqual({ kind: 'error', detail: 'Failed to fetch' });
  });
});

describe('Texte', () => {
  it('healthLabel', () => {
    expect(healthLabel({ kind: 'ok' })).toBe('Server: ok, Datenbank: ok');
    expect(healthLabel({ kind: 'error', detail: 'x' })).toBe('Server: Fehler (x)');
  });

  it('appTitle', () => {
    expect(appTitle('development')).toBe('Poker – dev');
    expect(appTitle('production')).toBe('Poker');
  });
});
