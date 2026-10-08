// Hilfen für DB-Integrationstests: jeder Testlauf bekommt ein eigenes, frisches Schema in der Test-DB
// (TEST_DATABASE_URL, z. B. postgres://poker:poker@localhost:4312/poker_test) und löscht es danach wieder.
import { randomBytes } from 'node:crypto';
import pg from 'pg';

/** Gesetzt → DB-Tests laufen, sonst werden sie übersprungen (`npm run check` ohne Docker bleibt grün). */
export const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

export interface TestSchema {
  name: string;
  /** Client-Konfiguration mit `search_path` auf das Testschema – für `runMigrations` und eigene Pools. */
  config: pg.ClientConfig;
  pool: pg.Pool;
  /** Schließt den Pool und löscht das Schema samt Inhalt. */
  drop(): Promise<void>;
}

/** Legt die Datenbank aus `url` an, falls sie fehlt (Verbindung über die Wartungs-DB `postgres`). */
async function ensureDatabase(url: string): Promise<void> {
  const probe = new pg.Client({ connectionString: url });
  try {
    await probe.connect();
    return;
  } catch (err) {
    if ((err as { code?: string }).code !== '3D000') throw err; // 3D000 = invalid_catalog_name
  } finally {
    await probe.end().catch(() => undefined);
  }
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  target.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(dbName)}`);
  } catch (err) {
    // Parallel laufende Testdateien: die Datenbank hat inzwischen ein anderer angelegt.
    const code = (err as { code?: string }).code;
    if (code !== '42P04' && code !== '23505') throw err;
  } finally {
    await admin.end();
  }
}

export async function createTestSchema(url: string): Promise<TestSchema> {
  await ensureDatabase(url);
  const name = `test_${String(Date.now())}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA ${pg.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  const config: pg.ClientConfig = { connectionString: url, options: `-c search_path=${name}` };
  const pool = new pg.Pool({ ...config, max: 3 });
  pool.on('error', () => undefined);
  return {
    name,
    config,
    pool,
    async drop() {
      await pool.end();
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query(`DROP SCHEMA ${pg.escapeIdentifier(name)} CASCADE`);
      } finally {
        await client.end();
      }
    },
  };
}
