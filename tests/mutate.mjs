#!/usr/bin/env node
// Diff-scoped mutation check, for security-relevant code only. It flips one operator on each changed line of a guarded file, runs the
// tests somi.check.json maps to that file, and names the mutants the tests did not catch. It works on private copies of the repository,
// one per worker, and never touches the real tree. Run it before a push when one of these files changed. It is not part of `npm test`.
//
// It passes only when every mutant was run and caught. A mutant left out by --max, one whose tests timed out, and one in a file with no
// mapped tests are not verified, so each makes the run fail and is counted in the summary: a partial run never reads as a pass.
//
//   node tests/mutate.mjs [--base REF] [--max N] [--jobs N]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readDiff, snapshotTree } from '../scripts/lib/git-tree.mjs';

export const GUARDED = /^(scripts\/lib\/(path-safety|path-facts|reviews|policy|signals)\.mjs|hooks\/(pre-tool\/[^/]+|lib\/common)\.mjs)$/;
const MUTATIONS = [[/===/, '!=='], [/!==/, '==='], [/&&/, '||'], [/\|\|/, '&&'], [/\btrue\b/, 'false'], [/\bfalse\b/, 'true'], [/>=/, '<'], [/<=/, '>'], [/\breturn null\b/, 'return undefined']];
const COMMENT = /^\s*(\/\/|\*|\/\*)/;
const TIMEOUT_MS = 180000;

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

// Every mutant of every changed line of a guarded file, with the tests mapped to that file.
function mutantsOf(root, base, map) {
  const out = [];
  for (const [file, text] of guardedLines(root, base)) {
    const original = fs.readFileSync(path.join(root, file), 'utf8');
    const tests = mappedTests(map, file);
    for (const c of candidates(original, text)) out.push({ file, original, tests, ...c });
  }
  return out;
}

// The mapped tests in one copy: {code, timedOut}. `--test` runs each file in a child of its own, so the whole group is ended on a timeout.
function runTests(dir, tests) {
  const { NODE_TEST_CONTEXT: _child, ...env } = process.env;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', ...tests], { cwd: dir, env: { ...env, SOMI_GLOBAL_CONFIG: '' }, stdio: 'ignore', detached: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }, TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, timedOut }); });
  });
}

const label = (m) => `${m.file}:${m.index + 1}: ${m.mutated.trim().slice(0, 110)}`;
function record(run, m, r) {
  if (r.timedOut) run.timedOut.push(label(m));
  else if (r.code === 0) run.survivors.push(label(m));
  else run.caught += 1;
}

// One worker: its own copy of the repository, taking mutants off the shared queue until it is empty, the original put back after each.
async function worker(copy, queue, run) {
  for (let m = queue.shift(); m; m = queue.shift()) {
    const file = path.join(copy, m.file);
    const lines = m.original.split('\n');
    lines[m.index] = m.mutated;
    fs.writeFileSync(file, lines.join('\n'));
    record(run, m, await runTests(copy, m.tests));
    fs.writeFileSync(file, m.original);
  }
}

async function runAll(root, queue, jobs) {
  const run = { caught: 0, survivors: [], timedOut: [] };
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-mutate-'));
  try {
    fs.cpSync(root, path.join(base, 'w0'), { recursive: true, filter: (src) => !/(^|\/)(node_modules|\.git|\.somi|dist|coverage)$/.test(src) });
    const copies = Array.from({ length: jobs }, (_, i) => path.join(base, `w${i}`));
    for (const c of copies.slice(1)) fs.cpSync(copies[0], c, { recursive: true });
    await Promise.all(copies.map((c) => worker(c, queue, run)));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
  return run;
}

/** The summary -> {code, lines}: how many mutants ran out of how many there are. It passes only when all of them ran and were caught. */
export function report(all, ran, run) {
  const unmapped = all.filter((m) => m.tests.length === 0);
  const notRun = all.length - ran - unmapped.length;
  const lines = [`${ran} of ${all.length} mutants run: ${run.caught} caught, ${run.survivors.length} survived, ${run.timedOut.length} timed out`];
  lines.push(...run.survivors.map((s) => `  survived  ${s}`), ...run.timedOut.map((s) => `  timed out ${s}`));
  for (const file of new Set(unmapped.map((m) => m.file))) lines.push(`NOT VERIFIED: no tests are mapped to ${file} in somi.check.json, so its mutants were not run`);
  if (notRun > 0) lines.push(`INCOMPLETE: ${notRun} mutants were not run (--max). This is not a pass.`);
  return { code: run.survivors.length + run.timedOut.length + unmapped.length + notRun === 0 ? 0 : 1, lines };
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, max: { type: 'string' }, jobs: { type: 'string' } } });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const base = spawnSync('git', ['rev-parse', values.base ?? 'origin/main'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const { map } = JSON.parse(fs.readFileSync(path.join(root, 'somi.check.json'), 'utf8'));
  const all = mutantsOf(root, base, map);
  if (all.length === 0) { console.log('no changed line of a guarded file has a mutant to try'); return 0; }
  const queue = all.filter((m) => m.tests.length > 0).slice(0, values.max === undefined ? Infinity : Number(values.max));
  const ran = queue.length;
  const jobs = Math.max(1, Math.min(ran, Number(values.jobs ?? Math.max(1, os.availableParallelism() - 2))));
  const { code, lines } = report(all, ran, await runAll(root, queue, jobs));
  lines.forEach((l) => console.log(l));
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
