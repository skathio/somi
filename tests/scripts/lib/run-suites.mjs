#!/usr/bin/env node
// run-suites.mjs -- runs independent test scripts concurrently and prints each one's output whole, in the
// order given, so a parallel run reads exactly like a serial one.
//
// Usage: node tests/scripts/lib/run-suites.mjs [--jobs N] [--] <script.sh> ...
//
// Each script runs as `bash <script>` from the current directory with the inherited environment. --jobs
// defaults to SOMI_TEST_JOBS, else half the machine's cores (at least 2); 1 is a serial run. Exit 0 when
// every script exits 0, else 1, after every script has finished and printed, followed by a summary that
// names each failure and the slowest scripts. Exit 64 on a usage error. Ctrl-C stops every running script.

import { spawn } from 'node:child_process';
import os from 'node:os';

const USAGE = 'usage: run-suites.mjs [--jobs N] [--] <script.sh> ...';

// Half the cores, at least two: most scripts start node processes of their own, and a fully loaded machine makes the
// eval gates' hidden-suite runs hit their 60 s kill, which reads as failed cases.
export function defaultJobs(cores = os.availableParallelism()) {
  return Math.max(2, Math.floor(cores / 2));
}

export function parseArgs(argv, env = process.env) {
  const scripts = [];
  let jobs = env.SOMI_TEST_JOBS ?? String(defaultJobs());
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') { scripts.push(...argv.slice(i + 1)); break; }
    if (argv[i] === '--jobs') { jobs = argv[++i]; continue; }
    if (argv[i].startsWith('-')) return { error: `unknown option ${argv[i]}` };
    scripts.push(argv[i]);
  }
  if (!/^[1-9][0-9]{0,2}$/.test(String(jobs))) return { error: `--jobs (or SOMI_TEST_JOBS) must be a whole number from 1 to 999, got ${JSON.stringify(jobs)}` };
  if (scripts.length === 0) return { error: 'no scripts given' };
  return { jobs: Number(jobs), scripts };
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


export async function runSuites({ jobs, scripts }, write = (s) => process.stdout.write(s)) {
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
  const finished = (i) => (results[i] ? Promise.resolve() : new Promise((r) => { waiters[i] = r; }));
  const started = Date.now();
  const pool = Promise.all(Array.from({ length: Math.min(jobs, scripts.length) }, worker));
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
