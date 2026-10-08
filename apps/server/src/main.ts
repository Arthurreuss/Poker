// Einstiegspunkt: liest die Konfiguration aus der Umgebung und startet den Server.
import { startAuditPurgeJob } from './admin/audit';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPgDatabase } from './db';
import { runMigrations } from './db/migrate';
import { startFeedbackPurgeJob } from './feedback/retention';
import { closeOrphanedTables } from './game/pg-repository';
import { serverInfo } from './index';

const config = loadConfig(process.env);
const db = createPgDatabase(config.databaseUrl);
const app = buildApp({
  db,
  publicOrigin: config.publicOrigins,
  trustProxy: config.trustProxy,
  // prod: in eine Datei, die der Dienst logrotate täglich rotiert und nach spätestens 14 Tagen löscht (D-025).
  logger: config.logFile === null ? true : { file: config.logFile },
});
// Schema aktualisieren, bevor Anfragen angenommen werden (WP-009); bei Fehler startet der Server nicht.
// MIGRATIONS_DIR setzt das Prod-Image (gebündelter Server, D-015); in dev gilt der Standardpfad.
const migrationsDir = process.env.MIGRATIONS_DIR;
await runMigrations(config.databaseUrl, {
  ...(migrationsDir ? { migrationsDir } : {}),
  log: (message) => {
    app.log.info(message);
  },
});

// Tische leben nur im Speicher (WP-011): was vor dem Neustart offen war oder lief, ist verloren.
// Laufende Runden → aborted (ohne Punkte), offene/laufende Tische → closed; gespeicherte Hände bleiben (D-019).
const orphaned = await closeOrphanedTables(db);
if (orphaned.rounds > 0 || orphaned.tables > 0) {
  app.log.warn(orphaned, 'Nach Neustart: verwaiste Runden abgebrochen und Tische geschlossen');
}

// Speicherdauer von Feedback (D-025): jetzt und dann täglich abgelaufene Einträge löschen.
const feedbackPurge = startFeedbackPurgeJob({ db, log: app.log });
// Admin-Protokoll (D-025, WP-028): Einträge nach 1 Jahr löschen.
const auditPurge = startAuditPurgeJob({ db, log: app.log });

async function shutdown(): Promise<void> {
  feedbackPurge.stop();
  auditPurge.stop();
  await app.close();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
app.log.info({ ...serverInfo(), nodeEnv: config.nodeEnv, trustProxy: config.trustProxy }, 'Server gestartet');
