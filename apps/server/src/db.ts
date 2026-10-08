import pg from 'pg';

/** Minimale Datenbank-Schnittstelle, damit die App ohne echte DB testbar ist. */
export interface Database {
  /** Wirft, wenn die Datenbank nicht erreichbar ist. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createPgDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 2000 });
  // Fehler im Leerlauf (z. B. DB-Neustart) dürfen den Prozess nicht beenden.
  pool.on('error', () => undefined);
  return {
    async ping() {
      await pool.query('SELECT 1');
    },
    async close() {
      await pool.end();
    },
  };
}
