#!/usr/bin/env node
// Doku-Check und -Sync. Regeln: siehe docs/WORKFLOW.md, Abschnitt "Drift-Schutz".
//   node scripts/docs.mjs check   -> Exit 1 bei Fehlern
//   node scripts/docs.mjs sync    -> generiert die WP-Tabelle in docs/PROGRESS.md
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['todo', 'in-progress', 'review', 'done', 'blocked'];
export const MAX_IN_PROGRESS = 5;
export const WP_DIR = 'docs/work-packages';
export const PROGRESS_FILE = 'docs/PROGRESS.md';
export const DECISIONS_FILE = 'docs/DECISIONS.md';
const BEGIN = /<!-- BEGIN GENERATED[^>]*-->/;
const END = '<!-- END GENERATED -->';

export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    data[kv[1]] = value;
  }
  return { data, body: text.slice(m[0].length) };
}

export function parseWorkPackage(filename, text) {
  const errors = [];
  const fm = parseFrontmatter(text);
  if (!fm) return { file: filename, errors: [`${filename}: Frontmatter fehlt`] };
  const { id, title, status, milestone } = fm.data;
  const depends = Array.isArray(fm.data.depends) ? fm.data.depends : [];
  const expectedId = filename.replace(/\.md$/, '');
  if (id !== expectedId) errors.push(`${filename}: id "${id}" passt nicht zum Dateinamen`);
  if (!title) errors.push(`${filename}: title fehlt`);
  if (!/^M\d+$/.test(milestone ?? '')) errors.push(`${filename}: milestone fehlt oder ungültig (z. B. M1)`);
  if (!STATUSES.includes(status)) {
    errors.push(`${filename}: status "${status}" ungültig (erlaubt: ${STATUSES.join(', ')})`);
  }
  if (!Array.isArray(fm.data.depends)) errors.push(`${filename}: depends fehlt (leere Liste: [])`);
  const done = (fm.body.match(/^\s*- \[x\]/gim) || []).length;
  const open = (fm.body.match(/^\s*- \[ \]/gm) || []).length;
  return { file: filename, id, title, status, milestone, depends, done, open, errors };
}

export function validateWorkPackages(wps) {
  const errors = wps.flatMap((wp) => wp.errors);
  const byId = new Map(wps.map((wp) => [wp.id, wp]));
  for (const wp of wps) {
    for (const dep of wp.depends ?? []) {
      if (!byId.has(dep)) errors.push(`${wp.file}: Abhängigkeit ${dep} existiert nicht`);
      else if (wp.status === 'in-progress' && byId.get(dep).status !== 'done') {
        errors.push(`${wp.file}: in-progress, aber Abhängigkeit ${dep} ist nicht done`);
      }
    }
    if (wp.status === 'done' && wp.open > 0) {
      errors.push(`${wp.file}: status done, aber ${wp.open} offene Checkbox(en)`);
    }
  }
  const active = wps.filter((wp) => wp.status === 'in-progress');
  if (active.length > MAX_IN_PROGRESS) {
    errors.push(`Zu viele WPs in-progress (${active.map((w) => w.id).join(', ')}), max ${MAX_IN_PROGRESS}`);
  }
  return errors;
}

export function renderProgressTable(wps) {
  const rows = [...wps]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((wp) => {
      const deps = wp.depends.length ? wp.depends.join(', ') : '—';
      return `| ${wp.milestone} | [${wp.id}](work-packages/${wp.file}) | ${wp.title} | ${wp.status} | ${deps} |`;
    });
  return ['| MS | ID | Titel | Status | Abhängig von |', '|---|---|---|---|---|', ...rows].join('\n');
}

export function replaceGenerated(progressText, table) {
  const begin = progressText.match(BEGIN);
  const endIdx = progressText.indexOf(END);
  if (!begin || endIdx < begin.index) return null;
  const head = progressText.slice(0, begin.index + begin[0].length);
  return `${head}\n${table}\n${progressText.slice(endIdx)}`;
}

export function checkProgress(progressText, wps) {
  const expected = replaceGenerated(progressText, renderProgressTable(wps));
  if (expected === null) return [`${PROGRESS_FILE}: GENERATED-Marker fehlen`];
  if (expected !== progressText) return [`${PROGRESS_FILE}: WP-Tabelle veraltet → npm run docs:sync`];
  return [];
}

export function checkDecisions(text) {
  const ids = [...text.matchAll(/^## D-(\d{3}):/gm)].map((m) => Number(m[1]));
  const errors = [];
  ids.forEach((n, i) => {
    if (n !== i + 1)
      errors.push(
        `${DECISIONS_FILE}: D-${String(n).padStart(3, '0')} an Position ${i + 1} (erwartet fortlaufend ab D-001)`,
      );
  });
  return errors;
}

// files: { 'pfad/datei.md': inhalt }, exists: (absoluter Pfad relativ zu root) => bool
export function checkLinks(files, exists) {
  const errors = [];
  for (const [file, text] of Object.entries(files)) {
    const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const m of withoutCode.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const path = join(dirname(file), target);
      if (!exists(path)) errors.push(`${file}: kaputter Link → ${m[1]}`);
    }
  }
  return errors;
}

function listMarkdown(root, dir = '') {
  const out = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(root, rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

export function loadWorkPackages(root) {
  return readdirSync(join(root, WP_DIR))
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => parseWorkPackage(f, readFileSync(join(root, WP_DIR, f), 'utf8')));
}

export function runCheck(root) {
  const wps = loadWorkPackages(root);
  const files = Object.fromEntries(listMarkdown(root).map((f) => [f, readFileSync(join(root, f), 'utf8')]));
  return [
    ...validateWorkPackages(wps),
    ...checkProgress(files[PROGRESS_FILE] ?? '', wps),
    ...checkDecisions(files[DECISIONS_FILE] ?? ''),
    ...checkLinks(files, (p) => existsSync(join(root, p))),
  ];
}

export function runSync(root) {
  const wps = loadWorkPackages(root);
  const path = join(root, PROGRESS_FILE);
  const updated = replaceGenerated(readFileSync(path, 'utf8'), renderProgressTable(wps));
  if (updated === null) throw new Error(`${PROGRESS_FILE}: GENERATED-Marker fehlen`);
  writeFileSync(path, updated);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const cmd = process.argv[2];
  if (cmd === 'sync') {
    runSync(root);
    console.log(`${PROGRESS_FILE} aktualisiert`);
  } else if (cmd === 'check') {
    const errors = runCheck(root);
    if (errors.length) {
      console.error(`Doku-Check fehlgeschlagen (${errors.length}):\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
      process.exit(1);
    }
    console.log('Doku-Check ok');
  } else {
    console.error('Usage: node scripts/docs.mjs check|sync');
    process.exit(2);
  }
}
