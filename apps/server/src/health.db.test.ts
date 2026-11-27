// Health mit erreichbarer Datenbank gegen die Test-DB (Stufe `db`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createPgDatabase } from './db';
import { createTestDatabase, type TestDatabase } from './db/test-db';

describe('GET /api/health mit Datenbank', () => {
  let s: TestDatabase;
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    s = await createTestDatabase('health');
  });

  afterAll(async () => {
    await app?.close();
    await s.drop();
  });

  it('meldet ok inkl. DB-Verbindung', async () => {
    app = buildApp({ db: createPgDatabase({ ...s.config, max: 1 }), publicOrigin: 'http://example.test' });

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});
