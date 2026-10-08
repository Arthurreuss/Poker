// Security-Header des Prod-Web-Containers (WP-022): parst docker/nginx/default.conf.template und
// security-headers.conf und prüft, dass jede location die Header bekommt und die CSP zur App passt.
// Manueller Lauf gegen ein gebautes Image: docs/OPERATIONS.md, „Security-Checkliste“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const template = read('docker/nginx/default.conf.template');
const snippet = read('docker/nginx/security-headers.conf');
const dockerfile = read('docker/web.Dockerfile');
const SNIPPET_PATH = '/etc/nginx/snippets/security-headers.conf';

/** Entfernt Kommentare (ohne # in Strings – kommt in den Dateien nicht vor). */
const stripComments = (text) => text.replace(/#.*$/gm, '');

/** { name: wert } aller `add_header name "wert" always;` (Wert ohne Anführungszeichen). */
function headers(text) {
  const result = {};
  for (const m of stripComments(text).matchAll(/^\s*add_header\s+([\w-]+)\s+"([^"]*)"\s*(always)?\s*;/gm)) {
    assert.equal(m[3], 'always', `${m[1]} ohne always (fehlt sonst bei Fehlerantworten)`);
    result[m[1].toLowerCase()] = m[2];
  }
  return result;
}

/** Blöcke `location … { … }` mit ihrem Inhalt (keine verschachtelten Blöcke in der Config). */
function locations(text) {
  return [...stripComments(text).matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)].map((m) => ({
    name: m[1],
    body: m[2],
  }));
}

/** CSP als { direktive: [quellen] }. */
function csp(value) {
  return Object.fromEntries(
    value
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0] !== '')
      .map(([name, ...sources]) => [name, sources]),
  );
}

const h = headers(snippet);
const policy = csp(h['content-security-policy'] ?? '');

test('jede location bindet die Security-Header ein (add_header wird sonst nicht vererbt)', () => {
  const locs = locations(template);
  assert.ok(locs.length >= 5, 'erwartet mindestens 5 location-Blöcke');
  for (const { name, body } of locs) {
    assert.match(body, new RegExp(`include\\s+${SNIPPET_PATH.replaceAll('/', '\\/')}\\s*;`), `location ${name}`);
  }
});

test('das Web-Image kopiert das Header-Snippet an den eingebundenen Pfad', () => {
  assert.match(dockerfile, new RegExp(`COPY docker/nginx/security-headers.conf ${SNIPPET_PATH}`));
});

test('Grundschutz-Header sind gesetzt', () => {
  assert.equal(h['x-frame-options'], 'DENY');
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['referrer-policy'], 'same-origin');
  assert.equal(h['cross-origin-opener-policy'], 'same-origin');
  const permissions = h['permissions-policy'] ?? '';
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) {
    assert.match(permissions, new RegExp(`\\b${feature}=\\(\\)`), feature);
  }
  // Teilen/Kopieren des Einladungslinks (WP-015) darf nicht gesperrt sein.
  assert.doesNotMatch(permissions, /web-share|clipboard/);
  // HSTS setzt Cloudflare, nicht nginx (hinter dem Tunnel kommt nur http an).
  assert.equal(h['strict-transport-security'], undefined);
});

test('CSP: nur eigene Origin, keine Inline-Skripte, kein eval, kein Framing', () => {
  assert.deepEqual(policy['default-src'], ["'self'"]);
  assert.deepEqual(policy['script-src'], ["'self'"]);
  assert.deepEqual(policy['style-src'], ["'self'"]);
  assert.deepEqual(policy['object-src'], ["'none'"]);
  assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
  assert.deepEqual(policy['base-uri'], ["'self'"]);
  assert.deepEqual(policy['form-action'], ["'self'"]);
  assert.deepEqual(policy['worker-src'], ["'self'"]);
  for (const sources of Object.values(policy)) {
    for (const source of sources) {
      assert.ok(!["'unsafe-inline'", "'unsafe-eval'", '*', 'http:', 'https:'].includes(source), source);
    }
  }
});

test('CSP: WebSocket nur zur eigenen Origin (D-014)', () => {
  assert.deepEqual(policy['connect-src'], ["'self'", 'wss://$host']);
});

test('Web-App erzeugt keine Inline-Skripte (CSP script-src ohne unsafe-inline)', () => {
  const html = read('apps/web/index.html');
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
    assert.match(m[1], /\bsrc=/, `Inline-Skript in apps/web/index.html: ${m[0]}`);
  }
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'Inline-Event-Handler in index.html');
  // vite-plugin-pwa: 'inline' würde ein Inline-Skript zur Registrierung des Service Workers einfügen.
  const viteConfig = read('apps/web/vite.config.ts');
  assert.match(viteConfig, /injectRegister:\s*'(script|script-defer)'/);
});
