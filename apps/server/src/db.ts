import pg from 'pg';

/** Alles, was SQL ausführen kann: `Database`, `pg.Pool`, `pg.Client`. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

/** Minimale Datenbank-Schnittstelle, damit die App ohne echte DB testbar ist. */
export interface Database extends Queryable {
  /** Wirft, wenn die Datenbank nicht erreichbar ist. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** `connection`: URL oder vollständige Pool-Konfiguration (Tests setzen damit z. B. den `search_path`). */
export function createPgDatabase(connection: string | pg.PoolConfig): Database {
  const config = typeof connection === 'string' ? { connectionString: connection } : connection;
  const pool = new pg.Pool({ max: 5, connectionTimeoutMillis: 2000, ...config });
  // Fehler im Leerlauf (z. B. DB-Neustart) dürfen den Prozess nicht beenden.
  pool.on('error', () => undefined);
  return {
    async ping() {
      await pool.query('SELECT 1');
    },
    query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) {
      return pool.query<R>(text, values);
    },
    async close() {
      await pool.end();
    },
  };
}
