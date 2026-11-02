// check.mjs: `somi check`, the fast gate before every commit, and `somi check --full`, the push gate.
//
// It runs project commands, so only the CLI calls it, from a shell the OS sandbox wraps. The MCP server runs outside the sandbox and
// must never reach this module. The plan comes from a committed somi.check.json:
//   { "budget_s": 60, "fast_cmd": "npm run lint", "full_cmd": "npm test", "always": ["tests/x.test.mjs"],
//     "map": { "scripts/lib/a.mjs": ["tests/a.test.mjs"], "hooks/": ["tests/hooks.test.mjs"] },
//     "model_name_gate": true, "gate_exclude": ["CHANGELOG.md"] }
// A map key ending in "/" is a prefix. A code file no key covers falls back to full_cmd, within the budget.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { readDiff, baseRef, snapshotTree } from './git-tree.mjs';
import { NEXT_ACTIONS, deriveCursor, journalProblems, readEvents, statePaths } from './journal.mjs';
import { conflictMarkerProblems, modelNameProblems, pipefailProblems, planningIdProblems } from './gates.mjs';

const DEFAULT_BUDGET_S = 60;
const MAX_SHOWN = 10;
const JS = /\.(mjs|cjs|js)$/;
const SHELL = /\.(sh|bash)$/;
const DOC = /\.(md|mdx|txt|rst|adoc|json|ya?ml|toml|png|svg)$/i;
const RUNNABLE_TEST = /(^|\/)[^/]*\.test\.(mjs|cjs|js)$|(^|\/)tests?\/[^/]+\.(sh|bash)$/;

export function loadPlan(root) {
  const file = path.join(root, 'somi.check.json');
  let plan = {};
  try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('somi.check.json is not valid JSON'); }
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const map = plan.map !== null && typeof plan.map === 'object' ? plan.map : {};
  return {
    budget_s: Number.isInteger(plan.budget_s) && plan.budget_s > 0 ? plan.budget_s : DEFAULT_BUDGET_S,
    fast_cmd: typeof plan.fast_cmd === 'string' ? plan.fast_cmd : null,
    full_cmd: typeof plan.full_cmd === 'string' ? plan.full_cmd : null,
    always: strings(plan.always),
    map: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, strings(v)])),
    model_name_gate: plan.model_name_gate === true,
    gate_exclude: strings(plan.gate_exclude),
  };
}

export function selectTests(files, plan, exists) {
  const tests = new Set(plan.always);
  let unmapped = false;
  for (const f of files) {
    if (RUNNABLE_TEST.test(f)) { tests.add(f); continue; }
    const hit = Object.entries(plan.map).filter(([k]) => f === k || (k.endsWith('/') && f.startsWith(k)));
    hit.forEach(([, list]) => list.forEach((t) => tests.add(t)));
    if (hit.length === 0 && !DOC.test(f) && exists(f)) unmapped = true;
  }
  return { tests: [...tests].filter(exists).sort(), unmapped };
}

const gate = (name, failures) => ({ name, ok: failures.length === 0, failures: failures.slice(0, MAX_SHOWN), more: Math.max(0, failures.length - MAX_SHOWN) });

// `node --check` accepts a broken .js that it cannot classify as a module or a script, so a .js file is tried both ways. Neither
// way runs the file.
function parses(abs) {
  const checkAsModule = (file) => spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10000 }).status === 0;
  if (abs.endsWith('.mjs')) return checkAsModule(abs);
  const text = fs.readFileSync(abs, 'utf8').replace(/^#!.*/, '');
  try { new vm.Script(`(function () {\n${text}\n})`); return true; } catch { /* not a script; it may still be a module */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-parse-'));
  try {
    const copy = path.join(dir, 'module.mjs');
    fs.writeFileSync(copy, text);
    return checkAsModule(copy);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function lintGate(root, files) {
  const failures = [];
  for (const f of files) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs) || !fs.lstatSync(abs).isFile()) continue;
    if (JS.test(f)) {
      if (!parses(abs)) failures.push(`${f}: does not parse`);
    } else if (f.endsWith('.json')) {
      try { JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { failures.push(`${f}: invalid JSON`); }
    } else if (SHELL.test(f)) failures.push(...pipefailProblems(f, fs.readFileSync(abs, 'utf8')));
  }
  return gate('lint', failures);
}

function artefactGate(root, env) {
  const failures = [];
  try {
    failures.push(...journalProblems(readEvents(root, env)));
    const { state } = statePaths(root, env);
    if (fs.existsSync(state)) {
      const cursor = JSON.parse(fs.readFileSync(state, 'utf8'));
      if (!NEXT_ACTIONS.includes(cursor.next)) failures.push('state.json has an undocumented next status');
    }
  } catch (e) { failures.push(e.message); }
  return gate('artefacts', failures);
}

function runShell(root, name, command, timeoutMs) {
  const r = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL') return gate(name, [`over the time budget: ${command}`]);
  if (r.status === 0) return gate(name, []);
  const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-6).join(' | ').slice(0, 600);
  return gate(name, [`${command}: exit ${r.status}: ${tail}`]);
}

function runTests(root, tests, timeoutMs) {
  const js = tests.filter((t) => !SHELL.test(t));
  const results = [];
  const start = Date.now();
  const left = () => Math.max(1, timeoutMs - (Date.now() - start));
  if (js.length > 0) {
    // A test runner's child marker in the environment would make this run report nothing, so it is dropped.
    const { NODE_TEST_CONTEXT: _child, ...env } = process.env;
    const r = spawnSync(process.execPath, ['--test', ...js], { cwd: root, env, encoding: 'utf8', timeout: left(), killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 });
    if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL') results.push('tests went over the time budget; map fewer tests to this path');
    else if (r.status !== 0) results.push(...`${r.stdout}`.split('\n').filter((l) => /^\s*not ok|^✖|^\s*✖/.test(l)).map((l) => l.trim()).slice(0, MAX_SHOWN), ...(r.status !== 0 && !/not ok|✖/.test(`${r.stdout}`) ? ['the test run failed'] : []));
  }
  for (const t of tests.filter((x) => SHELL.test(x))) {
    const r = spawnSync('bash', [t], { cwd: root, encoding: 'utf8', timeout: left(), killSignal: 'SIGKILL' });
    if (r.status !== 0) results.push(`${t}: failed`);
  }
  return gate('tests', results);
}

export function runCheck({ root, env = process.env, full = false, from = null }) {
  const started = Date.now();
  const plan = loadPlan(root);
  const tree = snapshotTree(root);
  const diff = readDiff(root, from ?? baseRef(root), tree);
  const excluded = (f) => plan.gate_exclude.some((e) => f === e || (e.endsWith('/') && f.startsWith(e)));
  const files = diff.rows.filter((r) => !r.status.startsWith('D')).map((r) => r.file);
  const added = diff.lines.filter((l) => l.sign === '+' && !excluded(l.file));

  const gates = [
    gate('diff', diff.unreadable ? ['the diff is too large to read'] : []),
    lintGate(root, files),
    gate('conflict-markers', conflictMarkerProblems(added)),
    gate('planning-ids', planningIdProblems(added)),
    gate('model-names', plan.model_name_gate ? modelNameProblems(added) : []),
    artefactGate(root, env),
  ];

  if (full) {
    const command = plan.full_cmd ?? (hasNpmTest(root) ? 'npm test' : null);
    gates.push(command ? runShell(root, 'full-suite', command, undefined) : gate('full-suite', []));
  } else {
    const budget = plan.budget_s * 1000;
    const left = () => Math.max(1, budget - (Date.now() - started));
    if (plan.fast_cmd) gates.push(runShell(root, 'fast', plan.fast_cmd, left()));
    const selected = selectTests(files, plan, (f) => fs.existsSync(path.join(root, f)));
    if (selected.unmapped && plan.full_cmd) gates.push(runShell(root, 'tests', plan.full_cmd, left()));
    else if (selected.tests.length > 0) gates.push(runTests(root, selected.tests, left()));
  }

  const failed = gates.filter((g) => !g.ok).map((g) => g.name);
  return { ok: failed.length === 0, tree, full, failed, gates: gates.filter((g) => !g.ok), ran: gates.map((g) => g.name), elapsed_ms: Date.now() - started };
}

function hasNpmTest(root) {
  try { return typeof JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts?.test === 'string'; } catch { return false; }
}

// The base a check compares against: the open milestone's start, or HEAD.
export const checkBase = (root, env) => deriveCursor(readEvents(root, env)).base;
