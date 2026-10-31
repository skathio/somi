#!/usr/bin/env node
// run-suites.mjs -- runs independent test scripts concurrently and prints each one's output whole, in the
// order given, so a parallel run reads exactly like a serial one.
//
// Usage: node tests/scripts/lib/run-suites.mjs [--jobs N] [--alone <script.sh>]... [--plan FILE [--shard NAME]]
//                                               [--] <script.sh> ...
//
// Each script runs as `bash <script>` from the current directory with the inherited environment. --jobs
// defaults to SOMI_TEST_JOBS, else half the machine's cores (at least 2); 1 is a serial run. Exit 0 when
// every script exits 0, else 1, after every script has finished and printed, followed by a summary that
// names each failure and the slowest scripts. Exit 64 on a usage error. Ctrl-C stops every running script.
//
// --alone runs a script by itself, before the pool, with nothing else running: for a script whose checks carry
// wall-clock limits that CPU contention can break (a hidden-suite family killed at its timeout reads as failed cases).
//
// --plan reads tests/scripts/suite-plan.json: its `alone` list, and its `shards`, named groups of slow scripts that
// CI runs on separate runners. --shard (default SOMI_SUITE_SHARD, else `all`) picks what runs: `all`, one named
// shard, or `light`, every given script no shard names. So the shards and `light` together run each script once.
// A script the plan names but the caller did not give is an error, so a rename cannot drop a script silently.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const USAGE = 'usage: run-suites.mjs [--jobs N] [--alone <script.sh>]... [--plan FILE [--shard NAME]] [--] <script.sh> ...';

// Half the cores, at least two: most scripts start node processes of their own, and a fully loaded machine makes the
// eval gates' hidden-suite runs hit their 60 s kill, which reads as failed cases.
export function defaultJobs(cores = os.availableParallelism()) {
  return Math.max(2, Math.floor(cores / 2));
}

export function parseArgs(argv, env = process.env) {
  const scripts = [];
  const alone = [];
  let jobs = env.SOMI_TEST_JOBS ?? String(defaultJobs());
  let plan = null;
  let shard = null; // --shard; SOMI_SUITE_SHARD applies only when a plan is given
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') { scripts.push(...argv.slice(i + 1)); break; }
    if (argv[i] === '--jobs') { jobs = argv[++i]; continue; }
    if (argv[i] === '--plan') { if (!argv[i + 1]) return { error: '--plan needs a file' }; plan = argv[++i]; continue; }
    if (argv[i] === '--shard') { if (!argv[i + 1]) return { error: '--shard needs a name' }; shard = argv[++i]; continue; }
    if (argv[i] === '--alone') { if (!argv[i + 1]) return { error: '--alone needs a script' }; alone.push(argv[++i]); continue; }
    if (argv[i].startsWith('-')) return { error: `unknown option ${argv[i]}` };
    scripts.push(argv[i]);
  }
  if (!/^[1-9][0-9]{0,2}$/.test(String(jobs))) return { error: `--jobs (or SOMI_TEST_JOBS) must be a whole number from 1 to 999, got ${JSON.stringify(jobs)}` };
  if (scripts.length + alone.length === 0) return { error: 'no scripts given' };
  if (plan === null) return shard === null ? { jobs: Number(jobs), scripts, alone } : { error: '--shard needs --plan' };
  shard ??= env.SOMI_SUITE_SHARD || 'all';
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(plan, 'utf8')); } catch (e) { return { error: `cannot read the plan ${plan}: ${e.message}` }; }
  const chosen = selectShard([...alone, ...scripts], parsed, shard);
  return chosen.error ? chosen : { jobs: Number(jobs), ...chosen };
}

// Applies a suite plan to the given scripts. Returns { alone, scripts } for the shard, or { error }.
export function selectShard(given, plan, shard) {
  const shards = plan?.shards ?? {};
  const planAlone = plan?.alone ?? [];
  if (!Array.isArray(planAlone) || typeof shards !== 'object' || Array.isArray(shards)) return { error: 'the plan needs an `alone` list and a `shards` object' };
  if (Object.hasOwn(shards, 'all') || Object.hasOwn(shards, 'light')) return { error: '`all` and `light` are reserved shard names' };
  const owner = new Map();
  for (const [name, list] of Object.entries(shards)) {
    if (!Array.isArray(list) || list.length === 0) return { error: `shard ${name} must list at least one script` };
    for (const s of list) { if (owner.has(s)) return { error: `${s} is in two shards, ${owner.get(s)} and ${name}` }; owner.set(s, name); }
  }
  const named = [...new Set([...planAlone, ...owner.keys()])];
  const missing = named.filter((s) => !given.includes(s));
  if (missing.length) return { error: `the plan names scripts that were not given: ${missing.join(', ')}` };
  if (shard !== 'all' && shard !== 'light' && !Object.hasOwn(shards, shard)) return { error: `unknown shard ${shard} (expected all, light or ${Object.keys(shards).join(', ')})` };
  const pick = shard === 'all' ? given : shard === 'light' ? given.filter((s) => !owner.has(s)) : given.filter((s) => owner.get(s) === shard);
  return { alone: pick.filter((s) => planAlone.includes(s)), scripts: pick.filter((s) => !planAlone.includes(s)) };
}

// Every child still running, so Ctrl-C can stop them all.
const running = new Set();

function runOne(script) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    const child = spawn('bash', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
    running.add(child);
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    const done = (code) => { running.delete(child); resolve({ script, code, output: Buffer.concat(chunks).toString('utf8'), seconds: (Date.now() - started) / 1000 }); };
    child.on('error', (e) => { chunks.push(Buffer.from(`run-suites: could not start bash ${script}: ${e.message}\n`)); done(127); });
    child.on('close', (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
}


export async function runSuites({ jobs, scripts: pooled, alone = [] }, write = (s) => process.stdout.write(s)) {
  // The alone scripts come first in the list and run with a pool of one, so nothing overlaps them.
  const scripts = [...alone, ...pooled];
  const results = new Array(scripts.length);
  const waiters = new Array(scripts.length);
  let next = 0;
  const worker = async () => {
    while (next < scripts.length) {
      const i = next++;
      results[i] = await runOne(scripts[i]);
      waiters[i]?.();
    }
  };
  const worker1 = async () => { const i = next++; results[i] = await runOne(scripts[i]); waiters[i]?.(); };
  const finished = (i) => (results[i] ? Promise.resolve() : new Promise((r) => { waiters[i] = r; }));
  const started = Date.now();
  const pool = (async () => {
    while (next < alone.length) await worker1();
    await Promise.all(Array.from({ length: Math.min(jobs, scripts.length - next) }, worker));
  })();
  // Print in input order: each block waits for its own script, never for a later one.
  for (let i = 0; i < scripts.length; i++) {
    await finished(i);
    const r = results[i];
    write(`==> ${r.script}\n${r.output}${r.output.endsWith('\n') || r.output === '' ? '' : '\n'}`);
    write(`    (${r.seconds.toFixed(1)}s, ${r.code === 0 ? 'ok' : `FAILED, exit ${r.code}`})\n`);
  }
  await pool;
  const failed = results.filter((r) => r.code !== 0);
  const slowest = [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 5);
  const total = results.reduce((s, r) => s + r.seconds, 0);
  write(`\n==> ${results.length} suites, ${failed.length} failed, ${jobs} at a time: ${((Date.now() - started) / 1000).toFixed(1)}s wall, ${total.toFixed(1)}s of suite time\n`);
  write(`    slowest: ${slowest.map((r) => `${r.script} ${r.seconds.toFixed(1)}s`).join(', ')}\n`);
  for (const r of failed) write(`    FAILED: ${r.script} (exit ${r.code})\n`);
  return failed.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(`run-suites: ${args.error}\n${USAGE}`); process.exit(64); }
  const stop = () => { for (const c of running) c.kill('SIGTERM'); process.exit(130); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.exit((await runSuites(args)) ? 0 : 1);
}
