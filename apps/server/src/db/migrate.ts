// Eigener, kleiner Migrations-Runner für reine SQL-Dateien (D-010, WP-009).
// Ablauf und Begründung: docs/ARCHITECTURE.md, Abschnitt „Datenmodell“.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Verzeichnis `apps/server/migrations` (relativ zu dieser Datei, unabhängig vom Arbeitsverzeichnis). */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Fester Schlüssel für `pg_advisory_lock`: serialisiert parallel startende Instanzen. */
export const MIGRATION_LOCK_KEY = 4_310_009;

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
  /** Dateiname ohne `.sql`, z. B. `0001_initial`; Primärschlüssel in `schema_migrations`. */
  version: string;
  sql: string;
  /** SHA-256 des Dateiinhalts (hex). */
  checksum: string;
}

export interface MigrateOptions {
  /** Standard: {@link DEFAULT_MIGRATIONS_DIR}. */
  migrationsDir?: string;
  log?: (message: string) => void;
}

export interface MigrateResult {
  /** In diesem Lauf angewendete Versionen (leer = nichts zu tun). */
  applied: string[];
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

/** Liest und validiert alle Migrationsdateien, sortiert nach Nummer. */
export async function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set<string>();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match?.[1]) {
      throw new MigrationError(`Ungültiger Migrations-Dateiname: ${file} (erwartet NNNN_name.sql)`);
    }
    if (seen.has(match[1])) {
      throw new MigrationError(`Migrationsnummer ${match[1]} ist doppelt vergeben`);
    }
    seen.add(match[1]);
    const sql = await readFile(`${dir}/${file}`, 'utf8');
    migrations.push({
      version: file.slice(0, -'.sql'.length),
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return migrations;
}

/**
 * Wendet alle noch fehlenden Migrationen an.
 *
 * - Eine eigene Verbindung hält während des ganzen Laufs einen Advisory-Lock; eine zweite Instanz wartet
 *   und findet danach nichts mehr zu tun.
 * - Jede Migration läuft samt Eintrag in `schema_migrations` in einer eigenen Transaktion.
 * - Bereits angewendete Migrationen dürfen sich nicht ändern (Checksumme) und nicht fehlen.
 *
 * `connection` ist eine Verbindungs-URL oder eine `pg`-Client-Konfiguration (Tests setzen damit `search_path`).
 */
export async function runMigrations(
  connection: string | pg.ClientConfig,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const migrations = await loadMigrations(options.migrationsDir);
  const log = options.log ?? (() => undefined);
  const client = new pg.Client(typeof connection === 'string' ? { connectionString: connection } : connection);
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      return await applyPending(client, migrations, log);
    } finally {
      // Best effort: schlägt das fehl, gibt spätestens client.end() den Lock frei.
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    await client.end();
  }
}

async function applyPending(
  client: pg.Client,
  migrations: Migration[],
  log: (message: string) => void,
): Promise<MigrateResult> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const { rows } = await client.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  const known = new Map(migrations.map((m) => [m.version, m]));
  const appliedVersions = new Set<string>();
  for (const row of rows) {
    const migration = known.get(row.version);
    if (!migration) {
      throw new MigrationError(`Migration ${row.version} ist in der DB angewendet, aber die Datei fehlt`);
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        `Migration ${row.version} wurde nach dem Anwenden geändert – neue Migration anlegen statt alte ändern`,
      );
    }
    appliedVersions.add(row.version);
  }

  const applied: string[] = [];
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        migration.version,
        migration.checksum,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new MigrationError(`Migration ${migration.version} fehlgeschlagen: ${String(err)}`, { cause: err });
    }
    applied.push(migration.version);
    log(`Migration ${migration.version} angewendet`);
  }
  return { applied };
}
