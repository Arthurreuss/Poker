// Link-Vorschau in Messengern (WP-030): Open-Graph-/Twitter-Tags in apps/web/index.html (landen unverändert im
// Build, Vite ergänzt nur Skript-/Style-Tags), Platzhalter-Ersetzung per nginx sub_filter für beide Domains (D-023),
// Vorschaubild 1200×630 und unveränderte CSP. Manueller Lauf gegen ein Image: docs/OPERATIONS.md, „Link-Vorschau“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const html = read('apps/web/index.html');
const template = read('docker/nginx/default.conf.template').replace(/#.*$/gm, '');
const snippet = read('docker/nginx/security-headers.conf');
const viteConfig = read('apps/web/vite.config.ts');
const PLACEHOLDER = '__POKER_ORIGIN__';

/** { "og:title": "…", "twitter:card": "…" } aller <meta property|name=… content=…>. */
function metas(source) {
  const result = {};
  for (const m of source.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)) {
    result[m[1]] = m[2];
  }
  return result;
}

/** Nachbau von `sub_filter "__POKER_ORIGIN__" "$og_scheme://$og_host"; sub_filter_once off;`. */
const servedFor = (origin) => html.replaceAll(PLACEHOLDER, origin);

const tags = Object.fromEntries(Object.entries(metas(html)).filter(([name]) => /^(og|twitter):/.test(name)));

test('index.html enthält Open-Graph- und Twitter-Tags', () => {
  for (const name of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image']) {
    assert.ok(tags[name], `${name} fehlt`);
  }
  assert.equal(tags['og:image:width'], '1200');
  assert.equal(tags['og:image:height'], '630');
  assert.equal(tags['og:image:type'], 'image/png');
  assert.equal(tags['twitter:card'], 'summary_large_image');
  assert.equal(tags['twitter:title'], tags['og:title']);
  assert.equal(tags['twitter:image'], tags['og:image']);
});

test('Vorschau ist allgemein und verrät keine Tischdaten', () => {
  assert.match(tags['og:title'], /Poker/);
  assert.equal(tags['og:url'], `${PLACEHOLDER}/`);
  for (const [name, value] of Object.entries(tags)) {
    assert.doesNotMatch(value, /join|table|invite|\$|%/i, `${name} enthält Tisch-/Variablen-Anteile: ${value}`);
  }
});

test('Bild und URL werden für jede Domain absolut (D-023)', () => {
  for (const origin of ['https://poker.arthur-reuss.de', 'https://poker.deinemudda.win']) {
    const served = metas(servedFor(origin));
    assert.equal(served['og:image'], `${origin}/og-image.png`);
    assert.equal(served['twitter:image'], `${origin}/og-image.png`);
    assert.equal(served['og:url'], `${origin}/`);
    assert.ok(!servedFor(origin).includes(PLACEHOLDER));
  }
});

test('nginx ersetzt den Platzhalter in index.html durch die aufgerufene Origin', () => {
  const root = /location\s+\/\s*\{([^}]*)\}/.exec(template)?.[1] ?? '';
  assert.match(root, /sub_filter\s+"__POKER_ORIGIN__"\s+"\$og_scheme:\/\/\$og_host"\s*;/);
  assert.match(root, /sub_filter_once\s+off\s*;/);
  // Host/Schema kommen vom Client: nur geprüfte Werte landen im HTML.
  assert.match(template, /map\s+\$forwarded_proto\s+\$og_scheme\s*\{\s*https\s+https;\s*default\s+http;\s*\}/);
  const hostMap = /map\s+\$http_host\s+\$og_host\s*\{([^}]*)\}/.exec(template)?.[1] ?? '';
  assert.match(hostMap, /"~\*\^\[a-z0-9\.-\]\+\(:\[0-9\]\+\)\?\$"\s+\$http_host;/);
  assert.match(hostMap, /default\s+localhost;/);
});

test('Vite ersetzt den Platzhalter nur im Dev-Server, nicht im Build', () => {
  assert.match(viteConfig, /name:\s*'poker-og-origin-dev',\s*apply:\s*'serve'/);
});

test('Vorschaubild: PNG 1200×630, nicht im Offline-Cache', () => {
  const png = readFileSync(new URL('../../apps/web/public/og-image.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 300 * 1024, 'WhatsApp lädt große Bilder nicht zuverlässig');
  assert.match(viteConfig, /globIgnores:\s*\['\*\*\/og-image\.png'\]/);
});

test('CSP bleibt unverändert streng (WP-022)', () => {
  const csp = /add_header\s+Content-Security-Policy\s+"([^"]*)"/.exec(snippet)?.[1];
  assert.equal(
    csp,
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
      "connect-src 'self' wss://$host; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; " +
      "form-action 'self'; frame-ancestors 'none'",
  );
});
