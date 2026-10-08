import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Alles über Umgebungsvariablen, keine Hostnamen/Ports im Code (D-014).
// API_PROXY_TARGET: Ziel für /api und /ws im Dev-Server, z. B. http://server:4311 im Compose-Netz.
// WEB_DEV_PORT / WEB_DEV_HOST: Port und Bind-Adresse des Dev-Servers.
// VITE_USE_POLLING=true: Datei-Polling, falls Bind-Mount-Events (Docker Desktop) nicht ankommen.
// API_PROXY_ORIGIN (optional): Origin-Header für /api und /ws überschreiben – nur für einen zweiten
// Dev-Server gegen einen laufenden Game-Server mit anderer PUBLIC_ORIGIN (z. B. Playwright, WP-018).
const env = process.env;
const proxyTarget = env['API_PROXY_TARGET'];
const proxyOrigin = env['API_PROXY_ORIGIN'];
const proxyHeaders = proxyOrigin === undefined ? {} : { headers: { origin: proxyOrigin } };
const port = env['WEB_DEV_PORT'] === undefined ? undefined : Number(env['WEB_DEV_PORT']);

// Theme-/Hintergrundfarbe für Manifest und <meta name="theme-color"> kommen aus den Design-Tokens.
const tokens = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');
const bgMatch = /--color-bg:\s*(#[0-9a-fA-F]{6})/.exec(tokens);
if (bgMatch?.[1] === undefined) throw new Error('--color-bg fehlt in src/styles/tokens.css');
const themeColor = bgMatch[1];

// App-Version für das Feedback (WP-024): APP_VERSION (Docker-Build, gesetzt von scripts/prod.sh), sonst der
// aktuelle Commit (git), sonst „unbekannt“ (z. B. im dev-Container ohne git). Im Code: __APP_VERSION__.
function gitCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}
const appVersion = env['APP_VERSION']?.trim() || gitCommit() || 'unbekannt';

/** Ersetzt %THEME_COLOR% in index.html. */
function themeColorHtml(): Plugin {
  return {
    name: 'poker-theme-color',
    transformIndexHtml: (html) => html.replaceAll('%THEME_COLOR%', themeColor),
  };
}

/**
 * Platzhalter der Open-Graph-Tags in index.html (WP-030). Im Build bleibt er stehen – nginx ersetzt ihn pro Anfrage
 * durch die aufgerufene Origin (beide Domains, D-023); der Dev-Server setzt relative URLs ein.
 */
const OG_ORIGIN_PLACEHOLDER = '__POKER_ORIGIN__';
function ogOriginDevHtml(): Plugin {
  return {
    name: 'poker-og-origin-dev',
    apply: 'serve',
    transformIndexHtml: (html) => html.replaceAll(OG_ORIGIN_PLACEHOLDER, ''),
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    themeColorHtml(),
    ogOriginDevHtml(),
    // PWA (WP-014): Service Worker nur für statische Assets, nie für /api oder /ws.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Poker',
        short_name: 'Poker',
        description: 'Texas Hold’em mit Freunden – nur Spielgeld',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: themeColor,
        background_color: themeColor,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Vorschaubild nur für Messenger-Crawler (WP-030), nicht in den Offline-Cache.
        globIgnores: ['**/og-image.png'],
        cleanupOutdatedCaches: true,
        // SPA-Navigation offline aus dem Precache – aber nie für API und WebSocket.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/ws(\/|$)/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: env['WEB_DEV_HOST'] ?? '127.0.0.1',
    ...(port === undefined ? {} : { port, strictPort: true }),
    watch: { usePolling: env['VITE_USE_POLLING'] === 'true' },
    ...(proxyTarget === undefined
      ? {}
      : {
          proxy: {
            '/api': { target: proxyTarget, changeOrigin: true, ...proxyHeaders },
            '/ws': { target: proxyTarget, ws: true, changeOrigin: true, ...proxyHeaders },
          },
        }),
  },
});
