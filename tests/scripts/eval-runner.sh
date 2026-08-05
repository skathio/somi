#!/usr/bin/env bash
# Unit guard for tests/evals/run.mjs (iteration 3.4a).
#
# Hermetic by construction: every case below is `--dry-run` or a direct function call. No model
# invocation, no network, no credential. That is an exit criterion of phase 3, not a convenience.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
R=tests/evals/run.mjs
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# Run a snippet with run.mjs imported as `M`. Kept as a function so no case can forget the
# import path and silently test nothing.
j() { node --input-type=module -e "const M = await import('$ROOT/$R'); $1" 2>&1; }

echo "== eval runner =="

# --- the acceptance bands ---------------------------------------------------------------------
# rubric.md: N=20, pass >=18, fail <=10, unstable at 11-17. These four are named in the phase
# file's acceptance criterion.
check "20/20 grades pass"      "$(j 'process.stdout.write(M.grade(20))')" "pass"
check "18/20 grades pass"      "$(j 'process.stdout.write(M.grade(18))')" "pass"
check "14/20 grades unstable"  "$(j 'process.stdout.write(M.grade(14))')" "unstable"
check "9/20 grades fail"       "$(j 'process.stdout.write(M.grade(9))')"  "fail"

# --- the band EDGES, which is where an off-by-one lives ----------------------------------------
check "17/20 is unstable (just below the pass band)" "$(j 'process.stdout.write(M.grade(17))')" "unstable"
check "11/20 is unstable (just above the fail band)" "$(j 'process.stdout.write(M.grade(11))')" "unstable"
check "10/20 is fail (the fail band is inclusive)"   "$(j 'process.stdout.write(M.grade(10))')" "fail"
check "0/20 is fail"                                 "$(j 'process.stdout.write(M.grade(0))')"  "fail"

# --- a truncated run must grade as what it is, not rescale silently ----------------------------
# grade() takes n explicitly. If it inferred n from the data, 9 passes out of 9 attempted runs
# would read as `fail` against N=20 -- the run was short, not bad.
check "9/9 grades pass (n is explicit, not inferred)" "$(j 'process.stdout.write(M.grade(9, 9))')" "pass"
check "5/10 grades fail"                              "$(j 'process.stdout.write(M.grade(5, 10))')" "fail"
check "7/10 grades unstable"                          "$(j 'process.stdout.write(M.grade(7, 10))')" "unstable"

# --- invalid outcome counts must throw, not grade ----------------------------------------------
for bad_in in "21, 20" "-1, 20" "5, 0" "1.5, 20"; do
  got=$(j "try { M.grade($bad_in); process.stdout.write('NO THROW'); } catch (e) { process.stdout.write(e.constructor.name); }")
  check "grade($bad_in) throws rather than grading" "$got" "RangeError"
done

# --- the comparison rule phase 4 gates on ------------------------------------------------------
cmp_case() {
  j "const r = M.compare($2, $3); process.stdout.write(String(r.accepted) + ':' + r.regressions.length);" \
    | { read -r got; check "$1" "$got" "$4"; }
}
cmp_case "identical grades are accepted" \
  "{t1:{S1:'pass',S2:'pass'}}" "{t1:{S1:'pass',S2:'pass'}}" "true:0"
cmp_case "pass -> fail is a regression" \
  "{t1:{S1:'pass'}}" "{t1:{S1:'fail'}}" "false:1"
cmp_case "pass -> unstable is a regression" \
  "{t1:{S1:'pass'}}" "{t1:{S1:'unstable'}}" "false:1"
cmp_case "unstable -> unstable is NOT a regression (already unstable in baseline)" \
  "{t1:{S1:'unstable'}}" "{t1:{S1:'unstable'}}" "true:0"
cmp_case "fail -> pass is an improvement, not a regression" \
  "{t1:{S1:'fail'}}" "{t1:{S1:'pass'}}" "true:0"
# fail -> unstable ranks as an IMPROVEMENT by grade order, so the ordering check alone cannot see
# it. rubric.md still forbids it: "no dimension is unstable in the candidate set unless it was
# already unstable in the baseline". Mutation-verified -- deleting that branch survived every
# other case here.
cmp_case "fail -> unstable is a regression (became unstable, despite ranking higher)" \
  "{t1:{S1:'fail'}}" "{t1:{S1:'unstable'}}" "false:1"
cmp_case "a dimension missing from the candidate is a regression" \
  "{t1:{S1:'pass'}}" "{t1:{}}" "false:1"
cmp_case "two regressions are both reported" \
  "{t1:{S1:'pass',S2:'pass'}}" "{t1:{S1:'fail',S2:'unstable'}}" "false:2"

# --- result-file shape: the contract phase 4 consumes ------------------------------------------
shape=$( j "
  const src = { ref: 'HEAD', sha: 'abc123def456' };
  const tasks = { '01': [
    { index: 0, dimensions: { S1: true,  S2: false, S4: 'n-a' } },
    { index: 1, dimensions: { S1: true,  S2: true,  S4: 'n-a' } },
  ] };
  const r = M.buildResult({ source: src, tasks, runs: 2, dryRun: true, now: new Date('2026-08-01T00:00:00Z') });
  const d = r.tasks['01'].dimensions;
  process.stdout.write([
    r.schema, r.dryRun, r.source.sha, r.runsRequested, r.generated.slice(0,10),
    r.tasks['01'].runs.length,
    d.S1.passes + '/' + d.S1.n + ':' + d.S1.grade,
    d.S2.passes + '/' + d.S2.n + ':' + d.S2.grade,
    ('S4' in d) ? 'S4-COUNTED' : 'S4-excluded',
  ].join('|'));
")
check "result shape carries schema, sha, run index, and per-dimension grades" \
  "$shape" "1|true|abc123def456|2|2026-08-01|2|2/2:pass|1/2:fail|S4-excluded"

# An `n-a` dimension must not be counted at all. A task that does not exercise a dimension
# dragging its grade toward fail would make the corpus report regressions that never happened.
na=$( j "
  const r = M.buildResult({ source: {ref:'x',sha:null}, runs: 1,
    tasks: { '01': [ { index: 0, dimensions: { S3: 'n-a' } } ] } });
  process.stdout.write(JSON.stringify(r.tasks['01'].dimensions));
")
check "an all-n-a task produces no dimension entries" "$na" "{}"

# An unversioned --source must record sha: null rather than imply a commit.
check "a path source records sha null" \
  "$( j "process.stdout.write(String(M.resolveSource('./tests').sha))" )" "null"

# --- --source resolution and worktree cleanup --------------------------------------------------
head_sha=$(git rev-parse HEAD)
# Counted before and after, not absolutely: `git worktree list` is global state, and a concurrent
# eval run (which legitimately holds one for its whole duration) made this assertion fail on a
# clean tree. The invariant is "this test leaks none", not "none exist anywhere".
wt_before=$(git worktree list | grep -c somi-eval-src || true)
res=$( j "
  const s = M.resolveSource('HEAD');
  const fs = await import('node:fs');
  const had = fs.existsSync(s.dir) && fs.existsSync(s.dir + '/package.json');
  s.cleanup();
  const gone = !fs.existsSync(s.dir);
  process.stdout.write(s.sha + '|' + had + '|' + gone);
")
check "--source HEAD checks out a worktree and cleans it up" "$res" "$head_sha|true|true"
check "this test leaks no worktree" "$(( $(git worktree list | grep -c somi-eval-src || true) - wt_before ))" "0"

check "an unresolvable --source fails loudly" \
  "$( j "try { M.resolveSource('no-such-ref-xyz'); process.stdout.write('NO THROW'); } catch (e) { process.stdout.write('threw'); }" )" \
  "threw"

# --- dry run: a correctly-shaped file, and provably no model invocation -------------------------
out=$(mktemp) || { bad "mktemp failed"; exit 1; }
if node "$R" --dry-run --source HEAD --tasks 01 --runs 3 --out "$out" >/dev/null 2>&1; then
  ok "dry run exits 0"
else
  bad "dry run exits 0"
fi
dry=$( node -e "
  const r = JSON.parse(require('fs').readFileSync('$out','utf8'));
  process.stdout.write([r.dryRun, r.runsRequested, r.tasks['01'].runs.length, r.bands.n, r.bands.pass].join('|'));
" 2>&1 )
check "dry-run file has the right shape" "$dry" "true|3|3|20|18"

# The hermeticity claim, asserted structurally rather than by observing that it happened to work.
if grep -qE 'fetch\(|https?://|ANTHROPIC_API_KEY|api\.anthropic' "$R"; then
  bad "run.mjs contains no network call or credential read (dry run cannot leak)"
else
  ok "run.mjs contains no network call or credential read (dry run cannot leak)"
fi
# A live run is preflighted before any work. Simulated by clearing PATH and HOME so neither the
# CLI nor a credential resolves -- the runner must refuse with a named reason, not start spending
# and discover the problem on run 14 of 20.
# Keep node reachable; remove only the claude CLI and the credential.
NODE_BIN=$(command -v node)
pre=$(env -i "PATH=$(dirname "$NODE_BIN")" HOME=/nonexistent "$NODE_BIN" "$ROOT/$R" --source HEAD --tasks 01 --runs 1 2>&1 || true)
case "$pre" in
  *"cannot run live"*) ok "a live run preflights the CLI and credential before spending" ;;
  *)                   bad "a live run preflights the CLI and credential before spending (got: ${pre:0:80})" ;;
esac
rm -f "$out"

# --- 3.4b: fixture executor + mutation substitution --------------------------------------------
# The three hand-written candidates under fixtures/_candidates/ are the acceptance criterion,
# stated in the phase file. Each pins one outcome of scoreExpiryGuard()'s three steps.
FX="$ROOT/tests/evals/fixtures"
# `step` is asserted, not just the verdict. Without it, deleting the control check entirely
# survived every case: `changed-surface` returns `non-attributable` either way -- at (b) because
# the control cannot load, or at (c) because the mutant cannot either. Same verdict, different
# thing measured.
score() { j "
  const r = M.scoreExpiryGuard('$FX/_candidates/$1',
    { mutant: '$FX/task02-code-mutant.mjs', control: '$FX/task02-code-control.mjs' });
  process.stdout.write(r.verdict + '|' + r.step + '|' + (r.observed ?? '-') + '|' + r.attributable);
"; }
check "a correct expiry test passes, attributably" \
  "$(score correct-guard)"   "pass|mutant|assertion|true"
check "a test that never checks expiry FAILS (green on the mutant)" \
  "$(score no-expiry-test)"  "fail|mutant|green|true"
check "a changed export surface is caught AT THE CONTROL, non-attributably" \
  "$(score changed-surface)" "non-attributable|control|import-error|false"
# The only case exercising step (c)'s non-assertion branch. Green on the control, so the
# substitution fits; red on the mutant from a TypeError, so the test never expressed an opinion
# about expiry. Grading that as a pass would accept a guard that does not guard.
check "a TypeError red on the mutant is NON-ATTRIBUTABLE, not a pass" \
  "$(score type-error-red)"  "non-attributable|mutant|type-error|false"

# The classifier is what makes (c) mean anything: an import error graded as "the guard worked"
# passes a test that never checks expiry.
cls() { j "process.stdout.write(M.classifyRed({ pass: 0, fail: 1, crashed: false, output: \`$1\` }))"; }
check "an AssertionError classifies as assertion"      "$(cls 'AssertionError [ERR_ASSERTION]: x')" "assertion"
check "a missing named export is import-error, NOT syntax-error" \
  "$(cls 'SyntaxError: The requested module ./t.mjs does not provide an export named verifyToken')" "import-error"
check "ERR_MODULE_NOT_FOUND is module-resolution"      "$(cls 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module')" "module-resolution"
check "a TypeError is type-error, not assertion"       "$(cls 'TypeError: x is not a function')" "type-error"
check "a real SyntaxError still classifies as one"     "$(cls 'SyntaxError: Unexpected token }')" "syntax-error"
check "a green suite classifies as green" \
  "$(j "process.stdout.write(M.classifyRed({ pass: 3, fail: 0, crashed: false, output: '' }))")" "green"

# A candidate that is red on its OWN source is not scored -- red-then-red proves nothing.
redfirst=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
cp -r "$FX/_candidates/correct-guard/." "$redfirst"/
printf "\ntest('deliberately red', () => { assert.equal(1, 2); });\n" >> "$redfirst/tests/auth/token.test.mjs"
check "a candidate red on its own source is failed before substitution" \
  "$(j "const r = M.scoreExpiryGuard('$redfirst', { mutant: '$FX/task02-code-mutant.mjs', control: '$FX/task02-code-control.mjs' }); process.stdout.write(r.verdict + '|' + r.reason)")" \
  "fail|not green on its own source"
rm -rf "$redfirst"

# The executor must not mutate the candidate it scores -- it works on a copy.
check "scoring leaves the candidate tree untouched" \
  "$(j "
     const fs = await import('node:fs');
     const p = '$FX/_candidates/correct-guard/src/auth/token.mjs';
     const before = fs.readFileSync(p, 'utf8');
     M.scoreExpiryGuard('$FX/_candidates/correct-guard', { mutant: '$FX/task02-code-mutant.mjs', control: '$FX/task02-code-control.mjs' });
     process.stdout.write(String(fs.readFileSync(p, 'utf8') === before));
   ")" "true"

# --- 4.1: the pooled certification gate --------------------------------------------------------
# Synthetic result files, so the gate is tested without 260 model runs.
mk() { j "
  const tasks = {};
  const [nDims, n, passes] = [$1, $2, $3];
  for (let i = 0; i < nDims; i++) {
    tasks['t' + i] = [];
    for (let r = 0; r < n; r++) tasks['t' + i].push({ index: r, dimensions: { S1: r < passes } });
  }
  const res = M.buildResult({ source: { ref: 'x', sha: 'deadbeef' }, tasks, runs: n });
  const c = M.certify(res);
  process.stdout.write([c.certified, c.failures, c.draws, c.sufficientDraws].join('|'));
"; }
# 13 dimensions x 20 runs = 260 draws. A perfect corpus and a corpus at exactly the bar both pass.
check "13 dims x 20/20 certifies"                  "$(mk 13 20 20)" "true|0|260|true"
# A short run reports honestly instead of certifying -- see the partial-run case below.
check "5 failures across 260 draws certifies (at the bar)" "$(mk 13 20 20 | true; j "
  const tasks = {}; for (let i = 0; i < 13; i++) { tasks['t'+i] = [];
    for (let r = 0; r < 20; r++) tasks['t'+i].push({ index: r, dimensions: { S1: !(i < 5 && r === 0) } }); }
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: 20 }));
  process.stdout.write([c.certified, c.failures, c.draws].join('|'));")" "true|5|260"
check "6 failures across 260 draws does NOT certify" "$(j "
  const tasks = {}; for (let i = 0; i < 13; i++) { tasks['t'+i] = [];
    for (let r = 0; r < 20; r++) tasks['t'+i].push({ index: r, dimensions: { S1: !(i < 6 && r === 0) } }); }
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: 20 }));
  process.stdout.write([c.certified, c.failures, c.draws].join('|'));")" "false|6|260"

# The case the gate exists for: ONE dimension secretly at 0.90 while the rest hold. Per-dimension
# `>=19/20` would clear it 73.6% of the time; pooled catches it, because 2 failures from one
# dimension plus the corpus's own noise crosses the budget.
check "one dimension at 18/20 with 12 clean is caught by the pooled budget" "$(j "
  const tasks = {}; for (let i = 0; i < 13; i++) { tasks['t'+i] = [];
    for (let r = 0; r < 20; r++) tasks['t'+i].push({ index: r, dimensions: { S1: !(i === 0 && r < 6) } }); }
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: 20 }));
  process.stdout.write([c.certified, c.failures, c.softest[0].task, c.softest[0].rate.toFixed(2)].join('|'));")"   "false|6|t0|0.70"

# A short run must not read as certified. 0 failures out of 20 draws is not a sharp corpus; it is
# a corpus that has barely been sampled.
check "a 20-draw run cannot certify, however clean" "$(mk 1 20 20)" "false|0|20|false"

# --- sharding, resume and merge: what makes a 260-draw certification batchable ------------------
# Certification is hours of wall clock. Each run is persisted the moment it finishes so a crash at
# run 19 does not discard eighteen paid-for runs, and a later invocation skips what is already on
# disk. Tested by writing shards directly -- no model, no network.
SHARD_SHA="testsha$(date +%s)"
mk_shard() { j "
  const fs = await import('node:fs');
  const p = M.shardPath('$SHARD_SHA', '$1', $2);
  fs.mkdirSync(p.replace(/\/[^/]+\$/, ''), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ sha: '$SHARD_SHA', taskId: '$1', run: { index: $2, dimensions: { S1: $3 }, criteria: null, error: null } }));
  process.stdout.write('ok');
"; }
mk_shard 01 0 true  >/dev/null; mk_shard 01 1 true  >/dev/null
mk_shard 01 2 false >/dev/null; mk_shard 02 0 true  >/dev/null

check "completedIndices sees the shards already on disk" \
  "$(j "process.stdout.write([...M.completedIndices('$SHARD_SHA','01',5)].join(','))")" "0,1,2"
check "an unwritten index is not reported complete" \
  "$(j "process.stdout.write(String(M.completedIndices('$SHARD_SHA','01',5).has(4)))")" "false"

merged=$( j "
  const r = M.mergeShards('$SHARD_SHA', { runs: 3 });
  const d = r.tasks['01'].dimensions.S1;
  process.stdout.write([Object.keys(r.tasks).sort().join('+'), r.tasks['01'].runs.length, d.passes + '/' + d.n, r.source.sha].join('|'));
")
check "mergeShards folds every shard, per task, in index order" "$merged" "01+02|3|2/3|$SHARD_SHA"

# Shards are keyed by SHA. Pooling draws scored against DIFFERENT definition sets would answer a
# question nobody asked -- and `--source HEAD` is how that happens, because HEAD moves between
# batches.
check "a different sha has no shards" \
  "$(j "try { M.mergeShards('${SHARD_SHA}-other'); process.stdout.write('MERGED'); } catch { process.stdout.write('threw'); }")" \
  "threw"

# Certification reads the merged view, so a partial run reports honestly rather than certifying.
part=$( j "
  const c = M.certify(M.mergeShards('$SHARD_SHA', { runs: 3 }));
  process.stdout.write([c.certified, c.failures, c.draws, c.sufficientDraws].join('|'));
")
check "a partial corpus cannot certify on few failures alone" "$part" "false|1|4|false"

rm -rf "$ROOT/tests/evals/results/$SHARD_SHA"
check "shard directory is removable and merge then fails loudly" \
  "$(j "try { M.mergeShards('$SHARD_SHA'); process.stdout.write('MERGED'); } catch { process.stdout.write('threw'); }")" \
  "threw"

# --- executed criterion: task 03 criterion 3, scored by running it rather than judging it -------
rep() { j "
  const R = await import('$ROOT/tests/evals/lib/reproduce.mjs');
  const refs = await (await import('$ROOT/$R')).task03Reference('$ROOT');
  process.stdout.write(String(R.reproduces(\`$1\`, refs)));
"; }
check "a cited 31-day date reproduces the defect"        "$(rep 'the bug hits on 2026-07-16')" "true"
check "a cited 30-day date does NOT reproduce"           "$(rep 'consider 2026-04-16 here')"   "false"
check "a named 31-day month reproduces"                  "$(rep 'on July 16 it under-credits')" "true"
check "a named 30-day month does not"                    "$(rep 'on June 16 it under-credits')" "false"
# Fails SAFE. A parser returning `false` on an unrecognised phrasing would fail a correct review
# for citing its case in a form nobody anticipated -- the "criterion that fails a conforming run"
# this corpus keeps rediscovering. null means "fall back to the judge".
check "a hedge with no date returns null (judge fallback)" "$(rep 'the proration logic may be wrong')" "null"

# Reverted after the first agreement check disagreed on 1 of 6 verdicts. `null` means "whatever
# the CLI defaults to" -- the larger model -- not "unset by accident".
check "the judge does NOT default to a cheaper model" \
  "$(j "process.stdout.write(String((await import('$ROOT/tests/evals/lib/score.mjs')).DEFAULT_JUDGE_MODEL))")" "null"

bnd() { j "
  const B = await import('$ROOT/tests/evals/lib/boundary.mjs');
  const r = B.boundaryRespected($1);
  process.stdout.write(r.ok + (r.offenders.length ? ':' + r.offenders.join(',') : ''));
"; }
check "a conforming /plan run respects the boundary" \
  "$(bnd "[{path:'.somi/README.md'},{path:'.somi/audit.log'},{path:'.somi/somi-state/x'},{path:'.somi/plans/y/spec.md'}]")" "true"
check "a touched source file is caught, and named" \
  "$(bnd "[{path:'src/ingest/handler.mjs'}]")" "false:src/ingest/handler.mjs"
check "a stray root file is caught" \
  "$(bnd "[{path:'NOTES.md'}]")" "false:NOTES.md"

# --- task 01 scored from the ARTIFACT, not the prose -------------------------------------------
# Certification failed with a clean pattern: executed criteria 4/4, near-mechanical 4/4, semantic
# judged ones 3/4, 3/4, 2/4. A model judge cannot deliver the >=99% consistency the error budget
# assumes. The criteria were semantic because prose was all there was to score -- the mandated
# DECISIONS-NEEDED structure is destroyed by the command's relay in --print mode (measured: 0 of 4
# runs emitted the fenced block). decisions.md survives on disk, and parsing it is deterministic.
SAMPLE="$ROOT/tests/evals/fixtures/_candidates/decisions-sample.md"
t01() { j "
  const fs = await import('node:fs');
  const S = await import('$ROOT/tests/evals/lib/score-task01.mjs');
  let md = fs.readFileSync('$SAMPLE','utf8');
  $1
  process.stdout.write(JSON.stringify(S.executedVerdicts(md)));
"; }
# THE case that invalidated artifact scoring for this task. Task 01 scores the RESEARCH pass,
# which halts before anything is verified, so decisions.md is scaffolded from the template and
# correctly left empty. Reading placeholders as content returned FALSE and manufactured failures
# on runs that did nothing wrong -- observed live: the run with a scaffold scored S2- S1-, the run
# with no artifact deferred to the judge and scored S1+.
check "an unfilled template defers every criterion instead of failing them" \
  "$(t01 "md = '# Decisions — <work item name>\n\n## D1 — <decision title in noun form>\n\n### Decision\n\n<one sentence>\n';")" \
  '{"1":null,"2":null,"3":null,"4":null,"5":null}'
check "a conforming artifact satisfies the structural criteria" \
  "$(t01 '')" '{"1":true,"2":null,"3":true,"4":null,"5":true}'
check "an absent artifact defers every criterion to the judge" \
  "$(t01 "md = '';")" '{"1":null,"2":null,"3":null,"4":null,"5":null}'
check "an invented volume figure fails criterion 3" \
  "$(t01 "md += '\nExpect ~400M rows/yr.';")" '{"1":true,"2":null,"3":false,"4":null,"5":true}'
check "a Reverses field saying only cheaply fails criterion 5" \
  "$(t01 "md = md.replace(/\\*\\*Reverses\\*\\*:[^\\n]*/, '**Reverses**: cheaply');")" \
  '{"1":true,"2":null,"3":true,"4":null,"5":false}'
check "an unnamed ADR fails criterion 4" \
  "$(t01 "md = md.replace(/ADR 0004[^\\n]*/, 'The architecture decision applies.');")" \
  '{"1":true,"2":null,"3":true,"4":false,"5":true}'

# --- a run already over budget must say so, not keep drawing -----------------------------------
# Failures only accumulate, so once the count exceeds the budget no sequence of remaining draws
# can recover it. Without this, task 01 sat at 4 failures against a budget of 2 with 80 draws
# left -- about seven quota windows -- to confirm an outcome the arithmetic had already fixed.
over() { j "
  const tasks = { '01': [] };
  for (let i = 0; i < $1; i++) tasks['01'].push({ index: i, dimensions: { S1: i >= $2 } });
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: $1 }), { scope: 'task01' });
  process.stdout.write([c.cannotCertify, c.failures, c.maxFailures].join('|'));
"; }
check "3 failures against a budget of 2 is unrecoverable"  "$(over 10 3)" "true|3|2"
check "2 failures against a budget of 2 is still open"     "$(over 10 2)" "false|2|2"
check "0 failures is still open"                           "$(over 10 0)" "false|0|2"

# --- the agent timeout must clear the observed spread ------------------------------------------
# A timeout is the most expensive possible outcome: the run is fully paid for and nothing is
# recorded. 900s cost a draw when observed runs already reached 13 minutes.
check "the agent timeout leaves headroom over the observed 13-minute maximum" \
  "$(j "
    const fs = await import('node:fs');
    const src = fs.readFileSync('$ROOT/tests/evals/lib/install.mjs','utf8');
    const m = src.match(/timeoutMs = ([0-9_]+)/);
    process.stdout.write(String(Number(m[1].replace(/_/g,'')) >= 1500000));
  ")" "true"

# --- scoped certification: a smaller gate is a WEAKER gate, and says so ------------------------
# Budgets are DERIVED per scope from the same binomial analysis as the 260-draw gate, not scaled
# by hand: proportional scaling gives 1.9 for 100 draws and the nearest integer is the wrong one.
sc() { j "
  const tasks = { '01': [] };
  for (let i = 0; i < $2; i++) tasks['01'].push({ index: i, dimensions: { S1: i >= $3, S2: true, S3: true, S6: true, S7: true } });
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: $2 }), { scope: '$1' });
  process.stdout.write([c.certified, c.failures, c.draws, c.maxFailures, c.requiredDraws].join('|'));
"; }
check "task01 scope: 100 draws, 2 failures certifies (at the bar)" "$(sc task01 20 2)" "true|2|100|2|100"
check "task01 scope: 3 failures does NOT certify"                  "$(sc task01 20 3)" "false|3|100|2|100"
check "the full scope still needs 260 draws"                       "$(sc full 20 0)"   "false|0|100|5|260"
check "power is reported for the scope in use" \
  "$(j "const c = M.certify({tasks:{}}, {scope:'task01'}); process.stdout.write(c.powerGood + '/' + c.powerSoft)")" "0.921/0.118"
# The derived budgets, pinned. If someone edits SCOPES, the analysis behind it must be redone --
# these numbers are not preferences.
check "derived budgets are 5/260 and 2/100" \
  "$(j "process.stdout.write([M.SCOPES.full.maxFailures, M.SCOPES.full.draws, M.SCOPES.task01.maxFailures, M.SCOPES.task01.draws].join('/'))")" "5/260/2/100"

# --- a malformed judge reply must not discard the agent run that preceded it -------------------
# Observed once in three runs: the judge returned unparseable JSON and a ~12-minute agent run was
# thrown away. At ~90% of a usage cap per batch that is not affordable. Only a PARSE failure is
# retried -- a quota outage is not, since the next call fails identically and burns budget proving
# it. Asserted on the classifier, not by spawning a CLI.
mal() { j "process.stdout.write(String(/not valid JSON|no JSON object|no criteria array|malformed criterion/.test('$1')))"; }
check "an unparseable reply is retryable"        "$(mal 'judge reply is not valid JSON: x')" "true"
check "a missing criteria array is retryable"    "$(mal 'judge reply has no criteria array')" "true"
check "a quota outage is NOT retryable"          "$(mal 'quota exhausted')"                   "false"
check "a generic exit is NOT retryable"          "$(mal 'judge exited 1')"                    "false"

# --- rescore reads the CURRENT scorer, not the pinned one --------------------------------------
# Two sources, and conflating them makes rescore silently do nothing. The DEFINITION SET is pinned
# by the sha (that is what was measured); the TASK SPEC is the SCORER, and the whole reason to
# rescore is that the scorer changed. Passing the pinned worktree for both re-judges against the
# criterion you just replaced and reports "unchanged" for every shard -- which is what the first
# attempt did, convincingly and wrongly.
check "rescoreShards defaults its spec source to the repo, not a pinned tree" \
  "$(j "process.stdout.write(String(M.rescoreShards.length))")" "1"

# --- quota outages are named, not lumped into a generic exit code ------------------------------
# Both the agent path and the judge path must recognise an exhausted limit. Without it a rescore
# burned four consecutive judge calls against a dead quota and reported four indistinguishable
# `judge exited 1` errors -- the caller could not tell "wait and retry" from "malformed reply".
check "a quota message in judge output is classified as quota" \
  "$(j "
    const S = await import('$ROOT/tests/evals/lib/score.mjs');
    // parseVerdict is the non-error path; the quota branch lives in judge()'s spawn handling, so
    // assert the DETECTOR shape the branch uses rather than spawning a real CLI.
    const out = 'You\\'ve hit your session limit · resets 7:30pm';
    process.stdout.write(String(/session limit|rate limit|usage limit|quota/i.test(out)));
  ")" "true"
check "an ordinary judge failure is NOT classified as quota" \
  "$(j "process.stdout.write(String(/session limit|rate limit|usage limit|quota/i.test('SyntaxError: unexpected token')))")" "false"

# --- certification cannot pass on a partial run ------------------------------------------------
# It printed `certified: true` on 25 draws by reading 3 raw failures against a budget defined for
# 260 -- a rate projecting to ~31 failures, six times over. The vacuous-pass class again, this
# time in the check that decides whether every other check passed.
partial=$( j "
  const tasks = { '01': [] };
  for (let i = 0; i < 5; i++) tasks['01'].push({ index: i, dimensions: { S1: i < 2, S2: true } });
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: 5 }));
  process.stdout.write([c.certified, c.onTrack, c.projectedFailures, c.sufficientDraws].join('|'));
")
check "a partial run cannot certify, and reports its projection" "$partial" "false|false|78|false"

# --- npm test must not invoke this runner ------------------------------------------------------
# Structural, per phase 3's exit criteria: a `node --check` glob merely NAMING the directory is
# explicitly permitted; what is forbidden is executing it.
# Scoped to what `npm test` reaches. package.json's eval:behavioral script references the runner
# ON PURPOSE -- that is the escape hatch. The full invariant (packaging + hermeticity) is owned by
# tests/scripts/evals-packaging.sh; this is the narrow version, kept here so 3.4a's own guard
# fails if someone wires the runner into validate.sh.
if grep -nE '(node|bash)[^|]*tests/evals/run\.mjs' scripts/validate.sh >/dev/null 2>&1; then
  bad "validate.sh does not execute the eval runner"
else
  ok "validate.sh does not execute the eval runner"
fi

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
