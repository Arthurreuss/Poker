// Prod-Build des Servers (WP-003): ein ESM-Bundle dist/server.mjs.
// Workspace-Pakete (@poker/*, exportieren TypeScript-Quellen) werden eingebettet,
// npm-Abhängigkeiten bleiben extern und kommen per `npm ci --omit=dev` ins Runtime-Image.
// Keine Source-Maps, nicht minifiziert (lesbare Stacktraces).
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@poker/'));

await build({
  entryPoints: [new URL('./src/main.ts', import.meta.url).pathname],
  outfile: new URL('./dist/server.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
