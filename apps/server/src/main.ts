// Einstiegspunkt: liest die Konfiguration aus der Umgebung und startet den Server.
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPgDatabase } from './db';
import { runMigrations } from './db/migrate';

const config = loadConfig(process.env);
const app = buildApp({ db: createPgDatabase(config.databaseUrl), logger: true });
// Schema aktualisieren, bevor Anfragen angenommen werden (WP-009); bei Fehler startet der Server nicht.
await runMigrations(config.databaseUrl, {
  log: (message) => {
    app.log.info(message);
  },
});

async function shutdown(): Promise<void> {
  await app.close();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
