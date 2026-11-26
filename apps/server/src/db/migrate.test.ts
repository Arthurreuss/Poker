// Migrationsdateien und Hash der Vorlage ohne Datenbank; der Runner gegen Postgres: migrate.db.test.ts.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMigrations, MigrationError } from './migrate';
import { schemaHash } from './test-db';

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

describe('schemaHash (Name der Vorlage-Datenbank)', () => {
  it('ändert sich mit jeder Migration und nur mit ihr', async () => {
    const dir = await migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id int);', 'README.txt': 'x' });
    const before = await schemaHash(dir);
    await writeFile(join(dir, 'README.txt'), 'y');
    expect(await schemaHash(dir)).toBe(before);
    await writeFile(join(dir, '0002_b.sql'), 'ALTER TABLE a ADD COLUMN name text;');
    expect(await schemaHash(dir)).not.toBe(before);
    expect(before).toMatch(/^[0-9a-f]{12}$/);
  });
});
