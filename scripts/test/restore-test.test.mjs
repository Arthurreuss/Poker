// Rücksicherungs-Test für den Job ruecksicherung-poker des Server-Verbunds (scripts/restore_test.sh). Läuft in einem
// Wegwerf-Checkout mit gefälschtem docker (kein Docker, prod bleibt unberührt) und gefälschten Sicherungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const restoreTest = fileURLToPath(new URL('../restore_test.sh', import.meta.url));
const composeProd = fileURLToPath(new URL('../../compose.prod.yml', import.meta.url));

// Gefälschtes docker: schreibt jeden Aufruf ins Log, legt die eingespielte Sicherung ab und beantwortet die Abfragen.
const fakeDocker = `#!/bin/bash
echo "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "image inspect") exit "\${FAKE_IMAGE_EXIT:-0}" ;;
  "run -d") echo id ;;
  "rm -f") ;;
  "exec -i") cat > "$FAKE_STDIN"; exit "\${FAKE_RESTORE_EXIT:-0}" ;;
  exec*)
    case "$*" in
      *pg_isready*) ;;
      *"to_regclass('public.\${FAKE_MISSING:-}')"*) echo f ;;
      *to_regclass*) echo t ;;
      *"max(version)"*) echo "\${FAKE_STAND-0008_user_avatar}" ;;
      *"count(*) FROM users"*) echo 2 ;;
      *) exit 9 ;;
    esac ;;
  *) exit 9 ;;
esac
`;

/** Wegwerf-Checkout mit restore_test.sh, compose.prod.yml, .env.prod und Tagessicherungen (neueste: 20261126). */
function checkout({ backups = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'restore-test-'));
  const repo = join(dir, 'poker');
  const bin = join(dir, 'bin');
  const daily = join(dir, 'backups', 'daily');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(bin);
  mkdirSync(daily, { recursive: true });
  copyFileSync(restoreTest, join(repo, 'scripts', 'restore_test.sh'));
  copyFileSync(composeProd, join(repo, 'compose.prod.yml'));
  writeFileSync(join(repo, '.env.prod'), `POSTGRES_PASSWORD=x\nBACKUP_DIR=${join(dir, 'backups')}\n`);
  writeFileSync(join(bin, 'docker'), fakeDocker);
  chmodSync(join(bin, 'docker'), 0o755);
  if (backups) {
    writeFileSync(join(daily, 'poker-20261125.sql.gz'), gzipSync('-- alt\n'));
    writeFileSync(join(daily, 'poker-20261126.sql.gz'), gzipSync('-- neu\n'));
    utimesSync(join(daily, 'poker-20261125.sql.gz'), 1000, 1000);
    utimesSync(join(daily, 'poker-20261126.sql.gz'), 2000, 2000);
    symlinkSync('poker-20261125.sql.gz', join(daily, 'poker-latest.sql.gz'));
  }
  const log = join(dir, 'docker.log');
  const stdin = join(dir, 'stdin.sql');
  const run = (extraEnv = {}) => {
    const res = spawnSync('bash', [join(repo, 'scripts', 'restore_test.sh')], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        DOCKER_HOST: 'unix:///nicht/da.sock',
        FAKE_LOG: log,
        FAKE_STDIN: stdin,
        ...extraEnv,
      },
    });
    let calls = [];
    try {
      calls = readFileSync(log, 'utf8').trimEnd().split('\n');
    } catch {
      // docker nicht aufgerufen
    }
    return { status: res.status, out: res.stdout + res.stderr, err: res.stderr, calls, stdin };
  };
  return { dir, repo, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('ohne DOCKER_HOST: Exit 75, docker wird nicht gerufen', () => {
  const c = checkout();
  try {
    const res = c.run({ DOCKER_HOST: '' });
    assert.equal(res.status, 75, res.out);
    assert.match(res.err, /^❌ DOCKER_HOST fehlt/);
    assert.deepEqual(res.calls, []);
  } finally {
    c.cleanup();
  }
});

test('neueste Tagessicherung in Wegwerf-Postgres ohne Netz auf tmpfs, danach weggeräumt', () => {
  const c = checkout();
  try {
    const res = c.run();
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /✅ Rücksicherung bestanden: poker-20261126\.sql\.gz, .*Migration 0008_user_avatar, 2 Konto/);
    assert.equal(readFileSync(res.stdin, 'utf8'), '-- neu\n');
    assert.ok(res.calls.includes('image inspect postgres:16-alpine'), res.calls.join('\n'));
    const start = res.calls.find((call) => call.startsWith('run -d'));
    assert.match(start, /--network none --tmpfs \/var\/lib\/postgresql\/data /);
    assert.match(start, /POSTGRES_USER=poker .*POSTGRES_DB=poker .*postgres:16-alpine$/);
    assert.match(
      res.calls.find((call) => call.startsWith('exec -i')),
      /--single-transaction/,
    );
    assert.match(res.calls.at(-1), /^rm -f -v poker-ruecksicherung-\d+$/);
    assert.ok(!res.calls.some((call) => /poker-prod/.test(call)), 'prod nie berührt');
  } finally {
    c.cleanup();
  }
});

test('fehlende Tabelle ist rot, der Container wird trotzdem weggeräumt', () => {
  const c = checkout();
  try {
    const res = c.run({ FAKE_MISSING: 'hand_actions' });
    assert.equal(res.status, 1, res.out);
    assert.match(res.err, /^❌ Tabelle hand_actions fehlt nach der Rücksicherung/);
    assert.match(res.calls.at(-1), /^rm -f -v poker-ruecksicherung-/);
  } finally {
    c.cleanup();
  }
});

test('fehlender Stand der Migrationen ist rot', () => {
  const c = checkout();
  try {
    const res = c.run({ FAKE_STAND: '' });
    assert.equal(res.status, 1, res.out);
    assert.match(res.err, /^❌ Stand der Migrationen fehlt/);
  } finally {
    c.cleanup();
  }
});

test('Einspielen schlägt fehl: rot', () => {
  const c = checkout();
  try {
    const res = c.run({ FAKE_RESTORE_EXIT: '3' });
    assert.equal(res.status, 1, res.out);
    assert.match(res.err, /^❌ Sicherung lässt sich nicht einspielen/);
    assert.match(res.calls.at(-1), /^rm -f -v poker-ruecksicherung-/);
  } finally {
    c.cleanup();
  }
});

test('ohne Tagessicherung oder ohne Image: rot, kein Container', () => {
  const ohne = checkout({ backups: false });
  try {
    const res = ohne.run();
    assert.equal(res.status, 1, res.out);
    assert.match(res.err, /^❌ keine Tagessicherung in /);
    assert.ok(!res.calls.some((call) => call.startsWith('run')));
  } finally {
    ohne.cleanup();
  }
  const c = checkout();
  try {
    const res = c.run({ FAKE_IMAGE_EXIT: '1' });
    assert.equal(res.status, 1, res.out);
    assert.match(res.err, /^❌ Image postgres:16-alpine fehlt in der Prod-VM/);
    assert.ok(!res.calls.some((call) => call.startsWith('run')));
  } finally {
    c.cleanup();
  }
});
