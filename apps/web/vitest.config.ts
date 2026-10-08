import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Komponenten-Tests im Browser-Ersatz jsdom (WP-014). Eigene Datei, damit PWA-Plugin & Co. nicht mitlaufen.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    name: '@poker/web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
