// L1 latency harness for the usage and speed benchmark: runs a list of EVENTS (a hook with a synthetic payload, a
// CLI path, a protocol round trip) N times each and reports wall time per event. Imports only siblings; the
// event list and any non-process runner (the MCP round trip) live in the entrypoint and arrive as arguments.
//
// An event is { id, command: [argv...], stdin?: string, env?: {name: string}, okCodes?: [int] } or, for a custom
// runner, any object the runner understands plus an id. The tokens {PROJECT} and {PLUGIN} in argv, stdin and env
// values are replaced with the temp project dir and the plugin root.
//
// Method, all of it deliberate:
//   - Sequential: one run at a time, events in order, runs in order. Parallel runs would measure contention.
//   - The first run of each event is a WARM-UP and is discarded: it pays for cold file cache, module compile and
//     any first-run side effect (a hook that writes a default config does so once). So runs + 1 executions happen
//     and exactly `runs` samples are kept.
//   - runs must be at least the rule's L1 minRepeats (default: exactly that); fewer is refused, not clamped.
//   - Isolation: each run happens in a throwaway project dir, with an allowlisted environment, HOME and
//     CLAUDE_PROJECT_DIR pointed there, and SOMI_AUDIT_LOG pointed at a file inside it, so the repo's own
//     .somi/audit.log is never written.
//   - Wall time comes from an injectable clock (default performance.now, ms). A sample must be strictly positive
//     (the baseline schema requires it); a clock that cannot resolve the run is an error, not a rounded value.
//   - A run that times out, cannot start or exits with an unexpected code fails the whole measurement: a failed
//     run's time is not a latency.
//   - p90 is nearest-rank: the sorted sample at index ceil(0.9 * n) - 1.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { median } from './bench-stats.mjs';

export const DEFAULT_TIMEOUT_MS = 10000;
const ENV_ALLOWLIST = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SYSTEMROOT'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** The rule's L1 minimum repeat count; throws when the rule is missing or has no such value. */
export function minRuns(loadedRule) {
  const n = loadedRule?.rule?.minEffect?.L1?.minRepeats;
  if (!Number.isInteger(n) || n < 1) throw new Error('bench-l1: a loaded rule with minEffect.L1.minRepeats is required');
  return n;
}

/** { samples, median, p90, min, max } for a non-empty list of ms. */
export function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('bench-l1: no samples to summarize');
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: [...samples],
    median: median(samples),
    p90: sorted[Math.ceil(0.9 * sorted.length) - 1],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/** The child environment: allowlisted names from baseEnv, then the isolation variables, then the event's own. */
export function buildEnv(baseEnv, { project, pluginRoot }, extra = {}) {
  const env = {};
  for (const k of ENV_ALLOWLIST) if (typeof baseEnv[k] === 'string') env[k] = baseEnv[k];
  env.HOME = project;
  env.CLAUDE_PROJECT_DIR = project;
  env.SOMI_AUDIT_LOG = join(project, 'audit.log');
  if (pluginRoot) env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  return { ...env, ...extra };
}

const subst = (s, ctx) => String(s).replaceAll('{PROJECT}', ctx.project).replaceAll('{PLUGIN}', ctx.pluginRoot ?? '');

/** Runs one process event with execFile (no shell); resolves on an expected exit code, rejects otherwise. */
export function execRunner(event, ctx) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = event.command.map((a) => subst(a, ctx));
    const env = buildEnv(ctx.baseEnv, ctx, Object.fromEntries(Object.entries(event.env ?? {}).map(([k, v]) => [k, subst(v, ctx)])));
    const ok = event.okCodes ?? [0];
    const child = execFile(cmd, args, { cwd: ctx.project, env, timeout: ctx.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1 << 24, windowsHide: true }, (err) => {
      if (!err) return resolve();
      if (err.killed) return reject(new Error(`event ${event.id}: timed out after ${ctx.timeoutMs} ms`));
      if (typeof err.code === 'number' && ok.includes(err.code)) return resolve();
      reject(new Error(`event ${event.id}: failed (${err.code ?? err.message})`));
    });
    // A child that exits without reading stdin raises EPIPE here; the exit code above is what decides the run.
    child.stdin.on('error', () => {});
    child.stdin.end(subst(event.stdin ?? '', ctx));
  });
}

function withTimeout(promise, ms, id) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`event ${id}: timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function checkEvents(events) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('bench-l1: events must be a non-empty array');
  const seen = new Set();
  for (const e of events) {
    if (typeof e?.id !== 'string' || !ID.test(e.id) || seen.has(e.id)) throw new Error(`bench-l1: invalid or duplicate event id ${JSON.stringify(e?.id)}`);
    seen.add(e.id);
  }
}

/**
 * Measures every event. opts: { events, rule (loaded), runs (default and floor: the rule's minimum), runner
 * (default execRunner), clock (default performance.now), timeoutMs, pluginRoot, baseEnv, projectDir (an existing
 * dir to use instead of a fresh temp one; the caller then owns its removal) }.
 * Returns { [eventId]: { samples, median, p90, min, max } }.
 */
export async function measureEvents(opts) {
  const { events, rule, runner = execRunner, clock = () => performance.now(), timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const floor = minRuns(rule);
  const runs = opts.runs ?? floor;
  if (!Number.isInteger(runs) || runs < floor) throw new RangeError(`bench-l1: runs must be an integer >= ${floor} (the rule's L1 minRepeats), got ${runs}`);
  checkEvents(events);
  const own = opts.projectDir === undefined;
  const project = own ? mkdtempSync(join(tmpdir(), 'somi-l1-')) : opts.projectDir;
  const ctx = { project, pluginRoot: opts.pluginRoot, baseEnv: opts.baseEnv ?? process.env, timeoutMs };
  const out = {};
  try {
    for (const event of events) {
      const samples = [];
      for (let i = 0; i <= runs; i++) {
        const t0 = clock();
        await withTimeout(runner(event, ctx), timeoutMs, event.id);
        const ms = clock() - t0;
        if (!(ms > 0)) throw new Error(`event ${event.id}: non-positive elapsed time ${ms}`);
        if (i > 0) samples.push(ms);
      }
      out[event.id] = summarize(samples);
    }
  } finally {
    if (own) rmSync(project, { recursive: true, force: true });
  }
  return out;
}

/** The baseline's L1 section: { events: { id: [ms...] } }. */
export function toBaselineL1(results) {
  return { events: Object.fromEntries(Object.entries(results).map(([id, r]) => [id, r.samples])) };
}
