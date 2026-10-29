// Deploy und Rollback über den Deploy-Job des Server-Verbunds (WP-045, D-039). deploy_job.sh läuft in einem
// Wegwerf-Repo mit Stub statt prod.sh (kein Docker, prod bleibt unberührt); fleet-deploy.sh mit Stub statt fleet.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const deployJob = fileURLToPath(new URL('../deploy_job.sh', import.meta.url));
const fleetDeploy = fileURLToPath(new URL('../fleet-deploy.sh', import.meta.url));

// Ohne geerbte GIT_*-Variablen: Im Pre-Commit-Hook zeigen GIT_DIR/GIT_INDEX_FILE auf das echte Repo, das die
// Wegwerf-Repos sonst überschreiben würden. Eigene Konfiguration (Hooks, Signieren) gilt hier nicht.
const gitEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd, ...args) {
  const res = spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

/** Wegwerf-Checkout mit zwei Commits (eins, zwei), .env.prod (ignoriert) und einem prod.sh-Stub. */
function checkout({ env = 'POSTGRES_PASSWORD=x\n', prodExit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-job-'));
  const repo = join(dir, 'poker');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  copyFileSync(deployJob, join(repo, 'scripts', 'deploy_job.sh'));
  writeFileSync(join(repo, '.gitignore'), '.env.prod\n');
  git(dir, 'init', '-q', '-b', 'main', repo);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'eins');
  const first = git(repo, 'rev-parse', '--short', 'HEAD');
  writeFileSync(join(repo, 'neu'), 'zwei\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'zwei');
  const second = git(repo, 'rev-parse', '--short', 'HEAD');
  if (env !== null) writeFileSync(join(repo, '.env.prod'), env);
  const log = join(dir, 'prod.log');
  const stub = join(dir, 'prod.sh');
  writeFileSync(
    stub,
    `#!/bin/sh\necho "$1 $(git rev-parse --short HEAD) $POKER_PROD_DIR $PROD_PROJECT" >> "${log}"\nexit ${prodExit}\n`,
  );
  chmodSync(stub, 0o755);
  const run = (args, extraEnv = {}) => {
    const res = spawnSync('bash', [join(repo, 'scripts', 'deploy_job.sh'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...gitEnv, POKER_DEPLOY_PROD_SH: stub, ...extraEnv },
    });
    let calls = [];
    try {
      calls = readFileSync(log, 'utf8').trimEnd().split('\n');
    } catch {
      // prod.sh nicht aufgerufen
    }
    return { status: res.status, out: res.stdout + res.stderr, calls };
  };
  return { dir, repo, first, second, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('deploy ohne Stand baut aus dem Checkout (main), POKER_PROD_DIR = Checkout', () => {
  const c = checkout();
  try {
    const res = c.run(['deploy']);
    assert.equal(res.status, 0, res.out);
    assert.deepEqual(res.calls, [`up ${c.second} ${c.repo} poker-prod`]);
    assert.equal(git(c.repo, 'symbolic-ref', '--short', 'HEAD'), 'main');
  } finally {
    c.cleanup();
  }
});

test('deploy mit dem Stand von HEAD lässt den Checkout auf main', () => {
  const c = checkout();
  try {
    const res = c.run(['deploy', c.second]);
    assert.equal(res.status, 0, res.out);
    assert.equal(git(c.repo, 'symbolic-ref', '--short', 'HEAD'), 'main');
  } finally {
    c.cleanup();
  }
});

test('rollback setzt den Checkout detached auf den Stand und baut daraus', () => {
  const c = checkout();
  try {
    const res = c.run(['rollback', c.first]);
    assert.equal(res.status, 0, res.out);
    assert.deepEqual(res.calls, [`up ${c.first} ${c.repo} poker-prod`]);
    assert.equal(git(c.repo, 'rev-parse', '--short', 'HEAD'), c.first);
  } finally {
    c.cleanup();
  }
});

test('Compose-Projekt aus deploy.toml des Verbunds (Test-Instanz)', () => {
  const c = checkout();
  try {
    const res = c.run(['deploy'], { FLEET_DEPLOY_COMPOSE: 'deploytest-poker' });
    assert.equal(res.status, 0, res.out);
    assert.match(res.calls[0], / deploytest-poker$/);
  } finally {
    c.cleanup();
  }
});

test('mit TUNNEL_TOKEN startet prod mit Tunnel', () => {
  const c = checkout({ env: 'POSTGRES_PASSWORD=x\nTUNNEL_TOKEN=abc\n' });
  try {
    const res = c.run(['deploy']);
    assert.equal(res.status, 0, res.out);
    assert.match(res.calls[0], /^tunnel-up /);
  } finally {
    c.cleanup();
  }
});

test('Aufruf ungültig: Exit 2, prod.sh läuft nicht', () => {
  const c = checkout();
  try {
    for (const args of [[], ['restore'], ['rollback'], ['deploy', 'gibtsnicht'], ['deploy', c.first, 'x']]) {
      const res = c.run(args);
      assert.equal(res.status, 2, `${args.join(' ')}: ${res.out}`);
      assert.deepEqual(res.calls, []);
    }
    assert.equal(git(c.repo, 'symbolic-ref', '--short', 'HEAD'), 'main');
  } finally {
    c.cleanup();
  }
});

test('ohne .env.prod: Exit 75, nichts verändert', () => {
  const c = checkout({ env: null });
  try {
    const res = c.run(['rollback', c.first]);
    assert.equal(res.status, 75, res.out);
    assert.deepEqual(res.calls, []);
    assert.equal(git(c.repo, 'rev-parse', '--short', 'HEAD'), c.second);
  } finally {
    c.cleanup();
  }
});

test('prod.sh scheitert: Exit 1', () => {
  const c = checkout({ prodExit: 1 });
  try {
    const res = c.run(['deploy']);
    assert.equal(res.status, 1, res.out);
    assert.match(res.out, /prod\.sh up fehlgeschlagen/);
  } finally {
    c.cleanup();
  }
});

/** fleet-deploy.sh mit Stub statt fleet.py; liefert Exit und die Argumente an fleet.py. */
function fleet(args, exit = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-deploy-'));
  try {
    const log = join(dir, 'fleet.log');
    const stub = join(dir, 'fleet');
    writeFileSync(stub, `#!/bin/sh\necho "$*" > "${log}"\nexit ${exit}\n`);
    chmodSync(stub, 0o755);
    const res = spawnSync('bash', [fleetDeploy, ...args], {
      encoding: 'utf8',
      env: { ...process.env, POKER_FLEET_CMD: stub },
    });
    let call = null;
    try {
      call = readFileSync(log, 'utf8').trim();
    } catch {
      // nicht aufgerufen
    }
    return { status: res.status, stderr: res.stderr, call };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('fleet-deploy.sh startet den Job deploy-poker über fleet.py', () => {
  assert.deepEqual(fleet(['deploy']), { status: 0, stderr: '', call: 'deploy poker' });
  assert.equal(fleet(['deploy', 'abc1234']).call, 'deploy poker abc1234');
  assert.equal(fleet(['rollback', 'abc1234']).call, 'deploy poker abc1234 --rollback');
});

test('fleet-deploy.sh gibt den Exit des Laufs weiter, rollback braucht einen Stand', () => {
  assert.equal(fleet(['deploy', 'abc1234'], 75).status, 75);
  assert.equal(fleet(['deploy', 'abc1234'], 1).status, 1);
  const res = fleet(['rollback']);
  assert.equal(res.status, 2);
  assert.equal(res.call, null);
});
