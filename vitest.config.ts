import { defineConfig } from 'vitest/config';

// Ein Lauf über alle Workspaces; jeder Workspace ist ein eigenes Vitest-Projekt.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
