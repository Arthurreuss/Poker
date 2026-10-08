import { defineConfig, devices } from '@playwright/test';

// Screenshot-Tests der Tischansicht (WP-016). Ausführen: `npm run test:visual -w @poker/web`.
// Eigener Vite-Dev-Server auf Port 4316 (D-006, Bereich 4310–4319), bedient table-dev.html.
// Nicht Teil von `npm run check` (langsam, Baselines sind plattformabhängig).
const PORT = 4316;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.pw.ts',
  outputDir: '../node_modules/.cache/playwright-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
  fullyParallel: true,
  reporter: 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: 'npx vite',
    cwd: '..',
    env: { WEB_DEV_PORT: String(PORT), WEB_DEV_HOST: '127.0.0.1' },
    url: `http://127.0.0.1:${String(PORT)}/table-dev.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
