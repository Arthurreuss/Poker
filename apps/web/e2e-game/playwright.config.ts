import { defineConfig, devices } from '@playwright/test';

// Ende-zu-Ende-Tests mit echten Browsern gegen einen laufenden Server (WP-018, WP-020):
// - round.pw.ts: komplette Runde mit drei Browsern (Tisch über den Dev-Helfer, nur Dev-Build)
// - smoke.pw.ts: E2E-Smoke-Test – zwei Spieler, Registrierung und Tisch über die Lobby, Runde bis zum Ende
// Ziele (D-028):
// - ohne E2E_BASE_URL: eigener Vite-Dev-Server auf Port 4317 bzw. PW_PORT (D-006, für parallele Worktrees) mit dem Code dieses Checkouts, Proxy
//   /api und /ws → GAME_E2E_API (Standard 4311); der Proxy setzt den Origin GAME_E2E_ORIGIN (PUBLIC_ORIGIN
//   von dev). `npm run test:game -w @poker/web`
// - E2E_BASE_URL=http://localhost:4310: direkt gegen den dev-Docker. `npm run test:e2e -w @poker/web`
// - zusätzlich E2E_ORIGIN: lokaler Origin-Proxy (scripts/e2e-origin-proxy.mjs) auf E2E_PROXY_PORT (Standard 4326)
//   vor E2E_BASE_URL, der die Origin durch E2E_ORIGIN ersetzt – für prod (localhost:4320), dessen WebSocket nur
//   PUBLIC_ORIGIN annimmt. `npm run prod:e2e`
// Nicht Teil von `npm run check` (braucht Server und Datenbank). Test-User werden am Ende gelöscht.
const env = process.env;
const VITE_PORT = Number(env['PW_PORT'] ?? 4317);
const target = env['E2E_BASE_URL'];
const origin = env['E2E_ORIGIN'];
const proxyPort = Number(env['E2E_PROXY_PORT'] ?? 4326);

function setup() {
  if (target === undefined) {
    return {
      baseURL: `http://127.0.0.1:${String(VITE_PORT)}`,
      webServer: {
        command: 'npx vite',
        cwd: '..',
        env: {
          WEB_DEV_PORT: String(VITE_PORT),
          WEB_DEV_HOST: '127.0.0.1',
          API_PROXY_TARGET: env['GAME_E2E_API'] ?? 'http://localhost:4311',
          API_PROXY_ORIGIN: env['GAME_E2E_ORIGIN'] ?? 'http://localhost:4310',
        },
        url: `http://127.0.0.1:${String(VITE_PORT)}/`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
    };
  }
  if (origin === undefined) return { baseURL: target, webServer: undefined };
  // `localhost` statt 127.0.0.1: dort nimmt Chromium auch `Secure`-Cookies (prod) über http an.
  return {
    baseURL: `http://localhost:${String(proxyPort)}`,
    webServer: {
      command: 'node ../../scripts/e2e-origin-proxy.mjs',
      cwd: '..',
      env: { E2E_PROXY_TARGET: target, E2E_PROXY_ORIGIN: origin, E2E_PROXY_PORT: String(proxyPort) },
      url: `http://127.0.0.1:${String(proxyPort)}/api/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  };
}

const { baseURL, webServer } = setup();

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
    baseURL,
    trace: 'retain-on-failure',
  },
  ...(webServer === undefined ? {} : { webServer }),
});
