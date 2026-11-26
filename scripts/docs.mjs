#!/usr/bin/env node
// Doku-Check (Teil von `npm run check`): Entscheidungs-IDs D-001… in docs/DECISIONS.md fortlaufend,
// relative Links in allen Markdown-Dateien zeigen auf existierende Dateien.
//   node scripts/docs.mjs check   -> Exit 1 bei Fehlern
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DECISIONS_FILE = 'docs/DECISIONS.md';

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
    if (['node_modules', '.git', 'worktrees'].includes(entry.name)) continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(root, rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

export function runCheck(root) {
  const files = Object.fromEntries(listMarkdown(root).map((f) => [f, readFileSync(join(root, f), 'utf8')]));
  return [...checkDecisions(files[DECISIONS_FILE] ?? ''), ...checkLinks(files, (p) => existsSync(join(root, p)))];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv[2] !== 'check') {
    console.error('Usage: node scripts/docs.mjs check');
    process.exit(2);
  }
  const errors = runCheck(root);
  if (errors.length) {
    console.error(`Doku-Check fehlgeschlagen (${errors.length}):\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('Doku-Check ok');
}
