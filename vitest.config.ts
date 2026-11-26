import { defineConfig } from 'vitest/config';

// Ein Lauf über alle Workspaces; jeder Workspace ist ein eigenes Vitest-Projekt.
// Im Prüfpaket (Stufe `test`) Worker nach Buchung (FLEET_EINHEITEN), nie nach den Kernen der Maschine.
const workers = Number(process.env['FLEET_EINHEITEN']);

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    ...(Number.isInteger(workers) && workers > 0 ? { maxWorkers: workers } : {}),
  },
});
