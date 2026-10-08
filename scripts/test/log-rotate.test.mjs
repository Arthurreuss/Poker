// Log-Rotation für prod (WP-022, D-025): docker/logrotate/rotate.sh gegen einen temporären Ordner.
// Das Skript läuft in prod unter busybox (alpine), hier mit der Shell und find des Rechners (macOS/Linux).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../docker/logrotate/rotate.sh', import.meta.url));
const DAY_S = 86_400;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'poker-logrotate-'));
  mkdirSync(join(dir, 'server'));
  mkdirSync(join(dir, 'web'));
  return dir;
}

function rotate(dir, today) {
  return execFileSync('sh', [SCRIPT, 'once'], {
    env: { ...process.env, LOG_DIR: dir, LOG_ROTATE_TODAY: today, LOG_DELETE_AFTER_DAYS: '12' },
    encoding: 'utf8',
  });
}

const list = (dir, sub) => readdirSync(join(dir, sub)).sort();

/** Setzt die Änderungszeit einer Datei auf „vor `days` Tagen“. */
function age(file, days) {
  const t = Date.now() / 1000 - days * DAY_S;
  utimesSync(file, t, t);
}

test('rotiert nicht leere *.log einmal pro Tag (copytruncate), leere bleiben unangetastet', (t) => {
  const dir = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'server', 'server.log'), '{"msg":"a","remoteAddress":"203.0.113.7"}\n');
  writeFileSync(join(dir, 'web', 'access.log'), '');

  rotate(dir, '2026-10-08');
  const [live, rotated] = list(dir, 'server');
  assert.equal(live, 'server.log');
  assert.match(rotated ?? '', /^server\.log\.\d{8}T\d{6}Z$/);
  assert.equal(readFileSync(join(dir, 'server', 'server.log'), 'utf8'), '');
  assert.match(readFileSync(join(dir, 'server', rotated ?? ''), 'utf8'), /203\.0\.113\.7/);
  assert.deepEqual(list(dir, 'web'), ['access.log']);

  // Am selben Tag passiert nichts mehr, auch wenn neue Zeilen dazukommen.
  writeFileSync(join(dir, 'server', 'server.log'), 'neu\n');
  rotate(dir, '2026-10-08');
  assert.equal(list(dir, 'server').length, 2);
  assert.equal(readFileSync(join(dir, 'server', 'server.log'), 'utf8'), 'neu\n');
});

test('am nächsten Tag wird wieder rotiert', (t) => {
  const dir = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'web', 'access.log'), 'tag 1\n');
  rotate(dir, '2026-10-08');
  // Zeitstempel im Dateinamen hat Sekunden-Auflösung: die erste rotierte Datei umbenennen, damit nichts kollidiert.
  const [, first] = list(dir, 'web');
  const renamed = join(dir, 'web', 'access.log.20261008T000000Z');
  execFileSync('mv', [join(dir, 'web', first ?? ''), renamed]);
  writeFileSync(join(dir, 'web', 'access.log'), 'tag 2\n');
  rotate(dir, '2026-10-09');
  assert.equal(list(dir, 'web').length, 3);
  assert.equal(readFileSync(join(dir, 'web', 'access.log'), 'utf8'), '');
});

test('löscht rotierte Dateien, die älter als LOG_DELETE_AFTER_DAYS sind – sonst nichts', (t) => {
  const dir = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name) => join(dir, 'server', name);
  writeFileSync(file('server.log.20260901T000000Z'), 'alt\n');
  writeFileSync(file('server.log.20260926T000000Z'), 'knapp\n');
  writeFileSync(file('server.log'), '');
  writeFileSync(file('notizen.txt'), 'kein Log\n');
  age(file('server.log.20260901T000000Z'), 12.1);
  age(file('server.log.20260926T000000Z'), 11.9);
  age(file('server.log'), 30);
  age(file('notizen.txt'), 30);

  const out = rotate(dir, '2026-10-08');
  assert.match(out, /gelöscht: .*server\.log\.20260901T000000Z/);
  assert.deepEqual(list(dir, 'server'), ['notizen.txt', 'server.log', 'server.log.20260926T000000Z']);
});

test('falscher Aufruf → Exit-Code 2', () => {
  assert.throws(() => execFileSync('sh', [SCRIPT], { stdio: 'pipe' }), /Aufruf/);
});
