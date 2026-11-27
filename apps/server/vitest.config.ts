import { configDefaults, defineConfig } from 'vitest/config';

// Server-Tests ohne Datenbank (Teil von `npm run check`). Tests mit Datenbank heißen `*.db.test.ts` und laufen
// nur in der Stufe `db` (vitest.db.config.ts, .agents/rules/testing.md „Stufen“).
export default defineConfig({
  test: {
    name: '@poker/server',
    exclude: [...configDefaults.exclude, 'src/**/*.db.test.ts'],
  },
});
