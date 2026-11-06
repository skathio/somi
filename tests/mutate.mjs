#!/usr/bin/env node
// Diff-scoped mutation check, for security-relevant code only. It flips one operator on each changed line of a guarded file, runs the
// tests somi.check.json maps to that file, and names the mutants the tests did not catch. It works on a private copy of the repository
// and never touches the real tree. Run it before a push when one of these files changed. It is not part of `npm test`.
//
//   node tests/mutate.mjs [--base REF] [--max N]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readDiff, snapshotTree } from '../scripts/lib/git-tree.mjs';

export const GUARDED = /^(scripts\/lib\/(path-safety|path-facts|reviews|policy|signals)\.mjs|hooks\/(pre-tool\/[^/]+|lib\/common)\.mjs)$/;
const MUTATIONS = [[/===/, '!=='], [/!==/, '==='], [/&&/, '||'], [/\|\|/, '&&'], [/\btrue\b/, 'false'], [/\bfalse\b/, 'true'], [/>=/, '<'], [/<=/, '>'], [/\breturn null\b/, 'return undefined']];
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

export function mutateLine(line) {
  if (COMMENT.test(line)) return null;
  for (const [pattern, swap] of MUTATIONS) if (pattern.test(line)) return line.replace(pattern, swap);
  return null;
}

export function candidates(fileText, addedLines) {
  const wanted = new Set(addedLines);
  return fileText.split('\n').flatMap((line, index) => {
    const mutated = wanted.has(line) ? mutateLine(line) : null;
    return mutated ? [{ index, mutated }] : [];
  });
}

// The lines a branch added to each guarded file.
function guardedLines(root, base) {
  const added = new Map();
  for (const l of readDiff(root, base, snapshotTree(root)).lines.filter((x) => x.sign === '+' && GUARDED.test(x.file))) added.set(l.file, [...(added.get(l.file) ?? []), l.text]);
  return added;
}

const mappedTests = (map, file) => Object.entries(map).filter(([k]) => file === k || (k.endsWith('/') && file.startsWith(k))).flatMap(([, list]) => list);

// Each mutant of one file, run against the file's mapped tests in the copy, with the original put back afterwards.
function mutateFile(copy, { file, text, tests }, run) {
  const original = fs.readFileSync(path.join(copy, file), 'utf8');
  for (const { index, mutated } of candidates(original, text)) {
    if (run.ran >= run.max) break;
    run.ran += 1;
    const mutant = original.split('\n');
    mutant[index] = mutated;
    fs.writeFileSync(path.join(copy, file), mutant.join('\n'));
    const { NODE_TEST_CONTEXT: _child, ...env } = process.env;
    const r = spawnSync(process.execPath, ['--test', ...tests], { cwd: copy, env: { ...env, SOMI_GLOBAL_CONFIG: '' }, encoding: 'utf8', timeout: 180000 });
    if (r.status === 0) run.survivors.push(`${file}:${index + 1}: ${mutated.trim().slice(0, 110)}`);
  }
  fs.writeFileSync(path.join(copy, file), original);
}

function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, max: { type: 'string' } } });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const base = spawnSync('git', ['rev-parse', values.base ?? 'origin/main'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const added = guardedLines(root, base);
  if (added.size === 0) { console.log('no guarded file changed'); return 0; }

  const { map } = JSON.parse(fs.readFileSync(path.join(root, 'somi.check.json'), 'utf8'));
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-mutate-'));
  const run = { ran: 0, max: Number(values.max ?? 25), survivors: [] };
  try {
    fs.cpSync(root, copy, { recursive: true, filter: (src) => !/(^|\/)(node_modules|\.git|\.somi|dist|coverage)$/.test(src) });
    for (const [file, text] of added) mutateFile(copy, { file, text, tests: mappedTests(map, file) }, run);
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
  const { ran, survivors } = run;
  console.log(`${ran} mutants, ${survivors.length} survived`);
  survivors.forEach((s) => console.log(`  ${s}`));
  return survivors.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
