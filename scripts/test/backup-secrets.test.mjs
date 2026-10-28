// Secrets-Backup (WP-043, D-037): docker/backup/secrets-hook.sh gegen einen temporären Ordner.
// Das Skript läuft in prod im Backup-Image (Debian, dash, GNU tar, gpg), hier mit sh, tar und find des Rechners;
// gpg ist durch ein Stub-Skript ersetzt, das Argumente, Passphrase (fd 3) und GNUPGHOME protokolliert und die
// Eingabe unverschlüsselt nach --output kopiert. Echtes gpg prüft scripts/test-restore.sh (npm run prod:test-restore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../docker/backup/secrets-hook.sh', import.meta.url));
const ENV_CONTENT = 'POSTGRES_PASSWORD=geheim\nTUNNEL_TOKEN=token\n';
const PASSPHRASE = 'pass phrase $mit `zeichen`';
const DAY_S = 86_400;

function setup(t, { gpgExit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'poker-secrets-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const sub of ['bin', 'src', 'backups']) mkdirSync(join(dir, sub));
  writeFileSync(join(dir, 'src', 'env'), ENV_CONTENT);
  const log = join(dir, 'gpg.log');
  const stub = join(dir, 'bin', 'gpg');
  writeFileSync(
    stub,
    `#!/bin/sh
{ for a in "$@"; do printf 'arg %s\\n' "$a"; done; printf 'gnupghome %s\\n' "$GNUPGHOME"; } > "${log}"
IFS= read -r pass <&3; printf 'pass %s\\n' "$pass" >> "${log}"
out=""; while [ $# -gt 1 ]; do [ "$1" = --output ] && out="$2"; shift; done
[ ${String(gpgExit)} -eq 0 ] || exit ${String(gpgExit)}
cp "$1" "$out"
`,
  );
  chmodSync(stub, 0o755);
  return { dir, log, secrets: join(dir, 'backups', 'secrets') };
}

function hook({ dir }, action, env = {}) {
  return spawnSync('sh', [SCRIPT, action], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
      BACKUP_DIR: join(dir, 'backups'),
      SECRETS_SRC_DIR: join(dir, 'src'),
      PROD_ENV_NAME: 'env',
      SECRETS_BACKUP_PASSPHRASE: PASSPHRASE,
      SECRETS_KEEP_DAYS: '30',
      ...env,
    },
  });
}

const gpgLog = (log) => readFileSync(log, 'utf8').trimEnd().split('\n');

test('post-backup: verschlüsselte Kopie secrets/env-prod-JJJJMMTT.tar.gz.gpg mit genau .env.prod', (t) => {
  const ctx = setup(t);
  const res = hook(ctx, 'post-backup');
  assert.equal(res.status, 0, res.stderr);

  const files = readdirSync(ctx.secrets);
  assert.equal(files.length, 1, `nur die fertige Datei, keine .tmp: ${files.join(', ')}`);
  const [file = ''] = files;
  assert.match(file, /^env-prod-\d{8}\.tar\.gz\.gpg$/);
  assert.match(res.stdout, new RegExp(`secrets/${file.replaceAll('.', '\\.')}`));

  // Der Stub kopiert die Eingabe unverändert: ein tar.gz, dessen einziger Eintrag .env.prod heißt.
  const archive = join(ctx.secrets, file);
  assert.deepEqual(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'), ['.env.prod']);
  assert.equal(execFileSync('tar', ['-xzOf', archive, '.env.prod'], { encoding: 'utf8' }), ENV_CONTENT);
});

test('gpg: symmetrisch AES256, Passphrase nur über fd 3, eigenes GNUPGHOME, das danach weg ist', (t) => {
  const ctx = setup(t);
  assert.equal(hook(ctx, 'post-backup').status, 0);
  const lines = gpgLog(ctx.log);
  const args = lines.filter((l) => l.startsWith('arg ')).map((l) => l.slice(4));
  for (const flag of ['--batch', '--symmetric', '--pinentry-mode', 'loopback', '--passphrase-fd', '3']) {
    assert.ok(args.includes(flag), `gpg ohne ${flag}`);
  }
  assert.equal(args[args.indexOf('--cipher-algo') + 1], 'AES256');
  assert.ok(!args.some((a) => a.includes('pass phrase')), 'Passphrase steht in der Argumentliste');
  assert.ok(lines.includes(`pass ${PASSPHRASE}`), 'Passphrase kommt nicht über fd 3 an');
  const home = lines.find((l) => l.startsWith('gnupghome '))?.slice(10) ?? '';
  assert.ok(home.length > 0, 'GNUPGHOME nicht gesetzt');
  assert.ok(!existsSync(home), 'temporäres GNUPGHOME nicht entfernt');
});

test('ohne Passphrase: laute Warnung, Exit 0 (DB-Backup bleibt gültig), keine Datei', (t) => {
  const ctx = setup(t);
  const res = hook(ctx, 'post-backup', { SECRETS_BACKUP_PASSPHRASE: '' });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /WARNUNG: SECRETS_BACKUP_PASSPHRASE fehlt/);
  assert.match(res.stderr, /DB-Backup ist trotzdem erstellt/);
  assert.equal(existsSync(ctx.secrets), false);
  assert.equal(existsSync(ctx.log), false, 'gpg darf nicht laufen');
});

test('andere Aktionen (pre-backup, error) tun nichts', (t) => {
  const ctx = setup(t);
  for (const action of ['pre-backup', 'error']) {
    const res = hook(ctx, action);
    assert.equal(res.status, 0);
    assert.equal(res.stdout + res.stderr, '');
  }
  assert.equal(existsSync(ctx.secrets), false);
});

test('Fehler: gpg schlägt fehl oder Env-Datei fehlt → Exit ≠ 0, keine Datei, kein .tmp', (t) => {
  const failing = setup(t, { gpgExit: 2 });
  const res = hook(failing, 'post-backup');
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Verschlüsseln von \.env\.prod fehlgeschlagen/);
  assert.deepEqual(readdirSync(failing.secrets), []);

  const missing = setup(t);
  const res2 = hook(missing, 'post-backup', { PROD_ENV_NAME: 'gibt-es-nicht' });
  assert.notEqual(res2.status, 0);
  assert.match(res2.stderr, /fehlt oder ist leer/);
});

test('Aufbewahrung: Kopien älter als SECRETS_KEEP_DAYS werden gelöscht, andere Dateien bleiben', (t) => {
  const ctx = setup(t);
  mkdirSync(ctx.secrets);
  const aged = (name, days) => {
    const file = join(ctx.secrets, name);
    writeFileSync(file, 'x');
    const time = Date.now() / 1000 - days * DAY_S;
    utimesSync(file, time, time);
  };
  aged('env-prod-20260901.tar.gz.gpg', 40);
  aged('env-prod-20261001.tar.gz.gpg', 29);
  aged('notiz.txt', 40);
  assert.equal(hook(ctx, 'post-backup').status, 0);
  const files = readdirSync(ctx.secrets).sort();
  assert.ok(!files.includes('env-prod-20260901.tar.gz.gpg'), '40 Tage alte Kopie nicht gelöscht');
  assert.ok(files.includes('env-prod-20261001.tar.gz.gpg'), '29 Tage alte Kopie gelöscht');
  assert.ok(files.includes('notiz.txt'), 'fremde Datei gelöscht');
  assert.equal(files.filter((f) => /^env-prod-\d{8}\.tar\.gz\.gpg$/.test(f)).length, 2);
});
