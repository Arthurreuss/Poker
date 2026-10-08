import { defineConfig, devices } from '@playwright/test';

// Ende-zu-Ende-Test des Spielablaufs (WP-018): eine komplette Runde mit drei Browsern.
// Ausführen: `npm run test:game -w @poker/web` – braucht den laufenden Dev-Stack (Game-Server auf 4311).
// Eigener Vite-Dev-Server auf Port 4317 (D-006), Proxy /api und /ws → 4311. Der Game-Server prüft den
// Origin gegen PUBLIC_ORIGIN (http://localhost:4310), daher setzt der Proxy diesen Origin (API_PROXY_ORIGIN).
// Nicht Teil von `npm run check` (braucht Server und Datenbank, legt Test-User `wp018_…` an).
// PW_PORT: andere Ports für parallele Sessions in Worktrees (Bereich 4310–4329, D-006).
const PORT = Number(process.env['PW_PORT'] ?? 4317);
const API = process.env['GAME_E2E_API'] ?? 'http://localhost:4311';
const ORIGIN = process.env['GAME_E2E_ORIGIN'] ?? 'http://localhost:4310';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.pw.ts',
  outputDir: '../node_modules/.cache/playwright-game-results',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite',
    cwd: '..',
    env: {
      WEB_DEV_PORT: String(PORT),
      WEB_DEV_HOST: '127.0.0.1',
      API_PROXY_TARGET: API,
      API_PROXY_ORIGIN: ORIGIN,
    },
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
