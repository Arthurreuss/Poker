// Drift-Schutz für compose.prod.yml (WP-021): Nach einem Mac-Neustart startet Docker nur Container mit
// passender Restart-Policy neu, und das Backup muss Aufbewahrung und Host-Ordner behalten.
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

test('compose.prod.yml enthält db, server, web, backup und cloudflared', () => {
  assert.deepEqual(Object.keys(all).sort(), ['backup', 'cloudflared', 'db', 'server', 'web']);
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
