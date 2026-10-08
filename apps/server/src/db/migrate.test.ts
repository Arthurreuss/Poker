import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMigrations, MigrationError, runMigrations } from './migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from './test-db';

const tempDirs: string[] = [];

async function migrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'poker-migrations-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(dir, name), sql);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadMigrations', () => {
  it('liest die Migrationen des Servers sortiert und mit Checksumme', async () => {
    const migrations = await loadMigrations();
    expect(migrations.map((m) => m.version)).toContain('0001_initial');
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((m) => m.version).sort());
    for (const m of migrations) expect(m.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignoriert Nicht-SQL-Dateien und sortiert nach Nummer', async () => {
    const dir = await migrationsDir({ '0002_b.sql': 'SELECT 2', '0001_a.sql': 'SELECT 1', 'README.txt': 'x' });
    expect((await loadMigrations(dir)).map((m) => m.version)).toEqual(['0001_a', '0002_b']);
  });

  it.each([['1_kurz.sql'], ['0001-bindestrich.sql'], ['0001_Gross.sql']])('lehnt %s ab', async (file) => {
    const dir = await migrationsDir({ [file]: 'SELECT 1' });
    await expect(loadMigrations(dir)).rejects.toThrow(MigrationError);
  });

  it('lehnt doppelte Nummern ab', async () => {
    const dir = await migrationsDir({ '0001_a.sql': 'SELECT 1', '0001_b.sql': 'SELECT 1' });
    await expect(loadMigrations(dir)).rejects.toThrow('doppelt');
  });
});

describe.skipIf(testDatabaseUrl === undefined)('runMigrations (Test-DB)', () => {
  const url = testDatabaseUrl ?? '';
  let schema: TestSchema | undefined;

  async function freshSchema(): Promise<TestSchema> {
    schema = await createTestSchema(url);
    return schema;
  }

  async function tablesIn(s: TestSchema): Promise<string[]> {
    const { rows } = await s.pool.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [s.name],
    );
    return rows.map((r) => r.table_name);
  }

  afterEach(async () => {
    await schema?.drop();
    schema = undefined;
  });

  it('frische DB: alle Migrationen laufen durch und legen das Schema an', async () => {
    const s = await freshSchema();
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
    const s = await freshSchema();
    await runMigrations(s.config);
    const before = await s.pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY 1');

    const result = await runMigrations(s.config);

    expect(result.applied).toEqual([]);
    const after = await s.pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY 1');
    expect(after.rows).toEqual(before.rows);
  });

  it('parallel startende Instanzen wenden jede Migration genau einmal an (Advisory-Lock)', async () => {
    const s = await freshSchema();
    const all = (await loadMigrations()).map((m) => m.version);

    const results = await Promise.all([runMigrations(s.config), runMigrations(s.config), runMigrations(s.config)]);

    expect(results.flatMap((r) => r.applied).sort()).toEqual(all);
    const { rows } = await s.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0]?.n).toBe(all.length);
  });

  it('fehlschlagende Migration wird vollständig zurückgerollt, vorherige bleiben', async () => {
    const s = await freshSchema();
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
    const s = await freshSchema();
    const dir = await migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id int);' });
    await runMigrations(s.config, { migrationsDir: dir });
    await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE a (id bigint);');

    await expect(runMigrations(s.config, { migrationsDir: dir })).rejects.toThrow(/geändert/);
  });

  it('angewendete, aber fehlende Migrationsdatei wird erkannt', async () => {
    const s = await freshSchema();
    const dir = await migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id int);' });
    await runMigrations(s.config, { migrationsDir: dir });
    await rm(join(dir, '0001_a.sql'));

    await expect(runMigrations(s.config, { migrationsDir: dir })).rejects.toThrow(/Datei fehlt/);
  });

  it('nur neue Migrationen laufen beim nächsten Start', async () => {
    const s = await freshSchema();
    const dir = await migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id int);' });
    await runMigrations(s.config, { migrationsDir: dir });
    await writeFile(join(dir, '0002_b.sql'), 'ALTER TABLE a ADD COLUMN name text;');

    const result = await runMigrations(s.config, { migrationsDir: dir });

    expect(result.applied).toEqual(['0002_b']);
  });
});
