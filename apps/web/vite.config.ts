import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Alles über Umgebungsvariablen, keine Hostnamen/Ports im Code (D-014).
// API_PROXY_TARGET: Ziel für /api und /ws im Dev-Server, z. B. http://server:4311 im Compose-Netz.
// WEB_DEV_PORT / WEB_DEV_HOST: Port und Bind-Adresse des Dev-Servers.
// VITE_USE_POLLING=true: Datei-Polling, falls Bind-Mount-Events (Docker Desktop) nicht ankommen.
const env = process.env;
const proxyTarget = env['API_PROXY_TARGET'];
const port = env['WEB_DEV_PORT'] === undefined ? undefined : Number(env['WEB_DEV_PORT']);

export default defineConfig({
  plugins: [react()],
  server: {
    host: env['WEB_DEV_HOST'] ?? '127.0.0.1',
    ...(port === undefined ? {} : { port, strictPort: true }),
    watch: { usePolling: env['VITE_USE_POLLING'] === 'true' },
    ...(proxyTarget === undefined
      ? {}
      : {
          proxy: {
            '/api': { target: proxyTarget, changeOrigin: true },
            '/ws': { target: proxyTarget, ws: true, changeOrigin: true },
          },
        }),
  },
});
