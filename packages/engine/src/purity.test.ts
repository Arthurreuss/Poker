import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Sichert ab, dass nur crypto-rng.ts Node-Module nutzt und die Engine sonst frei von I/O,
// Uhr und unkontrolliertem Zufall bleibt. (Eine Lint-Regel dafür folgt laut WP-008.)
const ALLOWED_NODE_IMPORT = new Set(['crypto-rng.ts']);
const srcDir = new URL('.', import.meta.url);
const sources = readdirSync(srcDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('Engine-Reinheit', () => {
  it.each(sources)('%s nutzt keine verbotenen APIs', (file) => {
    const code = readFileSync(new URL(file, srcDir), 'utf8');
    if (!ALLOWED_NODE_IMPORT.has(file)) {
      expect(code).not.toMatch(/from\s+['"](node:|fs|path|crypto|os|child_process|net|http)/);
    }
    expect(code).not.toMatch(/Math\.random|Date\.now|new Date\(|process\.|performance\.now/);
  });
});
