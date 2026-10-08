// Prod-Build des Servers (WP-003): ESM-Bundles dist/server.mjs und dist/cli/*.mjs (Admin-Skripte, WP-010/024).
// Workspace-Pakete (@poker/*, exportieren TypeScript-Quellen) werden eingebettet,
// npm-Abhängigkeiten bleiben extern und kommen per `npm ci --omit=dev` ins Runtime-Image.
// Keine Source-Maps, nicht minifiziert (lesbare Stacktraces).
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@poker/'));

await build({
  entryPoints: {
    server: new URL('./src/main.ts', import.meta.url).pathname,
    'cli/reset-password': new URL('./src/cli/reset-password.ts', import.meta.url).pathname,
    'cli/make-admin': new URL('./src/cli/make-admin.ts', import.meta.url).pathname,
    'cli/feedback': new URL('./src/cli/feedback.ts', import.meta.url).pathname,
  },
  outdir: new URL('./dist', import.meta.url).pathname,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
