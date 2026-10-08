import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createPgDatabase, type Database } from './db';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health ohne Datenbank', () => {
  it('meldet 503 und db: error, wenn die Datenbank nicht erreichbar ist', async () => {
    let closed = false;
    const unreachable: Database = {
      ping: () => Promise.reject(new Error('connection refused')),
      query: () => Promise.reject(new Error('connection refused')),
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    };
    app = buildApp({ db: unreachable, publicOrigin: 'http://example.test' });

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'error' });
    await app.close();
    expect(closed).toBe(true);
  });
});

// Läuft nur mit erreichbarer DB, z. B. DATABASE_URL=postgres://poker:poker@localhost:4312/poker (dev-Compose).
const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(databaseUrl === undefined)('GET /api/health mit Datenbank', () => {
  it('meldet ok inkl. DB-Verbindung', async () => {
    app = buildApp({ db: createPgDatabase(databaseUrl ?? ''), publicOrigin: 'http://example.test' });

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});
