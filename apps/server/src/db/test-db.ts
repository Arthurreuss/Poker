// Test-Postgres nach .agents/rules/testing.md „Testdatenbanken und App“:
// - Server: FLEET_TEST_POSTGRES_URL (Test-Postgres des Verbunds im Paket der Warteschlange). Fehlt sie oder
//   antwortet er nicht, ist jeder Test mit Datenbank rot mit Hinweis; einen eigenen Postgres startet die Suite nie.
// - Vorlage `poker_tpl_<hash>` (Hash über Migrationen und Migrations-Runner), unter einer Advisory-Sperre als
//   `poker_lauf_<lauf>_vorlage` gebaut und erst fertig umbenannt; sie überlebt Läufe.
// - Jede Testdatenbank ist eine Kopie der Vorlage, `poker_lauf_<lauf>_<zusatz>_<zufall>`, und wird am Ende
//   gelöscht. `<lauf>` sind die ersten 8 Zeichen von RUN_ID (scripts/ci_job.sh), sonst zufällig. Nur die
//   Migrationstests nehmen eine leere Datenbank (`createEmptyDatabase`).
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DEFAULT_MIGRATIONS_DIR, runMigrations } from './migrate';

const PROJEKT = 'poker';
/** Advisory-Sperre für den Bau der Vorlagen (auf der Wartungs-Datenbank der Server-URL). */
const VORLAGE_SPERRE = 4_310_019;
const MIGRATE_RUNNER = fileURLToPath(new URL('./migrate.ts', import.meta.url));
const HINWEIS =
  'Tests mit Datenbank laufen über die Warteschlange: python3 scripts/pruefung.py db ' +
  '(.agents/rules/testing.md „Testdatenbanken und App“). Einen eigenen Postgres startet die Suite nicht.';

export interface TestDatabase {
  /** Name der Datenbank (`poker_lauf_…`). */
  name: string;
  /** Verbindungs-URL der Datenbank. */
  url: string;
  /** Client-Konfiguration für `runMigrations` und eigene Pools (`createPgDatabase`). */
  config: pg.ClientConfig;
  pool: pg.Pool;
  /** Schließt den Pool und löscht die Datenbank. */
  drop(): Promise<void>;
}

const lauf = (
  (process.env['RUN_ID'] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || randomBytes(4).toString('hex')
).slice(0, 8);

let serverUrl: Promise<string> | undefined;

/** Adresse des Test-Postgres; wirft mit Hinweis, wenn er fehlt oder nicht antwortet. */
function server(): Promise<string> {
  serverUrl ??= (async () => {
    const url = process.env['FLEET_TEST_POSTGRES_URL']?.trim();
    if (!url) throw new Error(`FLEET_TEST_POSTGRES_URL ist nicht gesetzt. ${HINWEIS}`);
    const probe = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await probe.connect();
    } catch (err) {
      throw new Error(`FLEET_TEST_POSTGRES_URL antwortet nicht (${String(err)}). ${HINWEIS}`, { cause: err });
    } finally {
      await probe.end().catch(() => undefined);
    }
    return url;
  })();
  return serverUrl;
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: await server() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Hash über alles, was das Schema bestimmt: die Migrationen und den Runner (`schema_migrations`). */
export async function schemaHash(migrationsDir: string = DEFAULT_MIGRATIONS_DIR): Promise<string> {
  const hash = createHash('sha256');
  for (const file of (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()) {
    hash.update(file).update(await readFile(`${migrationsDir}/${file}`));
  }
  hash.update(await readFile(MIGRATE_RUNNER));
  return hash.digest('hex').slice(0, 12);
}

/** Name der Vorlage zum aktuellen Schema; baut sie, wenn es sie noch nicht gibt. */
async function vorlage(): Promise<string> {
  const name = `${PROJEKT}_tpl_${await schemaHash()}`;
  const base = await server();
  return admin(async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [VORLAGE_SPERRE]);
    try {
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (rowCount) return name;
      const bau = `${PROJEKT}_lauf_${lauf}_vorlage`;
      await client.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(bau)} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${pg.escapeIdentifier(bau)}`);
      await runMigrations(urlFor(base, bau));
      await client.query(`ALTER DATABASE ${pg.escapeIdentifier(bau)} RENAME TO ${pg.escapeIdentifier(name)}`);
      return name;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [VORLAGE_SPERRE]).catch(() => undefined);
    }
  });
}

/** Löscht eine Testdatenbank dieses Projekts (auch mit offenen Verbindungen). */
export async function dropTestDatabase(name: string): Promise<void> {
  if (!name.startsWith(`${PROJEKT}_lauf_`)) throw new Error(`keine Testdatenbank: ${name}`);
  await admin((client) => client.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`));
}

async function anlegen(zusatz: string, template: string | null): Promise<TestDatabase> {
  if (!/^[a-z0-9_]{1,20}$/.test(zusatz)) throw new Error(`ungültiger Zusatz: ${zusatz}`);
  const name = `${PROJEKT}_lauf_${lauf}_${zusatz}_${randomBytes(4).toString('hex')}`;
  const vorlageSql = template === null ? '' : ` TEMPLATE ${pg.escapeIdentifier(template)}`;
  await admin((client) => client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}${vorlageSql}`));
  const url = urlFor(await server(), name);
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  pool.on('error', () => undefined);
  return {
    name,
    url,
    config: { connectionString: url },
    pool,
    async drop() {
      await pool.end();
      await dropTestDatabase(name);
    },
  };
}

/** Neue Testdatenbank als Kopie der Vorlage (Schema auf dem Stand aller Migrationen). */
export async function createTestDatabase(zusatz: string): Promise<TestDatabase> {
  return anlegen(zusatz, await vorlage());
}

/** Leere Datenbank ohne Schema, nur für Migrationstests. */
export function createEmptyDatabase(zusatz: string): Promise<TestDatabase> {
  return anlegen(zusatz, null);
}
