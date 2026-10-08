// Einstiegspunkt: liest die Konfiguration aus der Umgebung und startet den Server.
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPgDatabase } from './db';
import { serverInfo } from './index';

const config = loadConfig(process.env);
const app = buildApp({
  db: createPgDatabase(config.databaseUrl),
  publicOrigin: config.publicOrigin,
  trustProxy: config.trustProxy,
  logger: true,
});

async function shutdown(): Promise<void> {
  await app.close();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
app.log.info({ ...serverInfo(), nodeEnv: config.nodeEnv, trustProxy: config.trustProxy }, 'Server gestartet');
