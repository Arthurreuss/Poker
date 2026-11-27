import { defineConfig } from 'vitest/config';

// Stufe `db` (.agents/rules/testing.md „Stufen“): nur `*.db.test.ts` gegen den Test-Postgres des Verbunds
// (FLEET_TEST_POSTGRES_URL, src/db/test-db.ts). Worker nach Buchung (FLEET_EINHEITEN), nie nach den Kernen.
const workers = Number(process.env['FLEET_EINHEITEN'] ?? 2);

export default defineConfig({
  test: {
    name: '@poker/server (db)',
    include: ['src/**/*.db.test.ts'],
    maxWorkers: Number.isInteger(workers) && workers > 0 ? workers : 2,
    // Der erste Lauf auf einem Test-Postgres baut die Vorlage (alle Migrationen).
    hookTimeout: 60_000,
  },
});
