import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { checkDecisions, checkLinks, runCheck } from '../docs.mjs';

test('Entscheidungs-IDs fortlaufend', () => {
  assert.deepEqual(checkDecisions('## D-001: a\n## D-002: b'), []);
  assert.equal(checkDecisions('## D-001: a\n## D-003: b').length, 1);
  assert.equal(checkDecisions('## D-001: a\n## D-001: b').length, 1);
});

test('Links: relative Ziele müssen existieren, Code und URLs ignoriert', () => {
  const exists = (p) => p === 'docs/da.md';
  const files = {
    'docs/a.md':
      '[ok](da.md#x) [web](https://x.de) [anker](#y) `[code](weg.md)`\n```\n[block](weg.md)\n```\n[kaputt](fehlt.md)',
  };
  assert.deepEqual(checkLinks(files, exists), ['docs/a.md: kaputter Link → fehlt.md']);
});

test('das echte Repo besteht den Check', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  assert.deepEqual(runCheck(root), []);
});
