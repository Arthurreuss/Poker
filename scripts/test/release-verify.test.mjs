// Release-Prüfung nach dem prod-Neustart (WP-020): Smoke-Test, dann E2E; schlägt einer fehl, bricht der Release
// mit Rollback-Hinweis ab. Trocken getestet – Smoke/E2E sind durch Stub-Befehle ersetzt, prod bleibt unberührt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../release-verify.sh', import.meta.url));
const release = readFileSync(new URL('../release.sh', import.meta.url), 'utf8');

/** Führt release-verify.sh mit Stub-Befehlen aus; `ran` sagt, welche Schritte gelaufen sind. */
function verify({ smoke, e2e, upScript = 'prod:tunnel:up' }) {
  const dir = mkdtempSync(join(tmpdir(), 'release-verify-'));
  try {
    const mark = (name, ok) => `touch "${join(dir, name)}" && ${ok ? 'true' : 'false'}`;
    const res = spawnSync('bash', [script, 'abc1234', upScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        POKER_PROD_DIR: dir, // kein Git-Repo: Hinweis zeigt „?“ als aktuellen Stand
        RELEASE_SMOKE_CMD: mark('smoke', smoke),
        RELEASE_E2E_CMD: mark('e2e', e2e),
      },
    });
    return {
      status: res.status,
      stdout: res.stdout,
      stderr: res.stderr,
      ran: ['smoke', 'e2e'].filter((n) => existsSync(join(dir, n))),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('beide grün: Exit 0, Smoke vor E2E', () => {
  const res = verify({ smoke: true, e2e: true });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.ran, ['smoke', 'e2e']);
  assert.ok(res.stdout.indexOf('Smoke-Test') < res.stdout.indexOf('E2E'));
  assert.match(res.stdout, /✓ prod geprüft/);
});

test('E2E rot: Release bricht ab und nennt den Rollback', () => {
  const res = verify({ smoke: true, e2e: false });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Release abgebrochen: E2E-Test fehlgeschlagen/);
  assert.match(res.stderr, /checkout --detach abc1234/);
  assert.match(res.stderr, /npm run prod:tunnel:up/);
  assert.match(res.stderr, /checkout main/);
  assert.match(res.stderr, /npm run prod:e2e/);
});

test('Smoke rot: E2E läuft gar nicht erst, Rollback-Hinweis mit prod:up', () => {
  const res = verify({ smoke: false, e2e: true, upScript: 'prod:up' });
  assert.equal(res.status, 1);
  assert.deepEqual(res.ran, ['smoke']);
  assert.match(res.stderr, /Release abgebrochen: Smoke-Test fehlgeschlagen/);
  assert.match(res.stderr, /npm run prod:up\n/);
});

test('release.sh merkt sich main vor dem Merge und prüft nach dem prod-Start mit release-verify.sh', () => {
  const prev = release.indexOf('PREV_MAIN="$(git -C "$POKER_PROD_DIR" rev-parse');
  const merge = release.indexOf('merge --no-ff');
  const up = release.indexOf('run "$UP_SCRIPT"');
  const check = release.indexOf('bash scripts/release-verify.sh "$PREV_MAIN" "$UP_SCRIPT"');
  assert.ok(prev > 0 && merge > prev, 'PREV_MAIN vor dem Merge');
  assert.ok(up > merge && check > up, 'Prüfung nach dem prod-Start');
  assert.match(release, /^set -euo pipefail$/m, 'Fehler der Prüfung bricht den Release ab');
  assert.ok(!release.slice(check).includes('prod:smoke'), 'Smoke-Test nur noch über release-verify.sh');
});

test('Aufruf ohne Argumente scheitert', () => {
  const res = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, POKER_PROD_DIR: tmpdir() } });
  assert.notEqual(res.status, 0);
});
