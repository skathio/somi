#!/usr/bin/env node
// Eval corpus runner — scores SoMi's golden tasks against a definition set.
//
// NOT part of `npm test`. This entrypoint invokes a model: it needs network and an API
// credential, and phase 3's exit criteria require `npm test` to stay hermetic. `validate.sh`
// gives this file `node --check` syntax coverage and nothing else.
//
// The unit of measurement is a **task-dimension**: task 01's S2, task 03's S5, and so on. Each is
// run N times against a definition set and graded by how often it passed. Phase 4 compares those
// grades between a baseline definition set and a trimmed one.
//
// `--source` exists because that comparison needs two definition sets in one run, and reading
// them from the working tree would make the result depend on which branch happened to be checked
// out. A git ref is resolved to a detached worktree, used, and removed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------------------------

// Bands come from rubric.md §"Run count and thresholds": N=20, pass >=18, fail <=10, unstable
// between. They are NOT free parameters — they were derived from a binomial power analysis
// against a stated corpus-quality bar (a working dimension passes >=99% of runs). An earlier
// draft encoded N=10 bands that the corrected arithmetic invalidated, and the phase file's scope
// line still carried the stale figure; see the diary entry for 3.4a.
export const BANDS = { n: 20, pass: 18, fail: 10 };

/**
 * Grade a task-dimension from its per-run outcomes.
 *
 * Takes the run count explicitly rather than inferring it from `passes`, so a truncated result
 * set grades as what it is instead of silently rescaling. A run that errored is neither a pass
 * nor an absence: it must appear in `n`.
 *
 * @param {number} passes how many of the N runs passed this dimension
 * @param {number} n total runs attempted
 * @returns {'pass'|'unstable'|'fail'}
 */
export function grade(passes, n = BANDS.n) {
  if (!Number.isInteger(passes) || !Number.isInteger(n) || n <= 0 || passes < 0 || passes > n) {
    throw new RangeError(`grade: passes=${passes} n=${n} is not a valid outcome count`);
  }
  // Scale the thresholds when n differs from the rubric's N, so a partial run is still readable.
  // Grades from a short run are directional only; phase 4's gate requires the full N.
  const passAt = Math.ceil((BANDS.pass / BANDS.n) * n);
  const failAt = Math.floor((BANDS.fail / BANDS.n) * n);
  if (passes >= passAt) return 'pass';
  if (passes <= failAt) return 'fail';
  return 'unstable';
}

/**
 * Compare a candidate definition set against a baseline, per rubric.md's acceptance rule:
 * a trim is accepted when no task-dimension drops its grade, AND no dimension is `unstable` in
 * the candidate unless it was already `unstable` in the baseline.
 */
export function compare(baseline, candidate) {
  const ORDER = { fail: 0, unstable: 1, pass: 2 };
  const regressions = [];
  for (const [task, dims] of Object.entries(baseline)) {
    for (const [dim, base] of Object.entries(dims)) {
      const cand = candidate?.[task]?.[dim];
      if (cand === undefined) {
        regressions.push({ task, dim, baseline: base, candidate: null, why: 'missing in candidate' });
        continue;
      }
      if (ORDER[cand] < ORDER[base]) {
        regressions.push({ task, dim, baseline: base, candidate: cand, why: 'grade dropped' });
      } else if (cand === 'unstable' && base !== 'unstable') {
        regressions.push({ task, dim, baseline: base, candidate: cand, why: 'became unstable' });
      }
    }
  }
  return { accepted: regressions.length === 0, regressions };
}

// ---------------------------------------------------------------------------------------------
// Definition-set resolution
// ---------------------------------------------------------------------------------------------

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * Resolve `--source` to a directory holding the definition set, plus the SHA it came from.
 *
 * A path is used in place (SHA recorded as null — an unversioned source cannot be reproduced,
 * and the result file should say so rather than imply a commit). A git ref is checked out into a
 * detached worktree so the caller's working tree is never touched and two sets can be live at once.
 */
export function resolveSource(source, { repo = REPO } = {}) {
  if (source && (source.startsWith('/') || source.startsWith('.'))) {
    const dir = resolve(repo, source);
    if (!existsSync(dir)) throw new Error(`--source path does not exist: ${dir}`);
    return { dir, sha: null, ref: source, cleanup() {} };
  }
  const ref = source || 'HEAD';
  let sha;
  try {
    // stderr piped, not inherited: this is a probe, and a failed one is reported by the throw
    // below. Letting git's "fatal: Needed a single revision" through would make an expected
    // outcome look like a crash in any caller capturing output.
    sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(`--source is neither an existing path nor a resolvable git ref: ${ref}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'somi-eval-src-'));
  git(repo, 'worktree', 'add', '--detach', '--quiet', dir, sha);
  return {
    dir,
    sha,
    ref,
    cleanup() {
      // `worktree remove` first so git's metadata goes too; the rmSync is the belt for a
      // worktree git has already forgotten (a killed run leaves one behind).
      try { git(repo, 'worktree', 'remove', '--force', dir); } catch { /* fall through */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Result file
// ---------------------------------------------------------------------------------------------

/**
 * Build the result record. Shape is the contract phase 4 consumes, so it is constructed in one
 * place and asserted by `tests/scripts/eval-runner.sh`.
 *
 * Every run is recorded individually with its index. Aggregates are derived here rather than
 * stored independently, so a result file cannot disagree with itself.
 */
export function buildResult({ source, tasks, runs, dryRun = false, now = new Date() }) {
  const out = {
    schema: SCHEMA_VERSION,
    generated: now.toISOString(),
    dryRun,
    runsRequested: runs,
    bands: { ...BANDS },
    source: { ref: source.ref, sha: source.sha },
    tasks: {},
  };
  for (const [taskId, perRun] of Object.entries(tasks)) {
    const dims = {};
    for (const run of perRun) {
      for (const [dim, outcome] of Object.entries(run.dimensions)) {
        // `n-a` dimensions are declared by the task and never counted — a task that does not
        // exercise a dimension must not drag its grade.
        if (outcome === 'n-a') continue;
        dims[dim] ??= { passes: 0, n: 0 };
        dims[dim].n += 1;
        if (outcome === true || outcome === 'pass') dims[dim].passes += 1;
      }
    }
    out.tasks[taskId] = {
      runs: perRun.map((r, i) => ({ index: r.index ?? i, dimensions: r.dimensions, error: r.error ?? null })),
      dimensions: Object.fromEntries(
        Object.entries(dims).map(([dim, { passes, n }]) => [dim, { passes, n, grade: grade(passes, n) }]),
      ),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fixture execution (iteration 3.4b)
// ---------------------------------------------------------------------------------------------

/** Run a fixture's own `node:test` suite and parse the counts. Never throws on a red suite. */
export function runSuite(dir) {
  let out = '';
  let crashed = false;
  try {
    out = execFileSync(process.execPath, ['--test'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
    });
  } catch (err) {
    // A red suite exits non-zero; so does a suite that could not load. Both land here, and the
    // difference between them is exactly what criterion 1 turns on -- so keep the output and let
    // classify() decide, rather than treating "threw" as "failed".
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    crashed = !err.stdout;
  }
  const num = (k) => { const m = out.match(new RegExp(`^(?:#|\u2139) ${k} (\\d+)`, 'm')); return m ? Number(m[1]) : null; };
  return { pass: num('pass'), fail: num('fail'), tests: num('tests'), crashed, output: out };
}

/**
 * Why is this suite red?
 *
 * Criterion 1(c) requires an ASSERTION failure. An import error, a TypeError, or a module
 * resolution failure means the candidate's test never got to express an opinion about expiry --
 * the red came from the substitution not fitting, not from the defect. Grading those as "the
 * guard worked" would pass a test that never checks expiry, which is the hole the criterion
 * exists to close.
 */
export function classifyRed({ pass, fail, crashed, output }) {
  if (!crashed && fail === 0 && pass !== null) return 'green';
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|ERR_UNKNOWN_FILE_EXTENSION/.test(output)) return 'module-resolution';
  // BEFORE the SyntaxError branch: node reports a missing named export as
  // `SyntaxError: The requested module ... does not provide an export named ...`, so checking
  // SyntaxError first diagnoses a surface mismatch as broken candidate source.
  if (/does not provide an export named|is not exported|Named export .* not found/.test(output)) return 'import-error';
  if (/SyntaxError/.test(output)) return 'syntax-error';
  if (/AssertionError|ERR_ASSERTION|assert\./.test(output)) return 'assertion';
  if (/TypeError/.test(output)) return 'type-error';
  if (fail > 0) return 'other-failure';
  return 'unknown';
}

/**
 * Score task 02 criterion 1 against a candidate working tree.
 *
 * Three steps, in order, each gating the next:
 *   (a) green on the candidate's own source  -- a red-before suite proves nothing
 *   (b) green on the CONTROL                 -- cancels every axis except expiry
 *   (c) attributably red on the MUTANT       -- an assertion failure, not a load failure
 *
 * (b) is what makes (c) mean anything. The mutant is frozen against the SHIPPED token.mjs, so it
 * differs from the candidate's file on every axis the candidate touched. Without the control, a
 * candidate that fixes expiry and also changes the signature encoding can pass with a test that
 * contains no expiry logic at all -- measured, and the reason the control exists.
 */
export function scoreExpiryGuard(candidateDir, { mutant, control, target = 'src/auth/token.mjs' } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'somi-eval-cand-'));
  const step = (replacement) => {
    rmSync(work, { recursive: true, force: true });
    cpSync(candidateDir, work, { recursive: true });
    if (replacement) cpSync(replacement, join(work, target));
    return runSuite(work);
  };
  try {
    const own = step(null);
    if (own.crashed || own.fail !== 0) {
      return { verdict: 'fail', step: 'own', reason: 'not green on its own source', attributable: true, steps: { own } };
    }
    const ctl = step(control);
    if (ctl.crashed || ctl.fail !== 0) {
      const observed = classifyRed(ctl);
      // A LOAD failure means the frozen reference does not fit the candidate's surface -- 3.3b
      // states R3 to the candidate, so this is a rule the run was given, but the outcome still
      // says nothing about expiry either way. Recorded rather than graded, so phase 4 cannot read
      // a corpus/candidate mismatch as a definition-set regression.
      const loadFailure = observed === 'import-error' || observed === 'module-resolution' || observed === 'syntax-error';
      return {
        verdict: loadFailure ? 'non-attributable' : 'fail',
        step: 'control',
        reason: loadFailure
          ? `the control could not load against this candidate (${observed}) - export surface changed, see R3`
          : 'red on the control: the test disagrees with correct expiry behaviour',
        observed,
        attributable: !loadFailure,
        steps: { own, control: ctl },
      };
    }
    const mut = step(mutant);
    const observed = classifyRed(mut);
    if (observed === 'green') {
      return { verdict: 'fail', step: 'mutant', reason: 'the new test passes against the mutant', observed, attributable: true, steps: { own, control: ctl, mutant: mut } };
    }
    if (observed !== 'assertion') {
      // Neither pass nor fail: the run changed something the frozen reference cannot satisfy
      // (3.3b states the export-surface rule to the candidate, so this is a rule the run was
      // given). Recorded rather than graded, so a corpus defect cannot masquerade as a
      // definition-set regression in phase 4.
      return { verdict: 'non-attributable', step: 'mutant', reason: `red on the mutant, but from ${observed}`, observed, attributable: false, steps: { own, control: ctl, mutant: mut } };
    }
    return { verdict: 'pass', step: 'mutant', observed, attributable: true, steps: { own, control: ctl, mutant: mut } };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { source: 'HEAD', tasks: null, runs: BANDS.n, dryRun: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--source') a.source = argv[++i];
    else if (k === '--tasks') a.tasks = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--runs') a.runs = Number(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  if (!Number.isInteger(a.runs) || a.runs <= 0) throw new Error(`--runs must be a positive integer`);
  return a;
}

const USAGE = `somi eval runner

  node tests/evals/run.mjs --source <git-ref|path> [options]

  --source <ref|path>  definition set to score (default HEAD). A git ref is checked out into a
                       detached worktree and removed afterwards; a path is used in place.
  --tasks 01,03        task ids to run (default: every task in tests/evals/tasks/)
  --runs N             runs per task (default ${BANDS.n}, the rubric's N)
  --dry-run            build the result shape without invoking a model. No network, no credential.
  --out FILE           write the result JSON here (default tests/evals/results/<sha>-<date>.json)

Requires network and an API credential unless --dry-run. Deliberately not wired into npm test.`;

/** Task ids, read from the corpus rather than hardcoded so a new task file is picked up. */
export function discoverTasks(dir = join(HERE, 'tasks')) {
  return execFileSync('ls', [dir], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .map((f) => f.slice(0, f.indexOf('-')))
    .sort();
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(USAGE + '\n'); return 0; }

  const taskIds = args.tasks ?? discoverTasks();
  if (taskIds.length === 0) throw new Error('no tasks found in tests/evals/tasks/');

  const source = resolveSource(args.source);
  try {
    const tasks = {};
    for (const id of taskIds) {
      tasks[id] = [];
      for (let i = 0; i < args.runs; i++) {
        if (args.dryRun) {
          // Shape only. Every dimension the task declares is recorded as `n-a`, so a dry run
          // produces a well-formed file with no grades invented from nothing.
          tasks[id].push({ index: i, dimensions: dryRunDimensions(id, source.dir), error: null });
        } else {
          throw new Error(
            'live scoring is iteration 3.4b (fixture executor + mutation substitution). ' +
            'Use --dry-run until then.',
          );
        }
      }
    }
    const result = buildResult({ source, tasks, runs: args.runs, dryRun: args.dryRun });
    const outPath = args.out
      ? resolve(process.cwd(), args.out)
      : join(HERE, 'results', `${source.sha?.slice(0, 12) ?? 'unversioned'}-${result.generated.slice(0, 10)}.json`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(`wrote ${outPath}\n`);
    return 0;
  } finally {
    source.cleanup();
  }
}

/** Read the dimensions a task declares from its spec's header line. */
export function dryRunDimensions(id, sourceDir) {
  const file = join(sourceDir, 'tests', 'evals', 'tasks');
  let text = '';
  try {
    const names = execFileSync('ls', [file], { encoding: 'utf8' }).split('\n');
    const match = names.find((n) => n.startsWith(`${id}-`));
    if (match) text = readFileSync(join(file, match), 'utf8');
  } catch { /* fall through to the local corpus */ }
  if (!text) {
    const names = execFileSync('ls', [join(HERE, 'tasks')], { encoding: 'utf8' }).split('\n');
    const match = names.find((n) => n.startsWith(`${id}-`));
    if (match) text = readFileSync(join(HERE, 'tasks', match), 'utf8');
  }
  const dims = {};
  for (const m of text.matchAll(/\*\*(S[1-7])\*\*/g)) dims[m[1]] = 'n-a';
  for (const m of text.matchAll(/(S[1-7](?:,\s*S[1-7])*)\s*:\s*`n-a`/g)) {
    for (const d of m[1].split(',')) dims[d.trim()] = 'n-a';
  }
  return dims;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => { process.stderr.write(`eval runner: ${err.message}\n`); process.exit(1); });
}
