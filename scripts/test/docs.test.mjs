import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseFrontmatter,
  parseWorkPackage,
  validateWorkPackages,
  renderProgressTable,
  replaceGenerated,
  checkProgress,
  checkDecisions,
  checkLinks,
  runCheck,
} from '../docs.mjs';

const wpText = ({ id = 'WP-001', status = 'todo', depends = '[]', body = '- [ ] a' } = {}) =>
  `---\nid: ${id}\ntitle: Test\nmilestone: M1\nstatus: ${status}\ndepends: ${depends}\n---\n\n${body}\n`;
const wp = (opts = {}) => parseWorkPackage(`${opts.id ?? 'WP-001'}.md`, wpText(opts));

test('parseFrontmatter liest Werte und Listen', () => {
  const { data } = parseFrontmatter('---\na: b\nlist: [X, Y]\nempty: []\n---\nbody');
  assert.deepEqual(data, { a: 'b', list: ['X', 'Y'], empty: [] });
  assert.equal(parseFrontmatter('kein frontmatter'), null);
});

test('parseWorkPackage zählt Checkboxen und meldet Fehler', () => {
  const ok = wp({ body: '- [x] a\n- [X] b\n- [ ] c' });
  assert.deepEqual([ok.done, ok.open, ok.errors], [2, 1, []]);
  assert.match(parseWorkPackage('WP-002.md', wpText()).errors[0], /passt nicht zum Dateinamen/);
  assert.match(wp({ status: 'fertig' }).errors[0], /ungültig/);
  assert.match(parseWorkPackage('WP-001.md', 'x').errors[0], /Frontmatter fehlt/);
});

test('done mit offenen Checkboxen ist ein Fehler', () => {
  assert.match(validateWorkPackages([wp({ status: 'done' })])[0], /offene Checkbox/);
  assert.deepEqual(validateWorkPackages([wp({ status: 'done', body: '- [x] a' })]), []);
});

test('Abhängigkeiten müssen existieren und für in-progress done sein', () => {
  assert.match(validateWorkPackages([wp({ depends: '[WP-009]' })])[0], /existiert nicht/);
  const errors = validateWorkPackages([wp({ id: 'WP-001' }), wp({ id: 'WP-002', status: 'in-progress', depends: '[WP-001]' })]);
  assert.match(errors[0], /nicht done/);
});

test('maximal drei WPs in-progress', () => {
  const active = (n) => Array.from({ length: n }, (_, i) => wp({ id: `WP-00${i + 1}`, status: 'in-progress' }));
  assert.deepEqual(validateWorkPackages(active(3)), []);
  assert.match(validateWorkPackages(active(4))[0], /Zu viele/);
});

test('milestone ist Pflicht', () => {
  const text = wpText().replace('milestone: M1\n', '');
  assert.match(parseWorkPackage('WP-001.md', text).errors[0], /milestone/);
});

test('PROGRESS-Tabelle: Sync erzeugt Stand, den der Check akzeptiert', () => {
  const wps = [wp({ id: 'WP-002' }), wp({ id: 'WP-001', body: '- [x] a' })];
  const progress = '# P\n<!-- BEGIN GENERATED: x -->\nalt\n<!-- END GENERATED -->\nrest\n';
  assert.match(checkProgress(progress, wps)[0], /veraltet/);
  const synced = replaceGenerated(progress, renderProgressTable(wps));
  assert.deepEqual(checkProgress(synced, wps), []);
  assert.ok(synced.indexOf('WP-001') < synced.indexOf('WP-002'), 'sortiert nach ID');
  assert.ok(synced.endsWith('<!-- END GENERATED -->\nrest\n'), 'Rest bleibt erhalten');
  assert.match(checkProgress('ohne marker', wps)[0], /Marker fehlen/);
});

test('Entscheidungs-IDs fortlaufend', () => {
  assert.deepEqual(checkDecisions('## D-001: a\n## D-002: b'), []);
  assert.equal(checkDecisions('## D-001: a\n## D-003: b').length, 1);
  assert.equal(checkDecisions('## D-001: a\n## D-001: b').length, 1);
});

test('Links: relative Ziele müssen existieren, Code und URLs ignoriert', () => {
  const exists = (p) => p === 'docs/da.md';
  const files = {
    'docs/a.md': '[ok](da.md#x) [web](https://x.de) [anker](#y) `[code](weg.md)`\n```\n[block](weg.md)\n```\n[kaputt](fehlt.md)',
  };
  assert.deepEqual(checkLinks(files, exists), ['docs/a.md: kaputter Link → fehlt.md']);
});

test('das echte Repo besteht den Check', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  assert.deepEqual(runCheck(root), []);
});
