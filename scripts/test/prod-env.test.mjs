// Gemeinsame Helfer der prod-Skripte (scripts/lib/prod-env.sh): Backup-Ordner (D-037) und Ort der Env-Datei für
// den Secrets-Hook des Dienstes backup. Läuft gegen einen temporären „Checkout“ mit leerem compose.prod.yml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = fileURLToPath(new URL('../lib/prod-env.sh', import.meta.url));

/** Bindet prod-env.sh ein und gibt BACKUP_DIR, PROD_ENV_DIR und PROD_ENV_NAME zurück. */
function resolve(t, { env = {}, envFile = '' } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'poker-prod-env-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'compose.prod.yml'), '');
  writeFileSync(join(dir, '.env.prod'), envFile);
  const base = { ...process.env };
  delete base.BACKUP_DIR;
  delete base.PROD_ENV_FILE;
  const res = spawnSync(
    'sh',
    ['-c', '. "$1"; printf "%s\\n" "$BACKUP_DIR" "$PROD_ENV_DIR" "$PROD_ENV_NAME"', 'sh', LIB],
    {
      encoding: 'utf8',
      env: { ...base, HOME: homedir(), POKER_PROD_DIR: dir, ...env },
    },
  );
  assert.equal(res.status, 0, res.stderr);
  const [backupDir, envDir, envName] = res.stdout.trimEnd().split('\n');
  return { dir, backupDir, envDir, envName };
}

test('BACKUP_DIR: Standard ist der gemeinsame Server-Ordner /Users/Shared/fleet/backups/poker', (t) => {
  assert.equal(resolve(t).backupDir, '/Users/Shared/fleet/backups/poker');
});

test('BACKUP_DIR: Wert aus .env.prod, ~/ wird aufgelöst', (t) => {
  assert.equal(resolve(t, { envFile: 'BACKUP_DIR=/Volumes/Backup/poker\n' }).backupDir, '/Volumes/Backup/poker');
  assert.equal(resolve(t, { envFile: 'BACKUP_DIR=~/b\n' }).backupDir, `${homedir()}/b`);
});

test('Env-Datei für den Secrets-Hook: Ordner absolut, Name getrennt', (t) => {
  const { dir, envDir, envName } = resolve(t);
  assert.equal(envDir, dir);
  assert.equal(envName, '.env.prod');

  const other = resolve(t, { env: { PROD_ENV_FILE: '/tmp/restoretest/env' } });
  assert.equal(other.envDir, '/tmp/restoretest');
  assert.equal(other.envName, 'env');
});
