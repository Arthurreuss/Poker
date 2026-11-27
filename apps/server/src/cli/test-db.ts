// Testdatenbank für die Stufe `e2e` (scripts/ci_job.sh), nicht Teil des Prod-Builds: Kopie der Vorlage auf dem
// Test-Postgres des Verbunds (FLEET_TEST_POSTGRES_URL, src/db/test-db.ts) anlegen und wieder löschen.
// Aufruf: npm run -s test-db -w @poker/server -- anlegen <zusatz>   → Zeile „<name> <url>“
//         npm run -s test-db -w @poker/server -- loeschen <name>
import { createTestDatabase, dropTestDatabase } from '../db/test-db';

const [befehl, arg] = process.argv.slice(2);
if (befehl === 'anlegen' && arg !== undefined) {
  const db = await createTestDatabase(arg);
  await db.pool.end();
  console.log(`${db.name} ${db.url}`);
} else if (befehl === 'loeschen' && arg !== undefined) {
  await dropTestDatabase(arg);
} else {
  console.error('Aufruf: test-db anlegen <zusatz> | test-db loeschen <name>');
  process.exit(2);
}
