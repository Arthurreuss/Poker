// Migrations-Runner gegen die Test-DB (Stufe `db`). Die einzigen Tests, die Migrationen von null fahren:
// jeder Test bekommt eine leere Datenbank.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from './migrate';
import { createEmptyDatabase, createTestDatabase, type TestDatabase } from './test-db';

const tempDirs: string[] = [];

async function migrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'poker-migrations-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(dir, name), sql);
  }
  return dir;
}

describe('runMigrations (Test-DB)', () => {
  let db: TestDatabase | undefined;

  async function freshDatabase(): Promise<TestDatabase> {
    db = await createEmptyDatabase('migrate');
    return db;
  }

  async function tablesIn(s: TestDatabase): Promise<string[]> {
    const { rows } = await s.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    return rows.map((r) => r.table_name);
  }

  afterEach(async () => {
    await db?.drop();
    db = undefined;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('frische DB: alle Migrationen laufen durch und legen das Schema an', async () => {
    const s = await freshDatabase();
    const all = (await loadMigrations()).map((m) => m.version);

    const result = await runMigrations(s.config);

    expect(result.applied).toEqual(all);
    expect(await tablesIn(s)).toEqual([
      'admin_audit_log',
      'feedback',
      'hand_actions',
      'hands',
      'round_players',
      'rounds',
      'schema_migrations',
      'sessions',
      'tables',
      'users',
    ]);
    const { rows } = await s.pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY 1');
    expect(rows.map((r) => r.version)).toEqual(all);
  });

  it('zweiter Lauf ist ein No-Op', async () => {
    const s = await freshDatabase();
    await runMigrations(s.config);
    const before = await s.pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY 1');

    const result = await runMigrations(s.config);

    expect(result.applied).toEqual([]);
    const after = await s.pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY 1');
    expect(after.rows).toEqual(before.rows);
  });

  it('parallel startende Instanzen wenden jede Migration genau einmal an (Advisory-Lock)', async () => {
    const s = await freshDatabase();
    const all = (await loadMigrations()).map((m) => m.version);

    const results = await Promise.all([runMigrations(s.config), runMigrations(s.config), runMigrations(s.config)]);

    expect(results.flatMap((r) => r.applied).sort()).toEqual(all);
    const { rows } = await s.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0]?.n).toBe(all.length);
  });

  it('fehlschlagende Migration wird vollständig zurückgerollt, vorherige bleiben', async () => {
    const s = await freshDatabase();
    const dir = await migrationsDir({
      '0001_ok.sql': 'CREATE TABLE a (id int);',
      '0002_kaputt.sql': 'CREATE TABLE b (id int);\nSELECT 1 / 0;',
    });

    await expect(runMigrations(s.config, { migrationsDir: dir })).rejects.toThrow(/0002_kaputt/);

    expect(await tablesIn(s)).toEqual(['a', 'schema_migrations']);
    const { rows } = await s.pool.query<{ version: string }>('SELECT version FROM schema_migrations');
    expect(rows.map((r) => r.version)).toEqual(['0001_ok']);
  });

  it('nachträglich geänderte Migration wird erkannt', async () => {
    const s = await freshDatabase();
    const dir = await migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id int);' });
    await runMigrations(s.config, { migrationsDir: dir });
    await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE a (id bigint);');

    await expect(runMigrations(s.config, { migrationsDir: dir })).rejects.toThrow(/geändert/);
  });

  it('angewendete, aber fehlende Migrationsdatei wird erkannt', async () => {
    const s = await freshDatabase();
    const dir = await migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id int);' });
    await runMigrations(s.config, { migrationsDir: dir });
    await rm(join(dir, '0001_a.sql'));

    await expect(runMigrations(s.config, { migrationsDir: dir })).rejects.toThrow(/Datei fehlt/);
  });

  it('nur neue Migrationen laufen beim nächsten Start', async () => {
    const s = await freshDatabase();
    const dir = await migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id int);' });
    await runMigrations(s.config, { migrationsDir: dir });
    await writeFile(join(dir, '0002_b.sql'), 'ALTER TABLE a ADD COLUMN name text;');

    const result = await runMigrations(s.config, { migrationsDir: dir });

    expect(result.applied).toEqual(['0002_b']);
  });

  it('Kopie der Vorlage trägt schon alle Migrationen', async () => {
    db = await createTestDatabase('vorlage');

    expect((await runMigrations(db.config)).applied).toEqual([]);
  });
});
