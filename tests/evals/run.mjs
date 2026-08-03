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

/**
 * Iteration 4.1's gate: certify the assumption the whole error budget rests on -- a working
 * dimension passes >=99% of runs.
 *
 * POOLED, not per-dimension, and that is the whole point. A `>=19/20` per-dimension gate clears a
 * true-0.95 dimension 73.6% of the time -- exactly the case that then makes `unstable` fire on
 * something in 64% of every later 120-run comparison -- and bounces a perfectly sharp corpus 19.8%
 * of the time, because all 13 dimensions must clear independently. Pooled at <=5/260:
 *
 *   true rate 0.99 -> clears 95.2%      true rate 0.95 -> clears 0.9%
 *
 * Near-total separation, at zero extra cost: the same 20 runs, read pooled instead of per-dimension.
 * Per-dimension rates are still reported, because pooling decides but only the per-dimension view
 * says WHICH task to sharpen.
 *
 * A soft dimension is a TASK DEFECT, returned to 3.3 for sharpening before 4.2 begins. It is never
 * absorbed by widening the band -- that would be the corpus certifying itself.
 */
export const CERTIFY = { maxFailures: 5, draws: 260 };

export function certify(result, { maxFailures = CERTIFY.maxFailures } = {}) {
  const dimensions = [];
  let failures = 0;
  let draws = 0;
  for (const [task, t] of Object.entries(result.tasks ?? {})) {
    for (const [dim, d] of Object.entries(t.dimensions ?? {})) {
      const missed = d.n - d.passes;
      failures += missed;
      draws += d.n;
      dimensions.push({ task, dim, passes: d.passes, n: d.n, rate: d.n ? d.passes / d.n : null, failures: missed });
    }
  }
  dimensions.sort((a, b) => a.rate - b.rate || a.task.localeCompare(b.task));
  // `certified` REQUIRES the full draw count. Reading a raw failure count against a budget
  // defined for 260 draws is a vacuous pass: 3 failures in 25 draws cleared "<=5" and printed
  // `certified: true` while scaling to ~31 per 260 -- six times over budget and plainly not on
  // track. A partial run cannot certify, and saying so in the flag is safer than saying it in a
  // second flag the reader has to remember to check.
  const enough = draws >= CERTIFY.draws;
  // Rate against the budget, so a partial run still says whether it is TRENDING to certify.
  const projected = draws ? (failures / draws) * CERTIFY.draws : null;
  return {
    certified: enough && failures <= maxFailures,
    onTrack: projected === null ? null : projected <= maxFailures,
    projectedFailures: projected === null ? null : Math.round(projected * 10) / 10,
    failures,
    draws,
    maxFailures,
    // Named separately from `certified` so a caller cannot read "few failures" as "enough runs".
    // A corpus that failed 0 of 20 draws is not certified; it is barely started.
    sufficientDraws: enough,
    dimensions,
    softest: dimensions.slice(0, 3),
  };
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
      // Per-criterion verdicts and the evidence quoted for each are kept, not just the rolled-up
      // dimensions. A dimension that reads `fail` is only actionable if you can see WHICH
      // criterion failed and on what span -- and 4.1's whole job is to tell a soft TASK from a
      // weak definition set, which the aggregate cannot do.
      runs: perRun.map((r, i) => ({
        index: r.index ?? i,
        dimensions: r.dimensions,
        criteria: r.criteria ?? null,
        error: r.error ?? null,
        transcript: r.transcript ?? null,
      })),
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
// Live scoring (iteration 4.1's execution path)
// ---------------------------------------------------------------------------------------------

/** The prompt each task issues, read from its own spec so the two cannot drift. */
export function taskPrompt(taskSpec) {
  const fenced = taskSpec.match(/```user-(?:problem-statement|feature)\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const quoted = taskSpec.match(/^> \*\*Iteration [^\n]*\n([\s\S]*?)(?=\n\n)/m);
  if (quoted) return quoted[0].replace(/^> ?/gm, '').trim();
  return null;
}

/**
 * Execute one run of one task against one definition set, and score it.
 *
 * The working tree is rebuilt from scratch for every run. Sharing it would make run N+1 depend on
 * run N, and the whole N=20 design assumes independent draws -- a shared tree would produce
 * correlated outcomes that the binomial thresholds are not valid for.
 */
export async function runOnce({ taskId, taskSpec, fixtureDir, sourceDir, index, model, judgeModel }) {
  const { installSomi, invokeCommand, workingTreeDiff, uninstallSomi } = await import('./lib/install.mjs');
  const { judge, toDimensions, criterionTags } = await import('./lib/score.mjs');

  const work = mkdtempSync(join(tmpdir(), `somi-eval-${taskId}-`));
  try {
    cpSync(fixtureDir, work, { recursive: true });
    if (existsSync(join(work, '_somi'))) cpSync(join(work, '_somi'), join(work, '.somi'), { recursive: true });
    rmSync(join(work, '_somi'), { recursive: true, force: true });
    installSomi(sourceDir, work);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
    execFileSync('git', ['config', 'user.email', 'eval@somi.invalid'], { cwd: work });
    execFileSync('git', ['config', 'user.name', 'somi eval'], { cwd: work });
    execFileSync('git', ['add', '-A'], { cwd: work });
    execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: work });

    const prompt = taskPrompt(taskSpec);
    if (!prompt) return { index, error: 'no prompt found in the task spec', dimensions: {} };

    const command = (taskSpec.match(/Command under test: `\/(\w[\w-]*)`/) ?? [])[1];
    const run = invokeCommand(work, `/${command} ${prompt}`, { model });
    const tree = workingTreeDiff(work);
    uninstallSomi(work);

    if (!run.ok) {
      // NO dimensions recorded -- the same rule the judge-fault path already follows, and for the
      // same reason. An earlier version marked every declared dimension `false` here, reasoning
      // that a failed run "fails everything". That is wrong and it corrupted a real measurement:
      // four runs died on `You've hit your session limit` and the certification read
      // 23 failures across 25 draws, with S2/S1/S6 at 0/5 -- numbers describing a QUOTA outage,
      // presented as evidence about the definition set.
      //
      // A run that never executed is not a run that failed. It must not enter the denominator.
      const quota = /session limit|rate limit|usage limit|quota/i.test(run.stdout + run.stderr);
      return {
        index,
        error: run.timedOut ? 'timed out' : (quota ? 'quota exhausted' : (run.error ?? `exit ${run.status}`)),
        dimensions: {},
        transcript: run.stdout.slice(-4000),
        harnessFault: true,
        quotaFault: quota,
      };
    }

    const evidence = [
      '### What the run returned\n', run.stdout,
      '\n### Files the run created or modified\n',
      tree.changed.map((c) => `${c.status} ${c.path}`).join('\n') || '(none)',
      '\n### Diff against the baseline commit\n', (tree.diff || '(empty)').slice(0, 20000),
    ].join('\n');

    const verdict = judge(taskSpec, evidence, { model: judgeModel });

    // Task 03 criterion 3 is EXECUTED, not judged: it already reads as an executable assertion
    // ("the cited case must genuinely fail"), and judging it asks a model to do arithmetic it can
    // get wrong in the same direction the candidate did. Overrides the judge's verdict only when
    // a date was actually extractable -- otherwise it returns null and the judge's verdict stands.
    // Task 01 criterion 6 is a file-list check against an allowlist -- mechanical, and it should
    // never have been judged. Found by two judges disagreeing on it.
    if (verdict.ok && taskId === '01') {
      try {
        const { boundaryRespected } = await import('./lib/boundary.mjs');
        const b = boundaryRespected(tree.changed);
        const c = verdict.criteria.find((x) => x.n === 6);
        if (c) {
          c.verdict = b.ok ? 'pass' : 'fail';
          c.evidence = b.ok
            ? 'EXECUTED: every changed path is inside the allowlist (not judged)'
            : `EXECUTED: paths outside the allowlist: ${b.offenders.join(', ')}`;
          c.executed = true;
        }
      } catch { /* fall back to the judged verdict */ }
    }

    if (verdict.ok && taskId === '03') {
      try {
        const { reproduces } = await import('./lib/reproduce.mjs');
        const refs = await task03Reference(sourceDir);
        const executed = reproduces(run.stdout, refs);
        if (executed !== null) {
          const c = verdict.criteria.find((x) => x.n === 3);
          if (c) {
            c.verdict = executed ? 'pass' : 'fail';
            c.evidence = `EXECUTED: the cited date ${executed ? 'reproduces' : 'does NOT reproduce'} the defect (not judged)`;
            c.executed = true;
          }
        }
      } catch { /* fall back to the judged verdict */ }
    }
    if (!verdict.ok) {
      // No dimensions are recorded. A judge fault is not evidence about the definition set, and
      // scoring it as failures would put a harness problem into the corpus statistics -- exactly
      // the confusion the non-attributable verdict exists to prevent one layer down.
      return { index, error: `judge: ${verdict.error}`, dimensions: {}, transcript: run.stdout.slice(-4000), harnessFault: true };
    }

    return {
      index,
      dimensions: toDimensions(verdict.criteria, criterionTags(taskSpec)),
      criteria: verdict.criteria,
      transcript: run.stdout,
      error: null,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Sharded results: batching, resume, and merge
// ---------------------------------------------------------------------------------------------
//
// Certification is 260 draws at ~320 s each -- hours of wall clock. Holding that in one process
// means a crash at run 19 of 20 discards nineteen runs that were already paid for, and it forces
// whoever launched it to babysit a single long-lived invocation.
//
// So each run is persisted the moment it finishes, as its own file under
// `results/<sha>/<task>-<index>.json`. A later invocation SKIPS indices that already exist, which
// makes the runner idempotent: run it with `--runs 20` as many times as you like, in whatever
// chunks fit, and it converges on 20. `--merge` then folds the shards into one result file for
// `certify()`.
//
// Shards are keyed by SHA, not by date or run label. Pooling draws that were scored against
// different definition sets would silently answer a question nobody asked -- and `--source HEAD`
// is exactly how that happens, since HEAD moves between batches.

/**
 * Re-score shards already on disk against the CURRENT task specs, without re-running any agent.
 *
 * A criterion change invalidates stored verdicts but not stored transcripts. Re-running the agent
 * to fix a scoring change would discard the expensive half of every draw -- ~12 minutes each --
 * to redo the cheap half. This redoes only the cheap half.
 *
 * Sharpening criterion 4 after 4.1's first five draws is exactly the case: the runs were fine, the
 * criterion was ambiguous, and the transcripts still say what the runs did.
 *
 * TWO SOURCES, and conflating them makes this silently do nothing. The DEFINITION SET is pinned by
 * `sha` -- that is what was measured and it must not move. The TASK SPEC is the SCORER, and the
 * entire reason to rescore is that the scorer changed, so it is read from the working tree by
 * default. Passing the pinned worktree for both re-judges against the criterion you just replaced
 * and reports "unchanged" for every shard, which is exactly what it did on the first attempt.
 */
export async function rescoreShards(sha, specDir = REPO, { judgeModel = null } = {}) {
  const { judge, toDimensions, criterionTags } = await import('./lib/score.mjs');
  const dir = shardDir(sha);
  const files = execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.json'));
  const changes = [];
  for (const f of files.sort()) {
    const path = join(dir, f);
    const rec = JSON.parse(readFileSync(path, 'utf8'));
    if (!rec.run.transcript || rec.run.error) continue;
    const spec = readFileSync(taskFile(rec.taskId, specDir), 'utf8');
    const verdict = judge(spec, `### What the run returned\n\n${rec.run.transcript}`, { model: judgeModel });
    if (!verdict.ok) {
      changes.push({ f, error: verdict.error });
      // Same rule as the run loop: once quota is gone every remaining call fails identically, and
      // continuing just converts one outage into N indistinguishable errors.
      if (verdict.quota) { changes.push({ f: '(stopped)', error: 'quota exhausted - re-run after reset; shards are unchanged' }); break; }
      continue;
    }
    const before = rec.run.dimensions;
    const after = toDimensions(verdict.criteria, criterionTags(spec));
    const moved = Object.keys({ ...before, ...after }).filter((d) => before[d] !== after[d]);
    rec.run.dimensions = after;
    rec.run.criteria = verdict.criteria;
    rec.run.rescored = true;
    writeFileSync(path, JSON.stringify(rec, null, 2) + '\n');
    changes.push({ f, moved, before, after });
  }
  return changes;
}

export function shardDir(sha) {
  return join(HERE, 'results', sha ?? 'unversioned');
}

export function shardPath(sha, taskId, index) {
  return join(shardDir(sha), `${taskId}-${String(index).padStart(3, '0')}.json`);
}

/** Which run indices for this task are already on disk. */
export function completedIndices(sha, taskId, runs) {
  const out = new Set();
  for (let i = 0; i < runs; i++) if (existsSync(shardPath(sha, taskId, i))) out.add(i);
  return out;
}

/** Fold every shard for a SHA into the result shape `certify()` and `compare()` consume. */
export function mergeShards(sha, { runs = BANDS.n } = {}) {
  const dir = shardDir(sha);
  if (!existsSync(dir)) throw new Error(`no shards for ${sha} at ${dir}`);
  const files = execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.json'));
  const tasks = {};
  for (const f of files.sort()) {
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    (tasks[rec.taskId] ??= []).push(rec.run);
  }
  for (const id of Object.keys(tasks)) tasks[id].sort((a, b) => a.index - b.index);
  return buildResult({ source: { ref: sha, sha }, tasks, runs });
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

export function taskFile(id, dir) {
  const base = join(dir, 'tests', 'evals', 'tasks');
  const name = execFileSync('ls', [base], { encoding: 'utf8' }).split('\n').find((n) => n.startsWith(`${id}-`));
  if (!name) throw new Error(`no task spec for id ${id}`);
  return join(base, name);
}

export function fixtureFor(id, dir) {
  const base = join(dir, 'tests', 'evals', 'fixtures');
  const name = execFileSync('ls', [base], { encoding: 'utf8' }).split('\n')
    .find((n) => n.startsWith(`task${id}-`) && !n.endsWith('.mjs') && !n.endsWith('.patch'));
  if (!name) throw new Error(`no fixture for task ${id}`);
  return join(base, name);
}

function parseArgs(argv) {
  const a = { source: 'HEAD', tasks: null, runs: BANDS.n, dryRun: false, out: null, model: null,
              judgeModel: null, merge: null, certifySha: null, rescore: null, batch: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--source') a.source = argv[++i];
    else if (k === '--tasks') a.tasks = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--runs') a.runs = Number(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--model') a.model = argv[++i];
    else if (k === '--judge-model') a.judgeModel = argv[++i];
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--merge') a.merge = argv[++i];
    else if (k === '--certify') a.certifySha = argv[++i];
    else if (k === '--rescore') a.rescore = argv[++i];
    else if (k === '--batch') a.batch = Number(argv[++i]);
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
  --batch N            execute at most N NEW runs this invocation, then stop. Shards already on
                       disk are reused, so repeated invocations converge on --runs.
  --rescore <sha>      re-judge stored transcripts against the CURRENT task specs, in place. Use
                       after a criterion changes: it redoes only the cheap half of each draw.
  --merge <sha>        fold results/<sha>/*.json into one result file and report certification
  --certify <sha>      same as --merge (certification is just the merged view)
  --dry-run            build the result shape without invoking a model. No network, no credential.
  --out FILE           write the result JSON here (default tests/evals/results/<sha>-<date>.json)

Requires network and an API credential unless --dry-run. Deliberately not wired into npm test.`;

/** The correct and patched `prorate` implementations, for executing task 03's criterion 3. */
export async function task03Reference(sourceDir) {
  const base = join(sourceDir, 'tests', 'evals', 'fixtures', 'task03-review', 'src', 'billing', 'proration.mjs');
  const correct = (await import(pathToFileURL(base).href)).prorate;
  const src = readFileSync(base, 'utf8')
    .replace('  const dim = daysInMonth(changeDate);', '  const dim = Math.min(daysInMonth(changeDate), 30);')
    .replace(/^import .*$/m, 'const fmtAmt = () => "";');
  const patched = (await import('data:text/javascript,' + encodeURIComponent(src))).prorate;
  return { correct, patched };
}

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

  if (args.rescore) {
    // Specs come from the WORKING TREE, not from the pinned definition set. See rescoreShards.
    process.stdout.write(`  re-judging against the task specs in ${REPO} (the current scorer)\n`);
    const changes = await rescoreShards(args.rescore, REPO, { judgeModel: args.judgeModel });
    for (const c of changes) {
      if (c.error) { process.stdout.write(`  ${c.f}: JUDGE ERROR ${c.error}\n`); continue; }
      process.stdout.write(`  ${c.f}: ${c.moved.length ? c.moved.map((d) => `${d} ${c.before[d]}->${c.after[d]}`).join(', ') : 'unchanged'}\n`);
    }
    return 0;
  }

  if (args.merge || args.certifySha) {
    const sha = args.merge ?? args.certifySha;
    const merged = mergeShards(sha, { runs: args.runs });
    if (args.out) { mkdirSync(dirname(resolve(process.cwd(), args.out)), { recursive: true });
      writeFileSync(resolve(process.cwd(), args.out), JSON.stringify(merged, null, 2) + '\n'); }
    const c = certify(merged);
    process.stdout.write(
      `${sha.slice(0, 12)}: ${c.failures} failure(s) across ${c.draws} draw(s)\n` +
      `  certified:       ${c.certified}${c.certified ? '' : `  (needs ${CERTIFY.draws} draws AND <=${c.maxFailures} failures)`}\n` +
      `  enough draws:    ${c.sufficientDraws}${c.sufficientDraws ? '' : `  (need ${CERTIFY.draws}, have ${c.draws})`}\n` +
      `  on track:        ${c.onTrack}  (this rate projects to ${c.projectedFailures} failures per ${CERTIFY.draws})\n` +
      c.dimensions.map((d) => `  ${d.task} ${d.dim}: ${d.passes}/${d.n}`).join('\n') + '\n');
    // Exit 0 even when uncertified: "the corpus is not sharp enough yet" is a RESULT, and a
    // non-zero exit would make a batch script treat it as a crash and retry it forever.
    return 0;
  }

  const taskIds = args.tasks ?? discoverTasks();
  if (taskIds.length === 0) throw new Error('no tasks found in tests/evals/tasks/');

  if (!args.dryRun) {
    // Checked once, before any work: discovering a missing credential on run 14 of 20 wastes the
    // thirteen that already cost money, and a partial result file invites being read as a result.
    const { preflight } = await import('./lib/install.mjs');
    const pre = preflight();
    if (!pre.ready) {
      throw new Error(`cannot run live: ${pre.problems.join('; ')}. Use --dry-run for a shape check.`);
    }
  }
  const source = resolveSource(args.source);

  // `--source HEAD` across a multi-batch certification is a footgun, and I walked into it: HEAD
  // moved on a docs commit between batch 1 and batch 2, so the shards landed under two SHAs and
  // could not pool. The docs already said "pin the SHA"; saying it louder was not the fix.
  //
  // A warning, not a refusal -- a single exploratory run against HEAD is perfectly reasonable, and
  // blocking it would make the common case annoying to serve the batched one.
  if (!args.dryRun && /^(HEAD|@|main|master)$/.test(args.source) && args.runs > 1) {
    process.stderr.write(
      `\n  WARNING: --source ${args.source} is a MOVING ref.\n` +
      `  Shards are keyed by the SHA it resolves to right now (${source.sha?.slice(0, 12)}). If the ref\n` +
      `  moves between batches, later runs land under a different SHA and the two sets cannot pool.\n` +
      `  For a batched certification, pin it:  --source ${source.sha?.slice(0, 12)}\n\n`);
  }
  try {
    const tasks = {};
    let executed = 0;
    for (const id of taskIds) {
      tasks[id] = [];
      for (let i = 0; i < args.runs; i++) {
        if (executed >= args.batch) {
          process.stderr.write(`  ${id}: batch cap of ${args.batch} reached; ${args.runs - i} run(s) left for the next invocation\n`);
          break;
        }
        if (args.dryRun) {
          // Shape only. Every dimension the task declares is recorded as `n-a`, so a dry run
          // produces a well-formed file with no grades invented from nothing.
          tasks[id].push({ index: i, dimensions: dryRunDimensions(id, source.dir), error: null });
        } else {
          const shard = shardPath(source.sha, id, i);
          if (existsSync(shard)) {
            // Already scored in an earlier batch. Read it back rather than re-running: the point
            // of sharding is that a paid-for run is never paid for twice.
            tasks[id].push(JSON.parse(readFileSync(shard, 'utf8')).run);
            process.stderr.write(`  ${id} run ${i + 1}/${args.runs}: (already done)\n`);
            continue;
          }
          const spec = readFileSync(taskFile(id, source.dir), 'utf8');
          const fixture = fixtureFor(id, source.dir);
          const r = await runOnce({ taskId: id, taskSpec: spec, fixtureDir: fixture, sourceDir: source.dir, index: i, model: args.model, judgeModel: args.judgeModel });
          process.stderr.write(`  ${id} run ${i + 1}/${args.runs}: ${r.error ? 'ERROR ' + r.error : Object.entries(r.dimensions).map(([k, v]) => k + (v ? '+' : '-')).join(' ')}\n`);
          // Written BEFORE anything else can fail. Everything after this point is bookkeeping.
          //
          // Harness faults are NOT persisted: a shard means "this draw was scored", and resume
          // treats any shard as done. Persisting a quota outage would bake it in as a permanent
          // result that no re-run ever revisits.
          if (!r.harnessFault) {
            mkdirSync(dirname(shard), { recursive: true });
            writeFileSync(shard, JSON.stringify({ sha: source.sha, taskId: id, run: r }, null, 2) + '\n');
          }
          tasks[id].push(r);
          executed += 1;
          // Quota is not a per-run accident: once it is exhausted every remaining run fails the
          // same way, and each failure still costs a fixture rebuild and a shard write. Batch 2
          // burned four runs after the first one hit `You've hit your session limit`. Stop.
          if (r.quotaFault) {
            process.stderr.write(
              `\n  QUOTA EXHAUSTED after ${executed} run(s). Stopping.\n` +
              `  Shards already on disk are kept; re-run the same command after the reset and it\n` +
              `  resumes from where it stopped.\n`);
            throw Object.assign(new Error('quota exhausted'), { quota: true });
          }
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
    .catch((err) => {
      process.stderr.write(`eval runner: ${err.message}\n`);
      // Quota exhaustion exits 0: it is an expected pause, not a crash, and a batch script that
      // retried on non-zero would hammer a limit that only time clears.
      process.exit(err.quota ? 0 : 1);
    });
}
