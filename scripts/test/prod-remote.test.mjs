// prod-Befehle an den prod-Host (D-036): scripts/prod-remote.sh setzt die SSH-Aufrufe richtig zusammen.
// Trocken getestet – ssh ist durch ein Stub-Skript ersetzt, das seine Argumente protokolliert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../prod-remote.sh', import.meta.url));

/** Führt prod-remote.sh mit Stub-ssh aus; liefert die Argumente des letzten ssh-Aufrufs (eins pro Zeile). */
function run(args, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'prod-remote-'));
  try {
    const log = join(dir, 'ssh.log');
    const stub = join(dir, 'ssh');
    writeFileSync(stub, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${log}"\n`);
    chmodSync(stub, 0o755);
    const env = { ...process.env, POKER_PROD_SSH: stub, POKER_PROD_HOST: 'prod.test', POKER_PROD_REMOTE_DIR: 'poker' };
    delete env.POKER_PROD_COLIMA;
    const res = spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, ...extraEnv },
    });
    let ssh = [];
    try {
      ssh = readFileSync(log, 'utf8').trimEnd().split('\n');
    } catch {
      // kein ssh-Aufruf
    }
    return { status: res.status, stderr: res.stderr, ssh };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('status läuft per SSH im Checkout auf dem Host, mit Docker im PATH', () => {
  const res = run(['status']);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.ssh.includes('prod.test'));
  assert.ok(!res.ssh.includes('-t'), 'ohne Terminal kein -t');
  const cmd = res.ssh.at(-1);
  assert.match(cmd, /export PATH="\/usr\/local\/bin:/);
  assert.match(cmd, /cd ~\/poker && POKER_PROD_DIR="\$HOME\/poker" bash scripts\/status\.sh$/);
});

test('Standard-Host ist fleet@mac-2', () => {
  const res = run(['status'], { POKER_PROD_HOST: '' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.ssh.includes('fleet@mac-2'), res.ssh.join(' '));
});

test('jeder SSH-Aufruf nimmt den Docker der Prod-VM (Profil spiele, änderbar)', () => {
  const sock = (profil) => `DOCKER_HOST="unix://$HOME/.colima/${profil}/docker.sock"`;
  for (const args of [['status'], ['compose', 'ps'], ['backup']]) {
    const cmd = run(args).ssh.at(-1);
    assert.ok(cmd.includes(sock('spiele')), cmd);
  }
  const anders = run(['compose', 'ps'], { POKER_PROD_COLIMA: 'anders' }).ssh.at(-1);
  assert.ok(anders.includes(sock('anders')), anders);
  assert.match(anders, /DOCKER_HOST=.*; cd ~\/poker && docker compose -p poker-prod ps$/);
});

test('ungültiges Colima-Profil: Exit-Code 2, kein SSH-Aufruf', () => {
  const res = run(['status'], { POKER_PROD_COLIMA: 'a b;rm' });
  assert.equal(res.status, 2);
  assert.deepEqual(res.ssh, []);
});

test('up, tunnel-up, down, logs rufen scripts/prod.sh auf dem Host auf', () => {
  for (const action of ['up', 'tunnel-up', 'down', 'logs']) {
    const res = run([action]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.ssh.at(-1), new RegExp(`bash scripts/prod\\.sh ${action}$`));
  }
});

test('restore reicht Argumente gequotet weiter (Leerzeichen im Pfad)', () => {
  const dump = '/Volumes/Backup Disk/poker/last/poker-latest.sql.gz';
  const res = run(['restore', dump, '--yes']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.ssh.at(-1), /bash scripts\/restore\.sh \/Volumes\/Backup\\ Disk\/poker\/.+ --yes$/);
});

test('compose ruft docker compose -p poker-prod mit den Argumenten auf', () => {
  const res = run(['compose', 'exec', 'server', 'node', 'cli/feedback.mjs', '--status', 'new']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.ssh.at(-1), /docker compose -p poker-prod exec server node cli\/feedback\.mjs --status new$/);
});

test('unbekannte Aktion: Exit-Code 2, kein SSH-Aufruf', () => {
  const res = run(['bogus']);
  assert.equal(res.status, 2);
  assert.deepEqual(res.ssh, []);
});
