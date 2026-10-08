import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Sichert ab, dass nur crypto-rng.ts Node-Module nutzt und die Engine sonst frei von I/O,
// Uhr und unkontrolliertem Zufall bleibt – inklusive Unterordnern. Dieselben Regeln prüft ESLint
// (Block „Engine-Reinheit“ in eslint.config.js, WP-008); dieser Test fängt sie auch ohne Lint-Lauf.
const ALLOWED_NODE_IMPORT = new Set(['crypto-rng.ts']);
const srcDir = new URL('.', import.meta.url);
const sources = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('Engine-Reinheit', () => {
  it('findet die Quelldateien (auch in Unterordnern)', () => {
    expect(sources).toContain('round.ts');
    expect(sources).toContain('crypto-rng.ts');
  });

  it.each(sources)('%s nutzt keine verbotenen APIs', (file) => {
    const code = readFileSync(new URL(file, srcDir), 'utf8');
    if (!ALLOWED_NODE_IMPORT.has(file)) {
      expect(code).not.toMatch(
        /(from\s+|import\s*\(\s*|require\s*\(\s*)['"](node:|fs|path|crypto|os|child_process|net|https?|dns|url|util|timers|worker_threads|perf_hooks)['"/]/,
      );
    }
    expect(code).not.toMatch(
      /Math\.random|\bDate\.|new Date\b|\bprocess\.|performance\.now|setTimeout|setInterval|setImmediate|globalThis\./,
    );
  });
});
