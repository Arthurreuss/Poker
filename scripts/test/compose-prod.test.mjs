// Drift-Schutz für compose.prod.yml (WP-021): Nach einem Mac-Neustart startet Docker nur Container mit
// passender Restart-Policy neu, und das Backup muss Aufbewahrung und Host-Ordner behalten.
// WP-022 (D-025): Logs mit IP-Adressen höchstens 14 Tage – Größen-Rotation aller Container-Logs, Request-Logs von
// server und web in Dateien, die logrotate täglich rotiert und nach 12 Tagen löscht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compose = readFileSync(new URL('../../compose.prod.yml', import.meta.url), 'utf8');

/** Zerlegt den Abschnitt `services:` in { name: blockText } (Einrückung zwei Leerzeichen). */
function services(text) {
  const section = /^services:\n([\s\S]*?)(?=^\S)/m.exec(text)?.[1] ?? '';
  const result = {};
  let current;
  for (const line of section.split('\n')) {
    const name = /^ {2}([\w-]+):\s*$/.exec(line)?.[1];
    if (name) result[(current = name)] = '';
    else if (current) result[current] += `${line}\n`;
  }
  return result;
}

const all = services(compose);

test('compose.prod.yml enthält db, server, web, backup, logrotate und cloudflared', () => {
  assert.deepEqual(Object.keys(all).sort(), ['backup', 'cloudflared', 'db', 'logrotate', 'server', 'web']);
});

test('alle prod-Dienste starten nach einem Neustart von Docker wieder (restart: unless-stopped)', () => {
  for (const [name, block] of Object.entries(all)) {
    assert.match(block, /^ {4}restart: unless-stopped$/m, `${name} ohne restart: unless-stopped`);
  }
});

test('backup: Aufbewahrung 7/4/6, Host-Ordner aus BACKUP_DIR, Healthcheck', () => {
  const backup = all.backup ?? '';
  assert.match(backup, /BACKUP_KEEP_DAYS: 7\b/);
  assert.match(backup, /BACKUP_KEEP_WEEKS: 4\b/);
  assert.match(backup, /BACKUP_KEEP_MONTHS: 6\b/);
  assert.match(backup, /- \$\{BACKUP_DIR:\?[^}]*\}:\/backups$/m);
  assert.match(backup, /healthcheck:/);
});

test('Container-Logs aller Dienste rotieren nach Größe (Anker x-logging)', () => {
  const anchor = /^x-logging: &logging\n((?: {2}.*\n)+)/m.exec(compose)?.[1] ?? '';
  assert.match(anchor, /^ {2}driver: local$/m);
  assert.match(anchor, /^ {4}max-size: \d+m$/m);
  assert.match(anchor, /^ {4}max-file: '\d+'$/m);
  for (const [name, block] of Object.entries(all)) {
    assert.match(block, /^ {4}logging: \*logging$/m, `${name} ohne logging: *logging`);
  }
});

test('server und web schreiben ihre Request-Logs (mit IP) in Volumes, die logrotate einhängt', () => {
  assert.match(all.server ?? '', /^ {6}LOG_FILE: \/var\/log\/poker\/server\.log$/m);
  assert.match(all.server ?? '', /^ {6}- server-logs:\/var\/log\/poker$/m);
  assert.match(all.web ?? '', /^ {6}NGINX_ACCESS_LOG: \/var\/log\/poker\/access\.log$/m);
  assert.match(all.web ?? '', /^ {6}- web-logs:\/var\/log\/poker$/m);
  const rotate = all.logrotate ?? '';
  assert.match(rotate, /^ {6}- server-logs:\/logs\/server$/m);
  assert.match(rotate, /^ {6}- web-logs:\/logs\/web$/m);
  assert.match(rotate, /^ {6}- \.\/docker\/logrotate\/rotate\.sh:\/rotate\.sh:ro$/m);
  assert.match(rotate, /command: \['sh', '\/rotate\.sh', 'loop'\]/);
  assert.match(rotate, /network_mode: none/);
  assert.match(rotate, /healthcheck:/);
  assert.match(compose, /^volumes:\n(?: {2}.*\n)*? {2}server-logs:\n {2}web-logs:/m);
});

test('logrotate: Löschfrist + 1 Tag Rotation + Prüfabstand bleiben unter 14 Tagen (D-025)', () => {
  const rotate = all.logrotate ?? '';
  const days = Number(/LOG_DELETE_AFTER_DAYS: (\d+)/.exec(rotate)?.[1]);
  const intervalSeconds = Number(/LOG_CHECK_INTERVAL_SECONDS: (\d+)/.exec(rotate)?.[1]);
  assert.ok(days > 0 && intervalSeconds > 0, 'LOG_DELETE_AFTER_DAYS und LOG_CHECK_INTERVAL_SECONDS setzen');
  // Älteste Zeile: rotierte Datei umfasst bis zu 1 Tag + Prüfabstand, gelöscht nach days + Prüfabstand.
  const worstHours = 24 + days * 24 + (2 * intervalSeconds) / 3600;
  assert.ok(worstHours < 14 * 24, `bis zu ${String(worstHours)} h aufbewahrt`);
});

test('cloudflared loggt nur auf Level info (debug schreibt Request-Header mit Client-IP)', () => {
  const tunnel = all.cloudflared ?? '';
  assert.match(tunnel, /'--loglevel', 'info'/);
  assert.doesNotMatch(tunnel.replace(/#.*$/gm, ''), /debug|TUNNEL_LOGLEVEL/);
});
