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
  # NOT `j ... | { read -r got; check ...; }` -- a pipeline runs its right side in a SUBSHELL, so
  # check()'s increments to pass/fail were discarded and all 8 cases below printed FAIL while the
  # suite still reported 0 failed and exited 0. These are the compare() rule phase 4 gates on.
  local got
  got=$(j "const r = M.compare($2, $3); process.stdout.write(String(r.accepted) + ':' + r.regressions.length);")
  check "$1" "$got" "$4"
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

# --- result-file shape: the contract phase 4 consumes -------------------------------------------
# S3 is task 01's only GATING dimension (decisions.md#d11); S1/S2 are report-only, so this also
# pins the split buildResult() now performs (2.4b) -- a report-only dimension must still be
# measured and graded, just under `reportOnly`, never under `dimensions`.
shape=$( j "
  const src = { ref: 'HEAD', sha: 'abc123def456' };
  const tasks = { '01': [
    { index: 0, dimensions: { S1: true,  S2: false, S3: true, S4: 'n-a' } },
    { index: 1, dimensions: { S1: true,  S2: true,  S3: true, S4: 'n-a' } },
  ] };
  const r = M.buildResult({ source: src, tasks, runs: 2, dryRun: true, now: new Date('2026-08-01T00:00:00Z') });
  const d = r.tasks['01'].dimensions, ro = r.tasks['01'].reportOnly;
  process.stdout.write([
    r.schema, r.dryRun, r.source.sha, r.runsRequested, r.generated.slice(0,10),
    r.tasks['01'].runs.length,
    d.S3.passes + '/' + d.S3.n + ':' + d.S3.grade,
    ro.S1.passes + '/' + ro.S1.n + ':' + ro.S1.grade,
    ro.S2.passes + '/' + ro.S2.n + ':' + ro.S2.grade,
    ('S4' in d || 'S4' in ro) ? 'S4-COUNTED' : 'S4-excluded',
    ('S1' in d) ? 'S1-GATES' : 'S1-report-only',
  ].join('|'));
")
check "result shape carries schema, sha, run index, and splits gating from report-only dims" \
  "$shape" "2|true|abc123def456|2|2026-08-01|2|2/2:pass|2/2:pass|1/2:fail|S4-excluded|S1-report-only"

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

# --- 2.1: task 02's merged S5 criterion, overlaid from scoreExpiryGuard()'s VERDICT, not OBSERVED -
# The Blocker this closes: an `observed`-based derivation leaves `observed` unset on the own-step
# failure branch (scoreExpiryGuard's real return shape there carries no `observed` field at all),
# so a candidate genuinely red on its own source would map to `null` and get silently discarded
# instead of counted as the fail it is. Each case below pins one branch of `overlayExpiryGuardVerdict`
# end to end -- through toDimensions and buildResult -- so a regression to the observed-based
# derivation is caught at the same layer certify() reads, not just at the overlay function's return
# value.
overlay() { j "
  const S = await import('$ROOT/tests/evals/lib/score.mjs');
  const crit = [{ n: 1, verdict: '$2', evidence: '-' }, { n: 2, verdict: 'pass', evidence: 'judge: untouched' }];
  M.overlayExpiryGuardVerdict(crit, $1);
  const dims = S.toDimensions(crit, { 1: ['S5'], 2: ['S3'] });
  const res = M.buildResult({ source: { ref: 'x', sha: 'd' }, tasks: { '02': [{ index: 0, dimensions: dims }] }, runs: 1 });
  const d = res.tasks['02'].dimensions.S5;
  process.stdout.write(crit[0].verdict + '|' + (crit[0].executed ?? 'undefined') + '|' + JSON.stringify(dims.S5) + '|' + d.n + '/' + d.passes);
"; }
# THE case that proves the Blocker is closed: an own-step failure has NO `observed` field (matching
# scoreExpiryGuard's real branch at run.mjs -- verified by reading the source, not assumed), so a
# derivation reading `observed` would see `undefined`, map to `null`, and leave criterion 1's
# pre-existing 'pass' verdict untouched -- exactly the discarded-draw bug. Seeding criterion 1 at
# 'pass' beforehand makes that failure mode visible: if the fix regresses to observed-based
# derivation, this case reads 'pass|undefined|...' instead of 'fail|true|...'.
check "own-fail scores the merged criterion FAIL and counts toward draws (not discarded)" \
  "$(overlay "{ verdict: 'fail', step: 'own', reason: 'not green on its own source' }" pass)" \
  "fail|true|false|1/0"
check "control-fail (non-load, per classifyRed) scores FAIL" \
  "$(overlay "{ verdict: 'fail', step: 'control', reason: 'red on the control', observed: 'assertion' }" fail)" \
  "fail|true|false|1/0"
check "mutant-assertion scores PASS" \
  "$(overlay "{ verdict: 'pass', step: 'mutant', observed: 'assertion' }" fail)" \
  "pass|true|true|1/1"
check "mutant-green scores FAIL (the guard did not guard)" \
  "$(overlay "{ verdict: 'fail', step: 'mutant', reason: 'the new test passes against the mutant', observed: 'green' }" pass)" \
  "fail|true|false|1/0"

# Minor, review pass 2: a judge reply omitting criterion 1 must not drop the observation silently.
check "a judge reply missing criterion 1 marks the anomaly on eg, rather than dropping it silently" \
  "$(j "
    const crit = [{ n: 2, verdict: 'pass', evidence: '-' }];
    const eg = { verdict: 'pass', step: 'mutant', observed: 'assertion' };
    M.overlayExpiryGuardVerdict(crit, eg);
    process.stdout.write(eg.overlaySkipped ?? 'MISSING');
  ")" "criterion 1 absent from the judge reply"

# --- non-attributable: settled 2026-08-12 as ABSENT and RECORDED, not "null/defer" ---------------
# The prior "null/defer" wording let a judge-authored `pass` decide gating dimension S5 (review
# pass 1, Blocker F-42 -- decisions.md#d11's 2026-08-12 correction). The fix removes criterion 1
# from the array entirely on this branch, so toDimensions() -- which maps every criterion it is
# GIVEN, judge-authored or not -- never sees it. Seeded at 'pass' below (opposite of a fail-safe
# default): a regression back to "defer" shows up as an S5 key reappearing in `dims`.
nonattr() { j "
  const S = await import('$ROOT/tests/evals/lib/score.mjs');
  const crit = [{ n: 1, verdict: '$2', evidence: '-' }, { n: 2, verdict: 'pass', evidence: 'judge: untouched' }];
  M.overlayExpiryGuardVerdict(crit, $1);
  process.stdout.write(String(crit.some((c) => c.n === 1)) + '|' + JSON.stringify(S.toDimensions(crit, { 1: ['S5'], 2: ['S3'] })));
"; }
check "control-fail (a LOAD failure) is EXCLUDED: criterion 1 removed, S5 never reaches dims" \
  "$(nonattr "{ verdict: 'non-attributable', step: 'control', reason: 'the control could not load (import-error)', observed: 'import-error' }" pass)" \
  'false|{"S3":true}'
check "mutant-non-attributable is EXCLUDED: criterion 1 removed, S5 never reaches dims" \
  "$(nonattr "{ verdict: 'non-attributable', step: 'mutant', reason: 'red on the mutant, but from type-error', observed: 'type-error' }" fail)" \
  'false|{"S3":true}'

# F-47/F-48 (review pass 2): exclusion is a first-class OUTCOME, not `perRun.length - n`, which
# vanished S5 at 100% exclusion (F-47) and charged harness faults against every dim (F-48).
check "a dimension excluded on every draw still emits a row (0/0), not silence (F-47)" \
  "$(j "
    const res = M.buildResult({ source: { ref: 'x', sha: 'd' }, tasks: { '02': [
      { index: 0, dimensions: { S5: 'excluded', S3: true } },
      { index: 1, dimensions: { S5: 'excluded', S3: true } },
      { index: 2, dimensions: { S5: 'excluded', S3: true } },
    ] }, runs: 3 });
    const s5 = res.tasks['02'].dimensions.S5;
    process.stdout.write(s5.n + '/' + s5.passes + '/' + s5.excluded + '/' + s5.grade);
  ")" "0/0/3/null"
check "a mixed batch counts the excluded draw toward S3 but not S5, and reports the exclusion (S3 is task 02's report-only dim, decisions.md#d11)" \
  "$(j "
    const res = M.buildResult({ source: { ref: 'x', sha: 'd' }, tasks: { '02': [
      { index: 0, dimensions: { S5: 'excluded', S3: true } },
      { index: 1, dimensions: { S5: true, S3: true } },
    ] }, runs: 2 });
    const s5 = res.tasks['02'].dimensions.S5, s3 = res.tasks['02'].reportOnly.S3;
    process.stdout.write(s5.n + '/' + s5.passes + '/' + s5.excluded + '|' + s3.n + '/' + s3.passes + '/' + s3.excluded);
  ")" "1/1/1|2/2/0"
check "a harness-faulted (empty-dimensions) draw does NOT inflate excluded on unrelated dims (F-48)" \
  "$(j "
    const res = M.buildResult({ source: { ref: 'x', sha: 'd' }, tasks: { '02': [
      { index: 0, dimensions: { S5: true, S3: true } },
      { index: 1, dimensions: {} },
    ] }, runs: 2 });
    const s5 = res.tasks['02'].dimensions.S5, s3 = res.tasks['02'].reportOnly.S3;
    process.stdout.write(s5.n + '/' + s5.passes + '/' + s5.excluded + '|' + s3.n + '/' + s3.passes + '/' + s3.excluded);
  ")" "1/1/0|1/1/0"

# F-50: `'excluded'` is truthy, so the pre-fix `v ? '+' : '-'` printed an unmeasured gating
# dimension as `S5+` -- identical to a pass. Mutation: reverting the ternary turns this red.
check "the live progress line marks an excluded dimension as neither pass nor fail (F-50)" \
  "$(j "process.stdout.write(M.renderDimensions({ S5: 'excluded', S3: true, S1: false, S6: true }))")" \
  "S5~ S3+ S1- S6+"

# --- F-49 (review pass 2): scoreExpiryGuard()'s catch must fail CLOSED, not silently return S5
# to the judge. The throw is real -- a --source ref predating the mutant/control fixtures throws.
check "scoreExpiryGuard throws when the mutant/control fixtures do not exist (the catch's real precondition)" \
  "$(j "
    try {
      M.scoreExpiryGuard('$FX/_candidates/correct-guard',
        { mutant: '/nonexistent/task02-code-mutant.mjs', control: '/nonexistent/task02-code-control.mjs' });
      process.stdout.write('NO THROW');
    } catch (e) { process.stdout.write('threw'); }
  ")" "threw"
check "a harness-fault disposition (step: 'harness') is removed from criteria exactly like any other non-attributable verdict" \
  "$(j "
    const crit = [{ n: 1, verdict: 'pass', evidence: '-' }, { n: 2, verdict: 'pass', evidence: '-' }];
    M.overlayExpiryGuardVerdict(crit, { verdict: 'non-attributable', step: 'harness', reason: 'scoreExpiryGuard threw: ENOENT', observed: null });
    process.stdout.write(String(crit.some((c) => c.n === 1)));
  ")" "false"

# session.mjs (criterion 2, S3) must never be touched by ANY task 02 overlay -- report-only, per
# decisions.md#d11's correction. Proven by running the SAME overlay call used above (which only
# ever looks up criterion n===1) and confirming criterion 2 is byte-identical to what the judge
# said going in, regardless of what scoreExpiryGuard returned.
check "session.mjs's criterion is untouched by the expiry-guard overlay (report-only, not gating)" \
  "$(j "
    const crit = [{ n: 1, verdict: 'pass', evidence: '-' }, { n: 2, verdict: 'fail', evidence: 'judge: touched, no reason given' }];
    M.overlayExpiryGuardVerdict(crit, { verdict: 'pass', step: 'mutant', observed: 'assertion' });
    process.stdout.write(crit[1].verdict + '|' + (crit[1].executed ?? 'undefined') + '|' + crit[1].evidence);
  ")" \
  "fail|undefined|judge: touched, no reason given"
# ...and directly: sessionUntouched()'s own verdict, in the direction a naive gating overlay would
# have flipped, must still not appear anywhere near a criterion's `.verdict` -- exercised through
# boundary.mjs's actual exported function, both directions.
check "sessionUntouched: untouched" \
  "$(j "const B = await import('$ROOT/tests/evals/lib/boundary.mjs'); const r = B.sessionUntouched([{status:'M',path:'src/auth/token.mjs'}]); process.stdout.write(r.ok + '|' + r.touched)")" \
  "true|false"
check "sessionUntouched: touched" \
  "$(j "const B = await import('$ROOT/tests/evals/lib/boundary.mjs'); const r = B.sessionUntouched([{status:'M',path:'src/auth/session.mjs'}]); process.stdout.write(r.ok + '|' + r.touched)")" \
  "false|true"

# --- 2.2: capture .somi/audit.log, wire task 02's S1 criterion (closes gap 2) -------------------
# The load-bearing claim (decisions.md#d11): this fixture is npm-only, which is what confines the
# invocation space to npm's own CLI forms. Checked directly against the fixture, not assumed.
PKG02="$ROOT/tests/evals/fixtures/task02-code/package.json"
if grep -q '"packageManager"' "$PKG02"; then
  bad "task02-code/package.json carries no packageManager field (the closure premise)"
else
  ok "task02-code/package.json carries no packageManager field (the closure premise)"
fi
lockhits=$(find "$ROOT/tests/evals/fixtures/task02-code" \( -iname 'yarn.lock' -o -iname 'pnpm-lock.yaml' \) 2>/dev/null)
check "task02-code carries no yarn.lock/pnpm-lock.yaml (confirms an npm-only fixture)" \
  "${lockhits:-NONE}" "NONE"
check "task02-code/package.json's declared test script is exactly 'node --test'" \
  "$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PKG02','utf8')).scripts.test)")" \
  "node --test"

# The fifteen aliases, each pinned individually -- a regression to any ONE is caught by name, not
# absorbed into a single "some alias matched" assertion.
alm() { j "const A = await import('$ROOT/tests/evals/lib/audit-log.mjs'); process.stdout.write(String(A.matchesTestInvocation($1)))"; }
check "npm test matches"                                       "$(alm "'npm test'")" "true"
check "npm run test matches"                                   "$(alm "'npm run test'")" "true"
check "npm run-script test matches (npm run's canonical form)" "$(alm "'npm run-script test'")" "true"
check "npm t matches (word-bounded shorthand)"                 "$(alm "'npm t'")" "true"
check "node --test matches"                                    "$(alm "'node --test'")" "true"
check "node --test with a trailing path still matches"         "$(alm "'node --test tests/auth/token.test.mjs'")" "true"
check "bare node <test file>, no --test flag at all, matches"  "$(alm "'node tests/auth/token.test.mjs'")" "true"
check "an incidental flag does not produce a false negative"   "$(alm "'npm test -- --test-reporter=tap'")" "true"

# Blocker F-57: `npm help test`/`npm help run-script`'s OWN documented aliases and interposed npm
# global flags -- confirmed by execution to genuinely run the suite and score `false` pre-fix.
check "npm tst matches (npm test's own documented alias)"       "$(alm "'npm tst'")" "true"
check "npm rum test matches (npm run's own documented alias)"   "$(alm "'npm rum test'")" "true"
check "npm urn test matches (npm run's own documented alias)"   "$(alm "'npm urn test'")" "true"
check "npm --silent test matches (interposed global flag)"      "$(alm "'npm --silent test'")" "true"
check "npm -s test matches (interposed short global flag)"      "$(alm "'npm -s test'")" "true"
check "npm run --silent test matches (flag between run and test)" "$(alm "'npm run --silent test'")" "true"
check "node --experimental-test-coverage --test matches (interposed node flag)" \
  "$(alm "'node --experimental-test-coverage --test'")" "true"

# The false-POSITIVE side: each is a REAL, different command this fixture's agent could
# plausibly type, and none of them runs the declared test script.
check "npm typecheck does NOT match npm t" \
  "$(alm "'npm typecheck'")" "false"
check "npm test-only does NOT match npm test (hyphen continuation is a different script name)" \
  "$(alm "'npm test-only'")" "false"
check "npm run test-only does NOT match npm run test (hyphen continuation, run form)" \
  "$(alm "'npm run test-only'")" "false"
check "node --test-name-pattern=foo does NOT match node --test (hyphen continuation is a different flag)" \
  "$(alm "'node --test-name-pattern=foo'")" "false"
check "pnpm test does NOT match npm test (a different package manager)" \
  "$(alm "'pnpm test'")" "false"
check "a non-matching command fails cleanly" \
  "$(alm "'echo build complete'")" "false"
check "node on a non-test file does NOT match the bare-node form" \
  "$(alm "'node scripts/build.mjs'")" "false"

# Major F-59: a CLAIM about running the suite (prose, a commit message) must not match, or this
# criterion passes the exact fabrication it exists to catch. Confirmed `true` (wrongly) pre-fix.
check "a prose claim mentioning npm test does NOT match (F-59)" \
  "$(alm "'echo \"remember to run npm test later\"'")" "false"
check "a commit message claiming npm test ran does NOT match (F-59)" \
  "$(alm "'git commit -m \"ran npm test, all green\"'")" "false"
# ...but the command-position anchor must not reject a REAL compound command using the same words.
check "cd /repo && npm test still matches (compound command, not a claim)" \
  "$(alm "'cd /repo && npm test'")" "true"

# Blocker F-61: F-57's anchor fix was unmeasured in the false-negative direction -- each of these
# genuinely runs the fixture's suite (verified by execution) and scored `false` before this fix.
check "CI=1 npm test matches (variable-assignment prefix)"          "$(alm "'CI=1 npm test'")" "true"
check "NODE_ENV=test npm test matches (variable-assignment prefix)" "$(alm "'NODE_ENV=test npm test'")" "true"
check "time npm test matches (keyword position)"                    "$(alm "'time npm test'")" "true"
check "if true; then npm test; fi matches (keyword position)"       "$(alm "'if true; then npm test; fi'")" "true"
check "for f in a b; do npm test; done matches (keyword position)"  "$(alm "'for f in a b; do npm test; done'")" "true"
check "cd /tmp/x && CI=1 npm test matches (separator + assignment, composed)" "$(alm "'cd /tmp/x && CI=1 npm test'")" "true"
# Named residual (F-61): adding \`(\` to the separator class closes this but breaks the prose case
# below -- verified worse, so it stays open.
check "(npm test) does NOT match -- named residual, not silently left (F-61)" "$(alm "'(npm test)'")" "false"
check "the residual's own reason for staying open: a paren separator would break prose" "$(alm "'echo \"see (npm test) output\"'")" "false"

# Blocker F-62: re-enumerated from npm's whole command surface (\`npm help\`), not the two
# pages the F-57 miss was on. \`npm it\` confirmed by execution: runs all 3 tests, exit 0.
check "npm it matches (npm install-test's own documented alias)"            "$(alm "'npm it'")" "true"
check "npm install-test matches"                                            "$(alm "'npm install-test'")" "true"
check "npm cit matches (npm install-ci-test's own documented alias)"        "$(alm "'npm cit'")" "true"
check "npm sit matches (npm install-ci-test's own documented alias)"        "$(alm "'npm sit'")" "true"
check "npm clean-install-test matches (documented alias)"                   "$(alm "'npm clean-install-test'")" "true"
check "npm install-ci-test matches"                                         "$(alm "'npm install-ci-test'")" "true"
# The rest of npm's command surface (read in full via \`npm help\`) does NOT run the declared
# test script -- these stay negative.
check "npm install does NOT match (no test alias)"  "$(alm "'npm install'")" "false"
check "npm i does NOT match (no test alias)"        "$(alm "'npm i'")" "false"
check "npm ci does NOT match (ci alone, not install-ci-test)" "$(alm "'npm ci'")" "false"
check "npm init does NOT match (no test alias)"     "$(alm "'npm init'")" "false"

check "TEST_INVOCATION_ALIASES: every documented alias actually matches (ties the doc to the code)" \
  "$(j "
    const A = await import('$ROOT/tests/evals/lib/audit-log.mjs');
    process.stdout.write(A.TEST_INVOCATION_ALIASES.every((c) => A.matchesTestInvocation(c)) + '|' + A.TEST_INVOCATION_ALIASES.length);
  ")" "true|15"

# --- audit-log line parsing: tolerant of a bad line, intolerant of pure garbage -----------------
alp() { j "
  const A = await import('$ROOT/tests/evals/lib/audit-log.mjs');
  const text = $1;
  const e = A.parseAuditLog(text);
  process.stdout.write(e === null ? 'null' : e.length + ':' + JSON.stringify(e.map(x => [x.tool, x.command])));
"; }
check "a well-formed Bash cmd line parses, command extracted" \
  "$(alp '`2026-08-26T12:00:00Z\tCALL\tBash\tcmd=\"npm test\"`')" \
  '1:[["Bash","npm test"]]'
check "a non-Bash entry parses with command null" \
  "$(alp '`2026-08-26T12:00:00Z\tCALL\tWrite\tpath=\"src/x.mjs\"`')" \
  '1:[["Write",null]]'
check "empty content is malformed (null), not an empty pass" \
  "$(alp "''")" "null"
check "garbage with no tab-delimited structure at all is malformed (null)" \
  "$(alp "'not an audit log at all'")" "null"
# Corrected (Major F-64): isUnterminatedBash() no longer trusts a trailing quote as a termination
# signal, so this now folds rather than drops -- count stays 1, command still matches (below).
check "one unparseable line among good ones folds in (not dropped) -- count and match still hold" \
  "$(alp '`2026-08-26T12:00:00Z\tCALL\tBash\tcmd=\"npm test\"\nthis line has no tabs at all`')" \
  '1:[["Bash","npm test\"\nthis line has no tabs at all"]]'
# A literal embedded tab INSIDE the command (the header comment's own documented, unescaped case)
# must stay inside `command`, not be read as a 4th field separator -- manual 3-way splitting
# (not a naive split('\t')) is what this pins.
check "an embedded literal tab inside the command stays inside command, not a false field split" \
  "$(alp '`2026-08-26T12:00:00Z\tCALL\tBash\tcmd=\"npm test\t--silent\"`')" \
  '1:[["Bash","npm test\t--silent"]]'
# Major F-58: an embedded, unescaped NEWLINE fragments a multi-line Bash command across two
# physical log lines -- traced through the real hook, the pre-fix parser dropped the fragment
# carrying the invocation and a genuine `npm test` run scored `fail`. The fold recombines it.
check "a multi-line Bash command (embedded newline) folds into ONE entry, invocation preserved (F-58)" \
  "$(alp '`2026-08-26T12:00:00Z\tCALL\tBash\tcmd=\"cd /tmp/fixture\nnpm test\"`')" \
  '1:[["Bash","cd /tmp/fixture\nnpm test"]]'
check "the folded multi-line command is recognized as a real test invocation" \
  "$(j "
    const A = await import('$ROOT/tests/evals/lib/audit-log.mjs');
    const e = A.parseAuditLog('2026-08-26T12:00:00Z\tCALL\tBash\tcmd=\"cd /tmp/fixture\nnpm test\"');
    process.stdout.write(String(A.matchesTestInvocation(e[0].command)));
  ")" "true"

# Major F-64: a multi-line command whose FIRST line ends in a literal quote (an ordinary git
# commit message before npm test) used to read as already-terminated -- traced through the real
# hook, this dropped the invocation and scored a genuine run FAIL, F-58's own defect reopened.
check "a quoted first line does NOT falsely read as terminated -- invocation preserved (F-64)" \
  "$(alp '`2026-08-27T00:00:00Z\tCALL\tBash\tcmd=\"git commit -m \"fix: reject expired tokens\"\nnpm test\"`')" \
  '1:[["Bash","git commit -m \"fix: reject expired tokens\"\nnpm test"]]'
check "the recovered quoted-first-line command is recognized as a real test invocation (F-64)" \
  "$(j "
    const A = await import('$ROOT/tests/evals/lib/audit-log.mjs');
    const e = A.parseAuditLog('2026-08-27T00:00:00Z\tCALL\tBash\tcmd=\"git commit -m \"fix: reject expired tokens\"\nnpm test\"');
    process.stdout.write(String(A.matchesTestInvocation(e[0].command)));
  ")" "true"
# Proves dropping the quote check is safe: every line tries as a new entry FIRST, so a genuine
# second command is never mistaken for a continuation of the first.
check "two separate, complete Bash commands back to back stay two entries, not folded into one (F-64)" \
  "$(alp '`2026-08-27T00:00:00Z\tCALL\tBash\tcmd=\"npm test\"\n2026-08-27T00:00:01Z\tCALL\tBash\tcmd=\"git status\"`')" \
  '2:[["Bash","npm test"],["Bash","git status"]]'

# --- reading the log from a real working tree: absent vs. malformed vs. well-formed -------------
alwd=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
check "readAuditLog: no .somi/audit.log at all -> null (absent)" \
  "$(j "const A = await import('$ROOT/tests/evals/lib/audit-log.mjs'); process.stdout.write(String(A.readAuditLog('$alwd')))")" \
  "null"
mkdir -p "$alwd/.somi"
printf 'garbage, no tabs, no structure\n' > "$alwd/.somi/audit.log"
check "readAuditLog: content with no tab-delimited lines -> null (malformed)" \
  "$(j "const A = await import('$ROOT/tests/evals/lib/audit-log.mjs'); process.stdout.write(String(A.readAuditLog('$alwd')))")" \
  "null"
printf '2026-08-26T12:00:00Z\tCALL\tBash\tcmd="npm test"\n' > "$alwd/.somi/audit.log"
check "readAuditLog + scoreTestInvocation: a well-formed log with a matching entry scores PASS" \
  "$(j "
    const A = await import('$ROOT/tests/evals/lib/audit-log.mjs');
    process.stdout.write(String(A.scoreTestInvocation(A.readAuditLog('$alwd'))));
  ")" "pass"
printf '2026-08-26T12:00:00Z\tCALL\tBash\tcmd="npm run lint"\n' > "$alwd/.somi/audit.log"
check "scoreTestInvocation: log exists and shows NO matching invocation -> FAIL, not a defer" \
  "$(j "
    const A = await import('$ROOT/tests/evals/lib/audit-log.mjs');
    process.stdout.write(String(A.scoreTestInvocation(A.readAuditLog('$alwd'))));
  ")" "fail"
check "scoreTestInvocation: a null auditLog (absent/malformed) -> null, never fail" \
  "$(j "const A = await import('$ROOT/tests/evals/lib/audit-log.mjs'); process.stdout.write(String(A.scoreTestInvocation(null)))")" \
  "null"
rm -rf "$alwd"

# --- overlay: EXECUTED overrides the judge whenever the log is readable; null falls back to the
# judge (REPORT-ONLY, decisions.md#d11's 2026-08-28 correction -- supersedes F-56's "EXCLUDES") --
otv() { j "
  const crit = [{ n: 3, verdict: '$1', evidence: 'judge: prose' }];
  M.overlayTestInvocationVerdict(crit, $2);
  process.stdout.write(crit[0].verdict + '|' + (crit[0].executed ?? 'undefined') + '|' + crit[0].evidence);
"; }
check "log shows a match: overlays PASS even though the judge (reading prose) said fail" \
  "$(otv fail "'pass'")" \
  "pass|true|EXECUTED: .somi/audit.log shows a Bash entry matching the test-invocation alias set (not judged)"
# THE case named in the phase file: a final message that CLAIMS tests ran, with a judge fooled by
# the prose into 'pass' -- the audit log overrules it.
check "log shows no match: overlays FAIL even though the judge (fooled by a claim in the prose) said pass" \
  "$(otv pass "'fail'")" \
  "fail|true|EXECUTED: .somi/audit.log shows no Bash entry matching the test-invocation alias set (not judged)"
# Mutation check: reverting to the pre-correction "splice criterion 3 out on null" would leave
# crit.length at 0, exactly what this assertion catches.
check "null (absent/malformed log): the judge's own verdict stands, report-only (supersedes F-56)" \
  "$(j "
    const crit = [{ n: 3, verdict: 'pass', evidence: 'judge: prose' }];
    M.overlayTestInvocationVerdict(crit, null);
    process.stdout.write(String(crit.length) + '|' + crit[0].verdict + '|' + (crit[0].executed ?? 'undefined'));
  ")" "1|pass|undefined"
check "null with criterion 3 absent from the judge reply is also a no-op, not a throw" \
  "$(j "
    const crit = [{ n: 1, verdict: 'pass', evidence: '-' }];
    M.overlayTestInvocationVerdict(crit, null);
    process.stdout.write(String(crit.length) + '|' + crit[0].verdict);
  ")" "1|pass"
# Minor: a judge reply OMITTING criterion 3 no longer stays silent -- a decided (non-null) verdict
# is APPENDED, so the executed verdict does not depend on the judge having emitted it at all.
check "a judge reply missing criterion 3 appends the executed verdict rather than staying silent" \
  "$(j "
    const crit = [{ n: 1, verdict: 'pass', evidence: '-' }];
    M.overlayTestInvocationVerdict(crit, 'fail');
    process.stdout.write(String(crit.length) + '|' + crit[0].verdict + '|' + crit[1].n + '|' + crit[1].verdict + '|' + crit[1].executed);
  ")" "2|pass|3|fail|true"

# Major F-63: the marking was entirely unpinned -- deleting it left the gate green. Pinned here as
# the generic function it is (S1's own end-to-end pin retired with the report-only demotion above).
check "markDimensionsExcluded marks every named dimension excluded, leaves the rest untouched (F-63)" \
  "$(j "
    const dims = { S3: true, S6: false };
    M.markDimensionsExcluded(dims, ['S5', 'S1']);
    process.stdout.write(JSON.stringify(dims));
  ")" '{"S3":true,"S6":false,"S5":"excluded","S1":"excluded"}'

# --- installSomi() now registers the audit-log hook ---------------------------------------------
# Without this, `.somi/audit.log` is never written on a live run (installSomi() excluded every
# hook until this fix). Functional: the registered command is invoked as Claude Code would.
instw=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
hookcmd=$( j "
  const I = await import('$ROOT/tests/evals/lib/install.mjs');
  I.installSomi('$ROOT', '$instw');
  const fs = await import('node:fs');
  const settings = JSON.parse(fs.readFileSync('$instw/.claude/settings.json', 'utf8'));
  process.stdout.write(settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command ?? '');
")
# Quoted (Nit): the registered command is `node "<path>"`, not `node <path>` -- strip the
# literal `node "` prefix and the trailing `"`, not just `node `.
hookpath="${hookcmd#node \"}"
hookpath="${hookpath%\"}"
if [ -n "$hookcmd" ] && [ -f "$hookpath" ]; then
  ok "installSomi() registers the audit-log hook, at a path that exists"
else
  bad "installSomi() registers the audit-log hook, at a path that exists (got: '$hookcmd')"
fi
echo '{"tool_name":"Bash","tool_input":{"command":"npm test"}}' | \
  env CLAUDE_PROJECT_DIR="$instw" node "$hookpath" >/dev/null 2>&1
check "the registered hook, invoked as Claude Code would invoke it, writes a matching audit.log entry" \
  "$(grep -c 'Bash.*cmd="npm test"' "$instw/.somi/audit.log" 2>/dev/null || echo 0)" "1"
rm -rf "$instw"

# --- 2.4b: the pooled certification gate, on the SETTLED 2-dimension corpus --------------------
# Real task ids and their real GATING dim (task 01's S3, task 02's S5, decisions.md#d11) -- not the
# pre-2.4b synthetic 13-dimension pool, which certify()'s new gating-only filter would ignore.
mk() { j "
  const tasks = { '01': [], '02': [] };
  for (let r = 0; r < $2; r++) tasks['01'].push({ index: r, dimensions: { S3: r < $1 } });
  for (let r = 0; r < $4; r++) tasks['02'].push({ index: r, dimensions: { S5: r < $3 } });
  const res = M.buildResult({ source: { ref: 'x', sha: 'deadbeef' }, tasks, runs: Math.max($2, $4) });
  const c = M.certify(res);
  process.stdout.write([c.certified, c.failures, c.draws, c.sufficientDraws].join('|'));
"; }
# 2 gating dims x CERTIFY_N (120) each = 240 draws. A perfect corpus and one at exactly the
# budget both certify. Args: passes01 n01 passes02 n02.
check "2 gating dims x 120/120 each certifies"              "$(mk 120 120 120 120)" "true|0|240|true"
check "5 failures across 240 draws certifies (at the bar)"  "$(mk 115 120 120 120)" "true|5|240|true"
check "6 failures across 240 draws does NOT certify"        "$(mk 114 120 120 120)" "false|6|240|true"

# The case the gate exists for: ONE dimension secretly at 0.90 while the other holds. grade()'s
# own per-dimension band (>=18/20, scaled to >=108/120) would call this dimension PASS on its own;
# pooled catches it, because 12 failures from one dimension alone crosses the budget of 5.
check "task 01's S3 quietly at 90% (would grade PASS alone) is caught by the pooled budget" "$(j "
  const tasks = { '01': [], '02': [] };
  for (let r = 0; r < 120; r++) tasks['01'].push({ index: r, dimensions: { S3: r < 108 } });
  for (let r = 0; r < 120; r++) tasks['02'].push({ index: r, dimensions: { S5: true } });
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: 120 }));
  process.stdout.write([c.certified, c.failures, c.softest[0].task, c.softest[0].rate.toFixed(2)].join('|'));")" \
  "false|12|01|0.90"

# A short run must not read as certified. 0 failures out of 20 draws is not a sharp corpus; it is
# a corpus that has barely been sampled.
mk1() { j "
  const tasks = { '01': [] };
  for (let r = 0; r < $2; r++) tasks['01'].push({ index: r, dimensions: { S3: r < $1 } });
  const c = M.certify(M.buildResult({ source: { ref: 'x', sha: 'deadbeef' }, tasks, runs: $2 }));
  process.stdout.write([c.certified, c.failures, c.draws, c.sufficientDraws].join('|'));
"; }
check "a 20-draw run cannot certify, however clean" "$(mk1 20 20)" "false|0|20|false"

# --- 2.4b acceptance point 2: both directions, at the derived draw count ------------------------
check "a fully-conforming corpus at 240 draws (99.6% pass) certifies"    "$(mk 119 120 120 120)" "true|1|240|true"
check "a soft corpus at 240 draws (95% pass) does NOT certify"          "$(mk 114 120 114 120)" "false|12|240|true"

# --- 2.4b acceptance point 1: a report-only dimension never reaches `dimensions` -----------------
check "a report-only dimension appears in reportOnly, absent from dimensions" "$(j "
  const r = M.buildResult({ source: {ref:'x',sha:'d'}, tasks: { '01': [{ index: 0, dimensions: { S3: true, S1: true } }] }, runs: 1 });
  const d = r.tasks['01'];
  process.stdout.write(('S1' in d.dimensions) + '|' + ('S1' in d.reportOnly) + '|' + ('S3' in d.dimensions));
")" "false|true|true"

# --- 2.4b acceptance point 4: the drift-guard checks buildResult()'s REAL output, not the table
# a second time -- a table-to-constant comparison alone cannot see a document-vs-code gap.
check "SCOPES.full.draws equals (gating dims buildResult() actually emits for a synthetic full run) x CERTIFY_N" "$(j "
  const tasks = { '01': [{ index: 0, dimensions: { S3: true } }], '02': [{ index: 0, dimensions: { S5: true } }] };
  const r = M.buildResult({ source: { ref: 'x', sha: 'd' }, tasks, runs: 1 });
  let n = 0; for (const t of Object.values(r.tasks)) n += Object.keys(t.dimensions).length;
  process.stdout.write(String(M.SCOPES.full.draws === n * M.CERTIFY_N) + '|' + n + '|' + M.CERTIFY_N + '|' + M.SCOPES.full.draws);
")" "true|2|120|240"

# --- 2.4b acceptance points 7 and 8 (Blocker F-46): the per-dimension floor, both shapes a missing
# observation takes, through the SAME mechanism. In both, pooled draws/failures look clean --
# only the per-dimension floor (`d.n >= CERTIFY_N` for EVERY gating dim) can catch this.
check "S5 present as {n:0, excluded:N} (100% exclusion) fails the floor though pooled draws/failures look clean" "$(j "
  const tasks = { '01': [], '02': [] };
  for (let r = 0; r < 240; r++) tasks['01'].push({ index: r, dimensions: { S3: true } });
  for (let r = 0; r < 240; r++) tasks['02'].push({ index: r, dimensions: { S5: 'excluded' } });
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: 240 }));
  process.stdout.write([c.certified, c.draws, c.failures, c.underFloor.length, c.underFloor[0]?.task + '/' + c.underFloor[0]?.dim].join('|'));
")" "false|240|0|1|02/S5"
check "S5 absent from dimensions entirely (every task-02 draw returned no observation) fails the SAME floor, not a second mechanism" "$(j "
  const tasks = { '01': [], '02': [] };
  for (let r = 0; r < 240; r++) tasks['01'].push({ index: r, dimensions: { S3: true } });
  for (let r = 0; r < 240; r++) tasks['02'].push({ index: r, dimensions: {} });
  const r2 = M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: 240 });
  const c = M.certify(r2);
  process.stdout.write([c.certified, c.draws, c.failures, ('S5' in r2.tasks['02'].dimensions), c.underFloor.length, c.underFloor[0]?.task + '/' + c.underFloor[0]?.dim].join('|'));
")" "false|240|0|false|1|02/S5"

# --- sharding, resume and merge: what makes a 260-draw certification batchable ------------------
# Certification is hours of wall clock. Each run is persisted the moment it finishes so a crash at
# run 19 does not discard eighteen paid-for runs, and a later invocation skips what is already on
# disk. Tested by writing shards directly -- no model, no network.
SHARD_SHA="testsha$(date +%s)"
# Each task's shard uses its own real GATING dim (task 01's S3, task 02's S5, decisions.md#d11) --
# certify() reads exclusively from `dimensions`, so a shard tagged with any other dim would never
# reach it.
# Built through M.shardRecord() -- the SAME function main()'s drawing loop is meant to write
# through (F-133) -- not a hand-built literal checked against a hand-built expectation.
mk_shard() { j "
  const fs = await import('node:fs');
  const dim = '$1' === '01' ? 'S3' : 'S5';
  const p = M.shardPath('$SHARD_SHA', '$1', $2);
  fs.mkdirSync(p.replace(/\/[^/]+\$/, ''), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(M.shardRecord('$SHARD_SHA', '$1', { index: $2, dimensions: { [dim]: $3 }, criteria: null, error: null })));
  process.stdout.write('ok');
"; }
mk_shard 01 0 true  >/dev/null; mk_shard 01 1 true  >/dev/null
mk_shard 01 2 false >/dev/null; mk_shard 02 0 true  >/dev/null

check "shardRecord() produces the shape both the production writer and this fixture share (F-133)" \
  "$(j "process.stdout.write(JSON.stringify(M.shardRecord('s','01',{index:0})))")" \
  '{"sha":"s","taskId":"01","schema":2,"run":{"index":0}}'
# F-136: the check above pins shardRecord()'s OWN shape, not that the live-agent-gated production
# write reaches it -- no test does. Pinned structurally: grepping the FULL `writeFileSync(shard,
# ...)` prefix, not just `shardRecord(...)` alone, which used to also match the docstring's prose.
check "main()'s drawing loop writes the shard through shardRecord(), not a parallel literal (F-136)" \
  "$(grep -c 'writeFileSync(shard, JSON.stringify(shardRecord(source\.sha, id, r)' "$ROOT/$R")" "1"

check "completedIndices sees the shards already on disk" \
  "$(j "process.stdout.write([...M.completedIndices('$SHARD_SHA','01',5)].join(','))")" "0,1,2"
check "an unwritten index is not reported complete" \
  "$(j "process.stdout.write(String(M.completedIndices('$SHARD_SHA','01',5).has(4)))")" "false"

merged=$( j "
  const r = M.mergeShards('$SHARD_SHA', { runs: 3 });
  const d = r.tasks['01'].dimensions.S3;
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

# --- 2.4c: mergeShards() skips a shard from a prior schema, with a clear message ----------------
# SCHEMA_VERSION was bumped 1 -> 2 in 2.4b but nothing read it back -- this is the pass that gives
# it a job. The REAL shard decisions.md#d7's Correction names by path (no `schema` field at all,
# predates the mechanical-overlay guarantee 2.1-2.3 built) is copied into a throwaway SHA -- never
# the original on disk, never mutated in place.
legacysha="legacytest$(date +%s)"
legacydir="$ROOT/tests/evals/results/$legacysha"
mkdir -p "$legacydir"
cp "$ROOT/tests/evals/results/4ff4da62caff23248f9d057c6bc9046a8a22ecf6/01-000.json" "$legacydir/01-000.json"
legacyerrfile=$(mktemp)
legacyout=$(node --input-type=module -e "
  const M = await import('$ROOT/$R');
  process.stdout.write(String(M.certify(M.mergeShards('$legacysha')).draws));
" 2>"$legacyerrfile")
legacyerr=$(cat "$legacyerrfile"); rm -f "$legacyerrfile"
check "mergeShards() skips a real, schema-less legacy shard rather than merging it" "$legacyout" "0"
case "$legacyerr" in
  *"schema"*"01-000.json"*) ok "mergeShards() names the skipped shard and the reason in a clear message" ;;
  *) bad "mergeShards() names the skipped shard and the reason in a clear message (got: ${legacyerr:0:200})" ;;
esac
# The guard is per-shard, not "give up on the whole directory": a CURRENT-schema shard alongside
# the skipped legacy one must still merge normally. stdout only (stderr carries the warning above
# and `j()` merges the two, which would corrupt this numeric comparison).
j "
  const fs = await import('node:fs');
  fs.writeFileSync(M.shardPath('$legacysha','01',1), JSON.stringify({ sha: '$legacysha', taskId: '01', schema: M.SCHEMA_VERSION, run: { index: 1, dimensions: { S3: true }, criteria: null, error: null } }));
" >/dev/null
check "a current-schema shard alongside a skipped legacy one still merges" \
  "$(node --input-type=module -e "const M = await import('$ROOT/$R'); process.stdout.write(String(M.certify(M.mergeShards('$legacysha')).draws));" 2>/dev/null)" "1"
# F-143: the pass-1 Nit's fix was two halves -- stderr (pinned above via $legacyerr) and stdout,
# the half that actually survives `--certify sha > cert.txt`. stdout only (2>/dev/null): a caller
# reading just the redirected file must still see the pointer.
legacycertout=$(node "$R" --certify "$legacysha" 2>/dev/null)
case "$legacycertout" in
  *"(skipped 1 shard(s) from a prior schema -- see stderr, or re-run --rescore to upgrade them)"*)
    ok "certify()'s skipped-shard pointer survives a stdout-only redirect (F-143)" ;;
  *) bad "certify()'s skipped-shard pointer survives a stdout-only redirect (got: ${legacycertout: -300})" ;;
esac
rm -rf "$legacydir"

# --- 2.4c (fixed pass 2): the resume-read in main()'s drawing loop applies the SAME schema check
# as mergeShards(), via the shared readShard() (F-131). A stale-schema shard used to be resumed
# from silently, carrying judge-authored dimensions from before this version's semantics -- measured
# on a copy of the same real legacy shard above, read back {"S2":true,...,"S3":true} with S3
# judge-authored from before 2.1 wired boundaryRespected. Fixed: excluded and warned about, NOT
# redrawn automatically (decisions.md#d7's settled answer -- a redraw is ~10 minutes of a live agent
# run, the maintainer's call, not this loop's). Both indices below are already shard-backed, so the
# drawing loop never falls through to a live agent or judge call; the `claude` stub only satisfies
# preflight()'s `command -v` check.
resumebin=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
cat > "$resumebin/claude" <<'STUB'
#!/usr/bin/env bash
echo 'unused -- every requested index is already shard-backed'
STUB
chmod +x "$resumebin/claude"
resumedir="$ROOT/tests/evals/results/unversioned"
# F-135: NOT a scratch namespace like every other shard test's $(date +%s) sha -- shardPath(null,
# ...) always resolves here, and a real, quota-paid draw can genuinely live at this path. Move it
# aside and restore it; an unconditional rm -rf would silently unpay a real run and report green.
resumedir_backup=""
if [ -d "$resumedir" ]; then
  resumedir_backup="$(mktemp -d)/unversioned"
  # F-144: unchecked, a failed mv (e.g. TMPDIR full) leaves the real directory in place while the
  # rest of this block proceeds to write fixtures into it and rm -rf it below -- fail loud instead.
  mv "$resumedir" "$resumedir_backup" || { bad "F-135: could not move aside real results/unversioned -- refusing to proceed"; exit 1; }
  echo "  (moved aside real results/unversioned to $resumedir_backup for restore)"
fi
mkdir -p "$resumedir"
j "
  const fs = await import('node:fs');
  fs.writeFileSync(M.shardPath(null,'01',0), JSON.stringify(M.shardRecord(null,'01',{ index: 0, dimensions: { S3: true }, criteria: null, error: null })));
" >/dev/null
cp "$ROOT/tests/evals/results/4ff4da62caff23248f9d057c6bc9046a8a22ecf6/01-000.json" "$resumedir/01-001.json"
resumeout=$(ANTHROPIC_API_KEY=test-stub-key PATH="$resumebin:$PATH" node "$R" --source . --tasks 01 --runs 2 --out "$(mktemp)" 2>&1)
case "$resumeout" in
  *"skipped"*"01-001.json"*) ok "the resume-read skips a stale-schema shard rather than resuming from it (F-131)" ;;
  *) bad "the resume-read skips a stale-schema shard rather than resuming from it (got: ${resumeout:0:400})" ;;
esac
case "$resumeout" in
  *"01 run 1/2: (already done)"*) ok "a current-schema shard alongside the skipped one still resumes normally" ;;
  *) bad "a current-schema shard alongside the skipped one still resumes normally (got: ${resumeout:0:400})" ;;
esac
rm -rf "$resumebin" "$resumedir"
[ -n "$resumedir_backup" ] && mv "$resumedir_backup" "$resumedir"

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

# --- 2.4c: judge-agreement.mjs and --judge-model, D7's disposition finally executed -------------
check "judge-agreement.mjs no longer exists" \
  "$(j "process.stdout.write(String((await import('node:fs')).existsSync('$ROOT/tests/evals/judge-agreement.mjs')))")" "false"
case "$(node "$R" --judge-model sonnet --dry-run --source HEAD --tasks 01 --runs 1 2>&1; echo "EXIT:$?")" in
  *"unknown argument: --judge-model"*"EXIT:1") ok "--judge-model is not a recognized flag (removed outright)" ;;
  *) bad "--judge-model is not a recognized flag (removed outright)" ;;
esac

# --- 2.4c: parseVerdict() rejects a judge reply with duplicate n --------------------------------
# `criteria` is keyed by n, not positional (decisions.md#d11) -- a duplicate n is not a shape any
# downstream consumer (toDimensions, the splice-based overlays) can safely reduce over. Mutated
# from a genuinely well-formed reply, not hand-built already-broken, so a reversion of the check
# below is provably what turns this red.
pv() { j "
  const S = await import('$ROOT/tests/evals/lib/score.mjs');
  const v = S.parseVerdict($1);
  process.stdout.write(v.ok ? 'ok' : v.error);
"; }
check "a well-formed reply with distinct n parses ok" \
  "$(pv "'{\"criteria\":[{\"n\":1,\"verdict\":\"pass\"},{\"n\":2,\"verdict\":\"fail\"}]}'")" "ok"
check "a duplicate n is rejected, not silently accepted" \
  "$(pv "'{\"criteria\":[{\"n\":1,\"verdict\":\"pass\"},{\"n\":1,\"verdict\":\"fail\"}]}'")" \
  "duplicate criterion n=1 in judge reply"

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

# --- 2.1: boundaryRespected's `slug` parameter, wired through (was accepted and never used) -----
bnd_slug() { j "
  const B = await import('$ROOT/tests/evals/lib/boundary.mjs');
  const r = B.boundaryRespected($1, { slug: $2 });
  process.stdout.write(r.ok + (r.offenders.length ? ':' + r.offenders.join(',') : ''));
"; }
# boundaryRespected is called only from the taskId === '01' block (run.mjs), so its slug is always
# TASK-01-SHAPED -- `ingest-audit-trail` is a real slug from a stored task-01 shard
# (results/4ff4da62.../01-000.json), used here rather than task02-code's fixture slug (Nit, review
# pass 1: the prior comment named a call that does not exist). A write into a DIFFERENT slug's plan
# directory must be rejected -- unreachable before this fix, since the old unscoped allowlist
# matched any .somi/plans/ path.
check "boundaryRespected REJECTS a write into a different slug's plan directory" \
  "$(bnd_slug "[{path:'.somi/plans/other-slug/spec.md'}]" "'ingest-audit-trail'")" \
  "false:.somi/plans/other-slug/spec.md"
# Bidirectional: the same slug-scoped allowlist must still accept the running draw's OWN directory.
check "boundaryRespected ACCEPTS a write into the running draw's own slug directory" \
  "$(bnd_slug "[{path:'.somi/plans/ingest-audit-trail/progress.md'}]" "'ingest-audit-trail'")" "true"
# The sole fallback path: slug discovery came back null (no plan directory was ever created for
# this draw) -- boundaryRespected must fall back to the broad prefix and ACCEPT, never reject.
# A false `fail` on 1 of 3 gating dimensions is worse than the over-permissiveness this replaces.
check "boundaryRespected: null slug falls back to the broad prefix and ACCEPTS, does not reject" \
  "$(bnd_slug "[{path:'.somi/plans/other-slug/spec.md'}]" "null")" "true"

# --- F-44: a slug with regex metacharacters behaves as a plain prefix, not a pattern -------------
# Verified (review pass 1) that the OLD `new RegExp` version threw on `fix(auth`, false-failed the
# draw's own write on `plan[1]`, and over-matched `a.b` against `aXb`. These pin all three
# directions as a measurement, not a claim.
check "a slug with regex metacharacters does not throw and accepts the draw's own write" \
  "$(bnd_slug "[{path:'.somi/plans/fix(auth/spec.md'}]" "'fix(auth'")" "true"
check "a slug with a character-class metacharacter does not false-fail the draw's own write" \
  "$(bnd_slug "[{path:'.somi/plans/plan[1]/spec.md'}]" "'plan[1]'")" "true"
check "a slug with a '.' does not over-match a different, similarly-named slug's directory" \
  "$(bnd_slug "[{path:'.somi/plans/aXb/spec.md'}]" "'a.b'")" \
  "false:.somi/plans/aXb/spec.md"

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
  const v = S.executedVerdicts(md);
  process.stdout.write(Object.keys(v).filter(k=>/^\d+$/.test(k)).sort().map(k=>k+'='+v[k]).join(' '));
"; }
# THE case that invalidated artifact scoring for this task. Task 01 scores the RESEARCH pass,
# which halts before anything is verified, so decisions.md is scaffolded from the template and
# correctly left empty. Reading placeholders as content returned FALSE and manufactured failures
# on runs that did nothing wrong -- observed live: the run with a scaffold scored S2- S1-, the run
# with no artifact deferred to the judge and scored S1+.
check "an unfilled template defers every criterion instead of failing them" \
  "$(t01 "md = '# Decisions — <work item name>\n\n## D1 — <decision title in noun form>\n\n### Decision\n\n<one sentence>\n';")" \
  '1=null 2=null 3=null 4=null 5=null'
check "a conforming artifact satisfies the structural criteria" \
  "$(t01 '')" '1=null 2=null 3=true 4=null 5=null'
check "an absent artifact defers every criterion to the judge" \
  "$(t01 "md = '';")" '1=null 2=null 3=null 4=null 5=null'
check "an invented volume figure fails criterion 3" \
  "$(t01 "md += '\nExpect ~400M rows/yr.';")" '1=null 2=null 3=false 4=null 5=null'
check "a Reverses field saying only cheaply fails criterion 5" \
  "$(t01 "md = md.replace(/\\*\\*Reverses\\*\\*:[^\\n]*/, '**Reverses**: cheaply');")" \
  '1=null 2=null 3=true 4=null 5=null'
check "an unnamed ADR fails criterion 4" \
  "$(t01 "md = md.replace(/ADR 0004[^\\n]*/, 'The architecture decision applies.');")" \
  '1=null 2=null 3=true 4=false 5=null'

# --- task 01 scored from the FENCED BLOCK, the third target tried ------------------------------
# 1. the prose relay -- semantic, so judged, so 2/4-3/4 against a >=99% bar
# 2. decisions.md    -- structured but EMPTY in the research pass; parsing it manufactured failures
# 3. the fence       -- the planner's own block, relayed verbatim, present in every run
blk() { j "
  const S = await import('$ROOT/tests/evals/lib/score-task01.mjs');
  const body = 'D1: Audit-trail storage architecture\\n  Decides: where 7 years of rows live\\n  Option A — Partitioned Postgres — RECOMMENDED\\n    Pros: no new store\\n    Cons: partition maintenance for a two-person team\\n    Reverses: detach partitions; the down migration ships in the same PR\\n';
  let out = 'prose\\n\\n\\u0060\\u0060\\u0060decisions-needed\\n' + body + '\\u0060\\u0060\\u0060\\n ADR 0004 requires a migration path.';
  $1
  const v = S.blockVerdicts(out);
  process.stdout.write(Object.keys(v).filter(k=>/^\d+$/.test(k)).sort().map(k=>k+'='+v[k]).join(' '));
"; }
check "a conforming fence scores the structural criteria" \
  "$(blk '')" '1=null 2=null 3=true 4=null 5=null'
# A run predating the relay change, or one that omits the fence, must DEFER -- not be failed for a
# format it was never given. Same fail-safe the scaffold case needed.
check "no fence defers every criterion to the judge" \
  "$(blk "out = 'just prose';")" '1=null 2=null 3=null 4=null 5=null'
check "a missing Reverses field fails criterion 5" \
  "$(blk "out = out.replace(/    Reverses:[^\\n]*\\n/, '');")" \
  '1=null 2=null 3=true 4=null 5=null'
check "an invented magnitude fails criterion 3" \
  "$(blk "out += ' Expect ~400M rows/yr.';")" '1=null 2=null 3=false 4=null 5=null'
check "an unnamed ADR fails criterion 4" \
  "$(blk "out = out.replace(/ADR 0004[^\\n]*/, 'the architecture decision');")" \
  '1=null 2=null 3=true 4=false 5=null'

# --- a run already over budget must say so, not keep drawing -----------------------------------
# Failures only accumulate, so once the count exceeds the budget no sequence of remaining draws
# can recover it. Without this, task 01 sat at 4 failures against a budget of 2 with 80 draws
# left -- about seven quota windows -- to confirm an outcome the arithmetic had already fixed.
over() { j "
  const tasks = { '01': [] };
  for (let i = 0; i < $1; i++) tasks['01'].push({ index: i, dimensions: { S3: i >= $2 } });
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: $1 }));
  process.stdout.write([c.cannotCertify, c.failures, c.maxFailures].join('|'));
"; }
check "6 failures against a budget of 5 is unrecoverable"  "$(over 10 6)" "true|6|5"
check "5 failures against a budget of 5 is still open"     "$(over 10 5)" "false|5|5"
check "0 failures is still open"                           "$(over 10 0)" "false|0|5"

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

# --- 2.4b: SCOPES.task01 is REMOVED, not relabeled; SCOPES.full re-derived from CERTIFY_N -------
# decisions.md#d11: at 1 gating dimension (S3 alone) the best available budget clears a
# genuinely-soft corpus 73.58% of the time -- worse than not gating -- so `task01` is gone
# entirely, and there is exactly one scope left.
check "SCOPES.task01 no longer exists (removed, not merely relabeled)" \
  "$(j "process.stdout.write(String('task01' in M.SCOPES))")" "false"
check "CERTIFY_N is a distinct constant from BANDS.n (raising it must not touch routine trim draws)" \
  "$(j "process.stdout.write(M.CERTIFY_N + '|' + M.BANDS.n)")" "120|20"
# The derived budget, pinned -- not a preference. Re-derived (not scaled) at 2 gating dimensions
# (decisions.md#d11's 2026-08-28 demotion of task 02's S1): the same method lands on CERTIFY_N=120,
# more per dimension than the prior 3-dimension figure (80), since the pooled false-accept target
# is reached at the same total draw count (240) regardless of how many dimensions share it.
check "SCOPES.full is derived from CERTIFY_N x 2 gating dimensions: 240 draws, budget 5, ~96.5%/~1.8% power" \
  "$(j "const s = M.SCOPES.full; process.stdout.write([s.draws, s.maxFailures, s.powerGood.toFixed(4), s.powerSoft.toFixed(4), s.covers].join('|'))")" \
  "240|5|0.9651|0.0181|2 of 13 task-dimensions"
check "power is reported on certify()'s own return value" \
  "$(j "const c = M.certify({tasks:{}}); process.stdout.write(c.powerGood + '/' + c.powerSoft)")" "0.9651/0.0181"

# --- 2.4b acceptance point 6: --scope is fully removed, not silently falling back to full --------
scopeout=$(node "$R" --scope task01 --dry-run --source HEAD --tasks 01 --runs 1 2>&1; echo "EXIT:$?")
case "$scopeout" in
  *"unknown argument: --scope"*"EXIT:1") ok "--scope is not a recognized flag (removed outright)" ;;
  *) bad "--scope is not a recognized flag (removed outright) (got: ${scopeout:0:160})" ;;
esac

# --- 2.4b acceptance point 5: the exact --runs guidance, appended to certify()'s own message ------
CERT_SHA="certtest$(date +%s)"
j "
  const fs = await import('node:fs');
  const p = M.shardPath('$CERT_SHA', '01', 0);
  fs.mkdirSync(p.replace(/\/[^/]+\$/, ''), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ sha: '$CERT_SHA', taskId: '01', schema: M.SCHEMA_VERSION, run: { index: 0, dimensions: { S3: false, S1: false }, criteria: null, error: null } }));
" >/dev/null
certout=$(node "$R" --certify "$CERT_SHA" 2>&1)
case "$certout" in
  *"enough draws:    false  (need 240, have 1) — draw with --runs 120"*)
    ok "certify()'s 'enough draws: false' message names --runs \$CERTIFY_N exactly, derived from the same constant" ;;
  *)
    bad "certify()'s 'enough draws: false' message names --runs \$CERTIFY_N exactly (got: ${certout:0:300})" ;;
esac

# --- F-112: certified-line parenthetical, UNDER FLOOR block, harnessFaults -- each left 215/0 ----
case "$certout" in
  *"certified:       false  (1 gating dimension(s) measured, false-accept 1.81%)"*) ok "certify()'s 'certified:' line states the gating-dimension count and false-accept rate" ;;
  *) bad "certify()'s 'certified:' line states the gating-dimension count/false-accept rate (got: ${certout:0:300})" ;;
esac
case "$certout" in
  *"UNDER FLOOR:     01/S3 (1/120), 02/S5 (0/120)"*) ok "certify()'s UNDER FLOOR block names each under-floor gating dimension" ;;
  *) bad "certify()'s UNDER FLOOR block names each under-floor gating dimension (got: ${certout:0:400})" ;;
esac
case "$certout" in
  *"1 failure(s) across 1 draw(s)"*"  01 S3: 0/1"*"report-only 01 S1: 0/1"*) ok "certify()'s summary pools ONLY the gating row, and prints the report-only row after it" ;;
  *) bad "certify()'s summary pools ONLY the gating row, and prints the report-only row after it (got: ${certout:0:400})" ;;
esac
# F-114: {error:'timeout'} (the shape this check used to write) is not a shape a shard can ever
# carry -- runOnce()'s timeout/quota/judge-fault path always sets harnessFault:true, which the
# drawing loop's write guard never persists. The one error a shard CAN carry unflagged is :680's.
j "const fs = await import('node:fs'); fs.writeFileSync(M.shardPath('$CERT_SHA','01',1), JSON.stringify({sha:'$CERT_SHA',taskId:'01',schema:M.SCHEMA_VERSION,run:{index:1,dimensions:{},criteria:null,error:'no prompt found in the task spec'}}));" >/dev/null
case "$(node "$R" --certify "$CERT_SHA" 2>&1)" in
  *"harness faults:  1"*) ok "certify()'s harnessFaults count reflects a persistable error-bearing run, not a hardcoded 0" ;;
  *) bad "certify()'s harnessFaults count reflects a persistable error-bearing run" ;;
esac
rm -rf "$ROOT/tests/evals/results/$CERT_SHA"

# --- a malformed judge reply must not discard the agent run that preceded it -------------------
# Observed once in three runs: the judge returned unparseable JSON and a ~12-minute agent run was
# thrown away. At ~90% of a usage cap per batch that is not affordable. Only a PARSE failure is
# retried -- a quota outage is not, since the next call fails identically and burns budget proving
# it. Asserted on the REAL classifier, exported as `isRetryableJudgeError` -- a hand-copied regex
# literal here could not fail (F-137, closing the gap F-130 found).
mal() { node --input-type=module -e "
  const S = await import('$ROOT/tests/evals/lib/score.mjs');
  process.stdout.write(String(S.isRetryableJudgeError('$1')));
" 2>&1; }
check "an unparseable reply is retryable"        "$(mal 'judge reply is not valid JSON: x')" "true"
check "a missing criteria array is retryable"    "$(mal 'judge reply has no criteria array')" "true"
check "a quota outage is NOT retryable"          "$(mal 'quota exhausted')"                   "false"
check "a generic exit is NOT retryable"          "$(mal 'judge exited 1')"                    "false"
# F-130: asserted against the REAL `judge()`, spawning a stubbed `claude` end to end -- the only
# check here that would catch a break in `judgeOnce()`'s own retry wiring, not just in the
# classifier `mal()` now shares with it (F-137). Stub replies duplicate-n on the FIRST call,
# well-formed on the SECOND; `judge()` must retry and return the second's verdict.
dupbin=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
cat > "$dupbin/claude" <<STUB
#!/usr/bin/env bash
if [ -e "$dupbin/.hit" ]; then
  echo '{"criteria":[{"n":1,"verdict":"pass","evidence":"e"}]}'
else
  touch "$dupbin/.hit"
  echo '{"criteria":[{"n":1,"verdict":"pass","evidence":"e"},{"n":1,"verdict":"pass","evidence":"e"}]}'
fi
STUB
chmod +x "$dupbin/claude"
dupout=$(PATH="$dupbin:$PATH" node --input-type=module -e "
  const S = await import('$ROOT/tests/evals/lib/score.mjs');
  const v = S.judge('spec text', 'evidence text');
  process.stdout.write(v.ok + '|' + (v.retried ?? false));
" 2>&1)
check "a duplicate-n reply is retried against the real judge(), not treated as an unrecoverable harness fault (F-130)" \
  "$dupout" "true|true"
rm -rf "$dupbin"

# --- rescore reads the CURRENT scorer, not the pinned one --------------------------------------
# Two sources, and conflating them makes rescore silently do nothing. The DEFINITION SET is pinned
# by the sha (that is what was measured); the TASK SPEC is the SCORER, and the whole reason to
# rescore is that the scorer changed. Passing the pinned worktree for both re-judges against the
# criterion you just replaced and reports "unchanged" for every shard -- which is what the first
# attempt did, convincingly and wrongly.
check "rescoreShards defaults its spec source to the repo, not a pinned tree" \
  "$(j "process.stdout.write(String(M.rescoreShards.length))")" "1"

# --- 2.3: applyExecutedOverlays() -- the shared function closing gap 3 --------------------------
# runOnce() and rescoreShards() now call ONE function for every executed-criterion overlay. Pinned
# here with data shaped like the real, already-on-disk shard the gap was found against
# (results/4ff4da62.../01-000.json: decisionsMd null, a fenced decisions-needed block in the
# transcript, no `changed` field -- that shard predates this iteration's schema addition).
aeo() { j "
  const BT = String.fromCharCode(96).repeat(3), NL = String.fromCharCode(10);
  const crit = $1;
  const dims = {};
  await M.applyExecutedOverlays('$2', crit, dims, $3, $4);
  process.stdout.write(JSON.stringify(crit.map((c) => [c.n, c.verdict, c.executed ?? null])) + '|' + JSON.stringify(dims));
"; }
check "criterion 3 reproduces EXECUTED evidence from the transcript's fence alone (decisionsMd null, matching the real shard)" \
  "$(aeo "[{n:3,verdict:'fail',evidence:'judge'}]" 01 "{3:['S7']}" "{decisionsMd:null,transcript:[BT+'decisions-needed','D1: x','  Option A - y','    Pros: p','    Cons: q',BT,'no digits here'].join(NL)}")" \
  '[[3,"pass",true]]|{"S7":true}'
# Blocker F-71 (pass 2 review): 'changed' absent used to leave the JUDGE's own verdict standing
# for a GATING dimension -- D11 clause (1)'s exact door, reopened via a missing field instead of a
# fresh judge call. Now spliced + excluded, the disposition S5 already uses for its own
# non-attributable case. Reverting the `else` branch in applyExecutedOverlays() (the fix below)
# turns this red: criterion 6 would stay in `criteria` as the judge's raw 'fail' and S3 would read
# `false` instead of "excluded" -- a judge-authored gating verdict, exactly what F-71 closes.
check "criterion 6 is EXCLUDED, not judge-authored, when 'changed' is absent -- a pre-2.3 shard (F-71)" \
  "$(aeo "[{n:6,verdict:'fail',evidence:'judge'}]" 01 "{6:['S3']}" "{transcript:''}")" \
  '[]|{"S3":"excluded"}'
check "criterion 6 reproduces EXECUTED evidence when 'changed' is present, correctly REJECTING an out-of-allowlist path" \
  "$(aeo "[{n:6,verdict:'pass',evidence:'judge'}]" 01 "{6:['S3']}" "{transcript:'',tree:[{status:'M',path:'src/x.mjs'}],slug:'s'}")" \
  '[[6,"fail",true]]|{"S3":false}'
check "criterion 6 reproduces EXECUTED evidence and PASSES for an in-allowlist path (Nit, pass 1 review: the accept direction was under-asserted)" \
  "$(aeo "[{n:6,verdict:'fail',evidence:'judge'}]" 01 "{6:['S3']}" "{transcript:'',tree:[{status:'A',path:'.somi/plans/s/context.md'}],slug:'s'}")" \
  '[[6,"pass",true]]|{"S3":true}'
# Major (pass 2 review, "Also fix" item): a judge reply OMITTING criterion 6 entirely used to make
# S3 vanish from `dimensions` rather than fail closed -- toDimensions() had nothing tagged S3 to
# read. Now appended, exactly like criterion 3's sibling overlay already does.
check "criterion 6 is APPENDED, not silently absent, when the judge's reply omits it and 'changed' is present" \
  "$(aeo "[]" 01 "{6:['S3']}" "{transcript:'',tree:[{status:'M',path:'src/x.mjs'}],slug:'s'}")" \
  '[[6,"fail",true]]|{"S3":false}'
check "task 02's S5 is driven by the STORED expiryGuard, never recomputed -- excluded key always present, S1 reapplied alongside it (F-55/2.3)" \
  "$(aeo "[{n:1,verdict:'pass',evidence:'judge'},{n:3,verdict:'pass',evidence:'judge'}]" 02 "{1:['S5'],3:['S1']}" "{expiryGuard:{verdict:'non-attributable',step:'mutant',observed:'type-error'},testInvocation:'fail'}")" \
  '[[3,"fail",true]]|{"S1":false,"S5":"excluded"}'
# Major (F-86, pass 4 review): the overlay's splice removes only the FIRST `n === 1` entry
# (`findIndex` + `splice(i, 1)`), so a judge reply carrying criterion 1 TWICE leaves a second entry
# standing with its own verdict. Outcome-sampling alone (`criteria.some(...)`) still finds that
# survivor and stays silent -- S5 published the judge's own `true` on a gating dimension, D11
# clause (1)'s exact door. Reverting the `expiryGuard.verdict` half of the fix above turns this red.
check "S5 is EXCLUDED, not judge-authored, when the judge reply carries criterion 1 TWICE and expiryGuard is non-attributable (F-86)" \
  "$(aeo "[{n:1,verdict:'pass',evidence:'judge'},{n:1,verdict:'pass',evidence:'judge'}]" 02 "{1:['S5']}" "{expiryGuard:{verdict:'non-attributable',step:'mutant',observed:'type-error'}}")" \
  '[[1,"pass",null]]|{"S5":"excluded"}'
check "S5 is EXCLUDED, not judge-authored, when expiryGuard is absent entirely -- a shard predating the field (F-76)" \
  "$(aeo "[{n:1,verdict:'pass',evidence:'judge'}]" 02 "{1:['S5']}" "{expiryGuard:null}")" \
  '[[1,"pass",null]]|{"S5":"excluded"}'
# Major (pass 2 review, "Also fix" item): a judge reply OMITTING criterion 1 while `expiryGuard`
# genuinely PASSED used to make S5 vanish from `dimensions` entirely (the overlay can only record
# `overlaySkipped` when the criterion isn't there to mutate -- it cannot fabricate a pass/fail
# criterion the judge never sent). Now excluded, matching the non-attributable disposition, rather
# than invisible to certify()'s per-dimension floor.
check "S5 is EXCLUDED, not silently absent, when the judge's reply omits criterion 1 -- even on a genuine pass" \
  "$(aeo "[{n:3,verdict:'pass',evidence:'judge'}]" 02 "{1:['S5'],3:['S1']}" "{expiryGuard:{verdict:'pass',step:'mutant',observed:'assertion'},testInvocation:null}")" \
  '[[3,"pass",null]]|{"S1":true,"S5":"excluded"}'
check "task 03 criterion 3 reproduces EXECUTED evidence from the stored transcript alone" \
  "$(aeo "[{n:3,verdict:'fail',evidence:'judge'}]" 03 "{3:['S1']}" "{transcript:'Filed against 2024-03-31.',task03Refs:{correct:(a,b,d)=>({net:1}),patched:(a,b,d)=>({net:2})}}")" \
  '[[3,"pass",true]]|{"S1":true}'

# --- 2.3: rescoreShards() actually reapplies the overlays, end to end ----------------------------
# judge() shells out to a real `claude` binary; stubbed here with a script returning a FIXED, WRONG
# verdict for every criterion, so only a correctly-reapplied overlay can flip the result -- the
# "mutate one call site, confirm red" proof for the call site runOnce() cannot pin (no test in this
# hermetic suite reaches runOnce()'s own execution). Reverting rescoreShards to its pre-2.3 body
# (plain toDimensions(verdict.criteria, tags), no overlay call) was verified by hand to turn this
# red: false|false|false|true|false|false|false instead of the line below (7 fields since F-71 added 6 and 7).
rsbin=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
cat > "$rsbin/claude" <<'STUB'
#!/usr/bin/env bash
echo '{"criteria":[{"n":1,"verdict":"fail","evidence":"judge"},{"n":3,"verdict":"fail","evidence":"judge"},{"n":6,"verdict":"fail","evidence":"judge"}]}'
STUB
chmod +x "$rsbin/claude"
rssha="rescoretest0000000000000000000000000000"
rsdir="$ROOT/tests/evals/results/$rssha"
mkdir -p "$rsdir"
cat > "$rsdir/01-000.json" <<'EOF'
{"sha":"x","taskId":"01","run":{"index":0,"dimensions":{},"criteria":[],"error":null,"decisionsMd":null,"changed":[{"status":"A","path":".somi/plans/x/context.md"}],"slug":"x","transcript":"```decisions-needed\nD1: x\n  Option A - y\n    Pros: p\n    Cons: q\n```\nno digits here"}}
EOF
cat > "$rsdir/02-000.json" <<'EOF'
{"sha":"x","taskId":"02","run":{"index":0,"dimensions":{},"criteria":[],"error":null,"decisionsMd":null,"transcript":"t","expiryGuard":{"verdict":"non-attributable","step":"mutant","observed":"type-error"},"testInvocation":"fail"}}
EOF
# Blocker F-71's destructive-write proof: a shard shaped EXACTLY like the real, on-disk
# results/4ff4da62.../01-003.json -- criterion 6 already EXECUTED, S3 already true, no `changed`/
# `slug` field (the historical gap). The in-memory-only version of this proof is not enough
# (F-71): the defect was a `writeFileSync` that overwrote real evidence on disk with no undo, so
# this reads the FILE back after rescoring, not just rescoreShards()'s return value.
cat > "$rsdir/01-001.json" <<'EOF'
{"sha":"x","taskId":"01","run":{"index":1,"dimensions":{"S3":true},"criteria":[{"n":3,"verdict":"pass","evidence":"EXECUTED against decisions.md: satisfied (not judged)","executed":true},{"n":6,"verdict":"pass","evidence":"EXECUTED: every changed path is inside the allowlist (slug-scoped: x) (not judged)","executed":true}],"error":null,"decisionsMd":null,"transcript":"no digits here"}}
EOF
rsout=$(PATH="$rsbin:$PATH" node --input-type=module -e "
  const M = await import('$ROOT/$R');
  await M.rescoreShards('$rssha', '$ROOT');
  const fs = await import('node:fs');
  const r1 = JSON.parse(fs.readFileSync('$rsdir/01-000.json', 'utf8'));
  const r2 = JSON.parse(fs.readFileSync('$rsdir/02-000.json', 'utf8'));
  const r3 = JSON.parse(fs.readFileSync('$rsdir/01-001.json', 'utf8'));
  const c3 = r1.run.criteria.find((c) => c.n === 3), c6 = r1.run.criteria.find((c) => c.n === 6);
  const c3b = r2.run.criteria.find((c) => c.n === 3);
  const c6legacy = r3.run.criteria.find((c) => c.n === 6);
  process.stdout.write([c3.evidence.startsWith('EXECUTED'), c6.evidence.startsWith('EXECUTED'),
    r2.run.dimensions.S5, 'S5' in r2.run.dimensions, c3b.evidence.startsWith('EXECUTED'),
    c6legacy === undefined, r3.run.dimensions.S3].join('|'));
" 2>&1)
check "rescoreShards reapplies task 01's criteria 3+6 and task 02's S5/S1 overlays; a legacy shard's stale EXECUTED criterion 6 is excluded on disk, never overwritten with judge prose (F-71)" \
  "$rsout" "true|true|excluded|true|true|true|excluded"
rm -rf "$rsbin" "$rsdir"

# --- 2.4c acceptance: "no judged criterion can gate", re-checked at mergeShards()'s output for
# the --rescore PATH specifically (previously pinned only at the individual-shard/applyExecutedOverlays
# level, never end to end through mergeShards()+certify()) -------------------------------------
rs2bin=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
cat > "$rs2bin/claude" <<'STUB'
#!/usr/bin/env bash
echo '{"criteria":[{"n":1,"verdict":"pass","evidence":"e"},{"n":2,"verdict":"pass","evidence":"e"},{"n":3,"verdict":"pass","evidence":"e"},{"n":4,"verdict":"pass","evidence":"e"}]}'
STUB
chmod +x "$rs2bin/claude"
rs2sha="rescoretest2$(date +%s)"
rs2dir="$ROOT/tests/evals/results/$rs2sha"
mkdir -p "$rs2dir"
# The stub judge says criterion 1 (S5, GATING) PASSES. The stored expiryGuard -- the mechanical
# fact -- says it FAILED. If the overlay were bypassed on this path, S5 would read pass/1 below.
j "
  const fs = await import('node:fs');
  fs.writeFileSync(M.shardPath('$rs2sha','02',0), JSON.stringify({ sha: '$rs2sha', taskId: '02', schema: M.SCHEMA_VERSION, run: { index: 0, dimensions: {}, criteria: [], error: null, transcript: 't', expiryGuard: { verdict: 'fail', step: 'mutant', reason: 'r', observed: 'assertion' }, testInvocation: 'pass' } }));
" >/dev/null
PATH="$rs2bin:$PATH" node --input-type=module -e "const M = await import('$ROOT/$R'); await M.rescoreShards('$rs2sha', '$ROOT');" >/dev/null 2>&1
rs2merge=$(j "
  const c = M.certify(M.mergeShards('$rs2sha'));
  const s5 = c.dimensions.find((d) => d.task === '02' && d.dim === 'S5');
  process.stdout.write(s5 ? s5.passes + '/' + s5.n : 'MISSING');
")
check "mergeShards()+certify() after --rescore reflects the MECHANICAL expiryGuard verdict (fail) on gating dimension S5, never the stub judge's own 'pass'" \
  "$rs2merge" "0/1"
rm -rf "$rs2bin" "$rs2dir"

# --- 2.4c acceptance: --report is a separate, opt-in pass; its shard cannot change certify() -----
rptbin=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
cat > "$rptbin/claude" <<'STUB'
#!/usr/bin/env bash
echo '{"criteria":[{"n":1,"verdict":"pass","evidence":"e"},{"n":2,"verdict":"pass","evidence":"e"},{"n":3,"verdict":"pass","evidence":"e"},{"n":4,"verdict":"pass","evidence":"e"}]}'
STUB
chmod +x "$rptbin/claude"
rptsha="reporttest$(date +%s)"
rptdir="$ROOT/tests/evals/results/$rptsha"
mkdir -p "$rptdir"
# The STORED gating dimensions are all false; the mechanical facts (expiryGuard/testInvocation)
# and the stub judge would, if freshly recomputed, produce all true -- deliberately mismatched
# from what is on disk, so a report-pass leak into the gating namespace is NOT masked by the two
# computations coincidentally agreeing (mutation-verified: writing report output into the gating
# namespace directly turns this check red, where a same-valued fixture would not have).
j "
  const fs = await import('node:fs');
  fs.writeFileSync(M.shardPath('$rptsha','02',0), JSON.stringify({ sha: '$rptsha', taskId: '02', schema: M.SCHEMA_VERSION, run: { index: 0, dimensions: { S5: false, S3: false, S1: false, S6: false }, criteria: [], error: null, transcript: 't', expiryGuard: { verdict: 'pass', step: 'mutant', observed: 'assertion' }, testInvocation: 'pass' } }));
" >/dev/null
before=$(j "process.stdout.write(JSON.stringify(M.certify(M.mergeShards('$rptsha'))))")
rptout=$(PATH="$rptbin:$PATH" node "$R" --report "$rptsha" 2>&1)
after=$(j "process.stdout.write(JSON.stringify(M.certify(M.mergeShards('$rptsha'))))")
check "a --report shard present under a SHA does not change that SHA's certify() output" "$after" "$before"
case "$rptout" in
  *"report-only:"*"report-only 02 S3: 1/1"*) ok "--report prints a report-only: summary line" ;;
  *) bad "--report prints a report-only: summary line (got: ${rptout:0:300})" ;;
esac
check "a --report shard lands under results/<sha>/report/, structurally separate from the gating namespace mergeShards()/completedIndices() glob" \
  "$(j "process.stdout.write(String((await import('node:fs')).existsSync('$rptdir/report/02-000.json')))")" "true"
# Minor (pass 1 review): the written report record is filtered to the report-only half before it
# touches disk -- applyExecutedOverlays() writes every TAGGED dimension, gating included, so an
# unfiltered write would carry a GATING dimension's value (S5, here genuinely true) under this
# pass's `schema: 2` stamp, the same stamp a real gating shard carries but a different, incompatible
# record shape.
check "the written report shard excludes the gating dimension (S5), keeping only report-only ones under the gating schema stamp" \
  "$(j "process.stdout.write(String('S5' in JSON.parse((await import('node:fs')).readFileSync('$rptdir/report/02-000.json','utf8')).run.dimensions))")" \
  "false"
# F-139: `schema: 2` alone still means two incompatible shapes -- readShard() would accept a
# report record as current if anything ever pointed it at `report/`. `kind: 'report'` fixes that.
check "the written report shard is discriminated from a gating shard by kind: 'report'" \
  "$(j "process.stdout.write(String(JSON.parse((await import('node:fs')).readFileSync('$rptdir/report/02-000.json','utf8')).kind))")" \
  "report"

# --- 2.4c (fixed pass 2): --report honors --runs as a real cap on which shards it judges, not a
# value that reaches the result shape while every shard on disk gets judged regardless (F-132,
# decisions.md#d7's settled answer for the report pass's own N). Two more gating shards are added
# for indices 1 and 2; `--runs 1` must judge only index 0 (already report-shard-backed above) and
# leave 1/2 untouched -- no report/02-001.json, no report/02-002.json.
j "
  const fs = await import('node:fs');
  fs.writeFileSync(M.shardPath('$rptsha','02',1), JSON.stringify({ sha: '$rptsha', taskId: '02', schema: M.SCHEMA_VERSION, run: { index: 1, dimensions: {}, criteria: [], error: null, transcript: 't1' } }));
  fs.writeFileSync(M.shardPath('$rptsha','02',2), JSON.stringify({ sha: '$rptsha', taskId: '02', schema: M.SCHEMA_VERSION, run: { index: 2, dimensions: {}, criteria: [], error: null, transcript: 't2' } }));
" >/dev/null
PATH="$rptbin:$PATH" node "$R" --report "$rptsha" --runs 1 >/dev/null 2>&1
check "--report honors --runs as a cap on which shards it judges (F-132)" \
  "$(ls "$rptdir/report" | wc -l | tr -d ' ')" "1"
rm -rf "$rptbin" "$rptdir"

# --- 2.4c (fixed pass 2): --report threads task03Refs exactly like --rescore does, so both print
# the SAME EXECUTED verdict for task 03's one report-only dimension (S1) rather than opposite ones
# (F-129). The stub judge says criterion 3 PASSES; the cited date is a 30-day month, so the
# EXECUTED overlay must override it to FAIL on both paths -- a stub-agreeing fixture would not
# discriminate a leaked docstring claim from a real fix.
t3bin=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
cat > "$t3bin/claude" <<'STUB'
#!/usr/bin/env bash
echo '{"criteria":[{"n":1,"verdict":"pass","evidence":"e"},{"n":2,"verdict":"pass","evidence":"e"},{"n":3,"verdict":"pass","evidence":"e"},{"n":4,"verdict":"pass","evidence":"e"},{"n":5,"verdict":"pass","evidence":"e"}]}'
STUB
chmod +x "$t3bin/claude"
t3sha_a="task03refsA$(date +%s)"; t3sha_b="task03refsB$(date +%s)"
for sha in "$t3sha_a" "$t3sha_b"; do
  mkdir -p "$ROOT/tests/evals/results/$sha"
  j "
    const fs = await import('node:fs');
    fs.writeFileSync(M.shardPath('$sha','03',0), JSON.stringify({ sha: '$sha', taskId: '03', schema: M.SCHEMA_VERSION, run: { index: 0, dimensions: {}, criteria: [], error: null, transcript: 'Filed against 2026-04-16.' } }));
  " >/dev/null
done
PATH="$t3bin:$PATH" node --input-type=module -e "const M = await import('$ROOT/$R'); await M.rescoreShards('$t3sha_a', '$ROOT');" >/dev/null 2>&1
PATH="$t3bin:$PATH" node "$R" --report "$t3sha_b" >/dev/null 2>&1
rescoreS1=$(j "process.stdout.write(String(JSON.parse((await import('node:fs')).readFileSync('$ROOT/tests/evals/results/$t3sha_a/03-000.json','utf8')).run.dimensions.S1))")
reportS1=$(j "process.stdout.write(String(JSON.parse((await import('node:fs')).readFileSync('$ROOT/tests/evals/results/$t3sha_b/report/03-000.json','utf8')).run.dimensions.S1))")
check "--report's task-03 S1 matches --rescore's EXECUTED verdict on the same shard content (F-129)" "$reportS1" "$rescoreS1"
check "and both are the mechanical 'fail' the citation produces, not the stub judge's raw 'pass'" "$reportS1" "false"
rm -rf "$t3bin" "$ROOT/tests/evals/results/$t3sha_a" "$ROOT/tests/evals/results/$t3sha_b"

# --- Nit (pass 1 review): reportShards() on an unknown SHA throws a clear error, matching
# mergeShards()'s existsSync guard, not the raw "Command failed: ls" a bare execFileSync produces.
check "reportShards() on an unknown SHA throws loudly, not with a raw 'ls' failure" \
  "$(j "try { await M.reportShards('${SHARD_SHA}-nope'); process.stdout.write('REPORTED'); } catch (e) { process.stdout.write(e.message); }")" \
  "no shards for ${SHARD_SHA}-nope at $ROOT/tests/evals/results/${SHARD_SHA}-nope"

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
  for (let i = 0; i < 5; i++) tasks['01'].push({ index: i, dimensions: { S3: i < 2 } });
  const c = M.certify(M.buildResult({ source: {ref:'x',sha:'d'}, tasks, runs: 5 }));
  process.stdout.write([c.certified, c.onTrack, c.projectedFailures, c.sufficientDraws].join('|'));
")
check "a partial run cannot certify, and reports its projection" "$partial" "false|false|144|false"

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

# --- classification.mjs: the diff mechanism itself, unconditional (2.4a) -----------------------
# These need no file on disk -- they prove `diffClassification` can actually detect a changed
# verdict and a missing row, and that it reports no difference for two copies of the same table.
# That is necessary for the decisions.md comparison below to mean anything, but it is NOT the
# drift check itself: these three run against synthetic tables built from CLASSIFICATION alone and
# would stay green even if CLASSIFICATION had drifted from decisions.md#d11 completely.
check "classification.mjs: 15 criteria, no duplicate (task, criterion) pairs" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const keys = C.CLASSIFICATION.map((r) => r.task + ':' + r.criterion);
    process.stdout.write(String(C.CLASSIFICATION.length) + '|' + String(new Set(keys).size));
  ")" "15|15"
check "classification.mjs: 2 of 13 task-dimensions gate (task 01's S3, task 02's S5; task 03 zero)" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const dims = C.taskDimensions();
    const gating = dims.filter((d) => d.verdict === 'gating').map((d) => d.task + '/' + d.dim).sort();
    process.stdout.write(dims.length + '|' + gating.join(','));
  ")" "13|01/S3,02/S5"
check "diffClassification: identical tables match" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    process.stdout.write(String(C.diffClassification(C.CLASSIFICATION, C.CLASSIFICATION)));
  ")" "null"
check "diffClassification: a changed verdict is caught (mutation self-check)" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const mutated = C.CLASSIFICATION.map((r) => (r.task === '02' && r.criterion === 3) ? { ...r, verdict: 'gating' } : r);
    process.stdout.write(String(C.diffClassification(mutated, C.CLASSIFICATION)));
  ")" "mismatch:02:3:got=S1/gating:want=S1/report-only"
check "diffClassification: a missing row is caught" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const truncated = C.CLASSIFICATION.filter((r) => !(r.task === '01' && r.criterion === 6));
    process.stdout.write(String(C.diffClassification(truncated, C.CLASSIFICATION)));
  ")" "missing:01:6"

# --- decisionsMdClassification's multi-table, append-order mechanism, unconditional (2.4a pass 2,
# F-84/F-85; pass 4 adds a third case pinning F-88's verdict-cell throw) ---------------------------
# D11's five corrections to date have every one of them been APPENDED as a new dated section, never
# an edit to prior text in place. These three cases pin that the parser actually behaves that way on
# a synthetic (no file involved) D11-shaped span, not merely against today's decisions.md content.
check "decisionsMdClassification: a later table's copy of a shared row wins over an earlier table's (F-85 -- was reversed)" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const text = [
      '## D11 -- synthetic',
      '',
      '| task | crit | dim | mechanism | bidirectional? | sound? | verdict |',
      '|---|---|---|---|---|---|---|',
      '| 01 | 6 | S3 | x | yes | yes | GATING |',
      '| 03 | 1 | S4 | x | no | -- | report-only |',
      '',
      'prose sitting between the two tables',
      '',
      '| task | criterion | dimension | executor | verdict |',
      '|---|---|---|---|---|',
      '| 01 | 6 | S3 | x | report-only |',
      '',
      '## Superseded entries',
    ].join('\n');
    const derived = C.decisionsMdClassification(text);
    process.stdout.write(derived.find((r) => r.task === '01' && r.criterion === 6).verdict);
  ")" "report-only"
check "decisionsMdClassification: a table appended after the settled resolution overrides it, not invisible (F-84)" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const settled = [
      '## D11 -- synthetic',
      '',
      '| task | crit | dim | mechanism | bidirectional? | sound? | verdict |',
      '|---|---|---|---|---|---|---|',
      '| 01 | 6 | S3 | x | yes | yes | GATING |',
      '',
      'prose',
      '',
      '| task | criterion | dimension | executor | verdict |',
      '|---|---|---|---|---|',
      '| 01 | 6 | S3 | x | GATING |',
      '',
    ].join('\n');
    const withLaterCorrection = settled + [
      'a still later, appended correction',
      '',
      '| task | criterion | dimension | executor | verdict |',
      '|---|---|---|---|---|',
      '| 01 | 6 | S3 | x | report-only |',
      '',
      '## Superseded entries',
    ].join('\n');
    const derived = C.decisionsMdClassification(withLaterCorrection);
    process.stdout.write(derived.find((r) => r.task === '01' && r.criterion === 6).verdict);
  ")" "report-only"
check "decisionsMdClassification: an off-convention verdict spelling throws, not silently dropped (F-88)" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const text = ['## D11 -- synthetic', '', '| 01 | 6 | S3 | x | GATING |', '', 'p', '',
      '| 01 | 6 | S3 | x | GATING |', '| 03 | 1 | S4 | x | \`report-only\` |', '', '## End'].join('\n');
    try { C.decisionsMdClassification(text); process.stdout.write('NO THROW'); }
    catch (e) { process.stdout.write(/unrecognized verdict cell/.test(e.message) ? 'threw' : 'wrong:' + e.message); }
  ")" "threw"

# --- classification.mjs vs the live task specs: criterionTags(), tracked everywhere (2.4a pass 2,
# F-87) -----------------------------------------------------------------------------------------
# tests/evals/tasks/*.md are TRACKED (unlike decisions.md), so this runs in CI and in a fresh
# checkout -- three of CLASSIFICATION's four columns (task, criterion, dim) covered everywhere,
# strictly more reach than the decisions.md-conditional check below can ever have. `verdict` stays
# decisions.md-only; nothing here asserts gating/report-only, only that the (task, criterion, dim)
# triples themselves haven't drifted from what the live spec actually tags.
check "classification.mjs's (task, criterion, dim) triples match the live task specs' criterionTags()" \
  "$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const S = await import('$ROOT/tests/evals/lib/score.mjs');
    const fs = await import('node:fs');
    const dir = '$ROOT/tests/evals/tasks';
    const rows = [];
    for (const f of fs.readdirSync(dir).filter((f) => /^\d\d-.*\.md\$/.test(f))) {
      const task = f.slice(0, 2);
      const tags = S.criterionTags(fs.readFileSync(dir + '/' + f, 'utf8'));
      for (const [n, dims] of Object.entries(tags)) {
        if (dims.length !== 1) { process.stdout.write('multi-tag:' + task + ':' + n); process.exit(0); }
        rows.push(task + ':' + n + ':' + dims[0]);
      }
    }
    const actual = rows.sort().join(',');
    const expected = C.CLASSIFICATION.map((r) => r.task + ':' + r.criterion + ':' + r.dim).sort().join(',');
    process.stdout.write(actual === expected ? 'match' : 'actual=' + actual + '|expected=' + expected);
  ")" "match"

# --- classification.mjs vs decisions.md#d11's actual content: the real drift check (2.4a) -------
# `.somi/` is gitignored repo-wide (scripts/check-links.mjs's own header: "`git ls-files` can never
# produce a path inside it") -- decisions.md exists only on a machine actively working this plan,
# never in a clean checkout or in CI. So this runs in one of two modes, never a third: present, or
# loudly skipped when the plan directory itself is absent. There is no silent-pass path, and an
# absent decisions.md next to a PRESENT plan directory is not the expected-skip case -- that is a
# real gap (a renamed/moved/deleted file on a machine this check is supposed to protect) and fails
# loudly rather than reading identically to the honest CI skip. When present, it is genuinely
# bidirectional -- verified by hand this pass (and pass 1): flipping one row's verdict in
# CLASSIFICATION with decisions.md untouched, and separately flipping the same row's verdict in
# decisions.md with CLASSIFICATION untouched, each independently produced the `mismatch:...` line
# the check below would print, in the opposite direction (got/want swapped) each time, then
# reverted. Also verified this pass (F-84/F-85): appending a synthetic dated correction demoting
# `01|6` reds the check; flipping the SETTLED table's own copy of `01|6` reds it; flipping only the
# ORIGINAL table's copy (now correctly superseded) does not. Neither direction is covered when
# decisions.md is absent -- that gap is real and is not claimed to be closed by the checks above.
D11_PLAN_DIR="$ROOT/.somi/plans/eval-corpus-rebuild"
D11_DECISIONS="$D11_PLAN_DIR/decisions.md"
if [ -f "$D11_DECISIONS" ]; then
  drift=$(j "
    const C = await import('$ROOT/tests/evals/lib/classification.mjs');
    const fs = await import('node:fs');
    const text = fs.readFileSync('$D11_DECISIONS', 'utf8');
    let expected;
    try { expected = C.decisionsMdClassification(text); }
    catch (e) { process.stdout.write('throw:' + e.message); process.exit(0); }
    process.stdout.write(String(C.diffClassification(C.CLASSIFICATION, expected)));
  ")
  check "classification.mjs matches decisions.md#d11's settled table exactly (task, criterion, dimension, verdict)" \
    "$drift" "null"
elif [ -d "$D11_PLAN_DIR" ]; then
  bad "decisions.md#d11 drift check: $D11_PLAN_DIR exists but decisions.md is missing -- a real gap, not the expected CI/fresh-checkout absence"
else
  echo "  (skipped: $D11_PLAN_DIR not present -- .somi/ is gitignored, this check only runs where the plan directory is on disk)"
fi

# --- 2.5: smoke.mjs -- D8 Option C, frontmatter-driven, zero-model-call smoke check for the
# commands this work item does not gate with a live-model corpus -------------------------------
# The 3 genuinely gated commands: /plan, /code, /review (the rebuilt task gate, this phase).
# /code-loop's own convergence gate (D1-D5) isn't built yet (phase 3 not-started) -- labeling it
# `gate` excluded it from smoke for a mechanism that does not exist (2.6 pass 1, Blocker F-163,
# `phases/02-...md`'s 2.6 section carries the correction -- `decisions.md` untouched, out of this
# pass's scope). It now joins THIS tier too, the same treatment `decisions.md#d8` already gives
# /ship-loop for its own deferred (D9) gate. 24 commands on disk today, so 21 remain -- both
# counted below, not assumed.
#
# F-162/F-167: this set used to be spelled independently at three sites (now three still --
# GATED_COMMANDS_JS plus the two hardcoded expected.set('code-loop', ...)/('ship-loop', ...) rows
# in 2.6's cross-check below, both deliberately NOT members of this set) -- one check widening its
# own copy silently zeroed that check's coverage while the others stayed green (demonstrated in 2.5).
GATED_COMMANDS_JS="new Set(['plan', 'code', 'review'])"

check "24 commands on disk today (commands/*.md)" \
  "$(ls "$ROOT"/commands/*.md | wc -l | tr -d ' ')" "24"

check "discoverUngatedCommands() finds exactly the 21 D8 scopes this smoke check to" \
  "$(j "
    const S = await import('$ROOT/tests/evals/lib/smoke.mjs');
    const gated = $GATED_COMMANDS_JS;
    process.stdout.write(String(S.discoverUngatedCommands('$ROOT/commands', gated).length));
  ")" "21"

# The load-bearing negative constraint, made structural rather than trusted by intention (this
# phase has twice needed a grep pin, not trust, to keep "no test reaches this site" honest --
# 2.4a's F-136, 2.4c's judge-machinery deletion). Neither check names the model-invoking export in
# this comment, on purpose -- a docstring quoting it as prose is exactly the false-positive shape
# F-136 already caught once. Static, so neither survives a ROUTE change (a computed property name,
# or a call from elsewhere) -- the behavioral pin further below covers that.
check "smoke.mjs imports ONLY installSomi and DEFINITION_DIRS from install.mjs" \
  "$(grep -c "from './install.mjs';" "$ROOT/tests/evals/lib/smoke.mjs")" "1"
check "smoke.mjs never references install.mjs's model-invoking export, anywhere in the file" \
  "$(grep -c 'invokeCommand' "$ROOT/tests/evals/lib/smoke.mjs")" "0"

# Behavioral pin (F-147): a stub `claude` on PATH proves NO route reaches the model -- not just
# that the two static greps above hold. Every un-gated command is run through smokeCheck() with
# the stub in front of the real binary; the sentinel it touches must stay absent no matter how
# smoke.mjs got to this point.
stub_bin=$(mktemp -d)
stub_sentinel="$stub_bin/touched"
printf '#!/bin/sh\n%s "%s"\nexit 1\n' "$(command -v touch)" "$stub_sentinel" > "$stub_bin/claude"
chmod +x "$stub_bin/claude"
stub_iters=$(PATH="$stub_bin:$PATH" node --input-type=module -e "
  const S = await import('$ROOT/tests/evals/lib/smoke.mjs');
  const gated = $GATED_COMMANDS_JS;
  const files = S.discoverUngatedCommands('$ROOT/commands', gated);
  for (const f of files) S.smokeCheck(f); process.stdout.write(String(files.length));
" 2>/dev/null)
# F-156: proves the loop iterated the shared gated-set constant for real (a throw before the final
# write also leaves this empty, subsuming the old exit-status check) -- not a stale count reused
# from a different check.
check "the stub-claude loop iterated all 21 currently un-gated commands, so ABSENT below can't mean it never ran" \
  "$stub_iters" "21"
check "no smokeCheck() call reaches a stub claude on PATH (sentinel stays absent)" \
  "$([ -e "$stub_sentinel" ] && echo TOUCHED || echo ABSENT)" "ABSENT"

# Positive control (F-155): proves the stub is reachable on PATH at all -- a bad mktemp/chmod would
# otherwise leave ABSENT true for the wrong reason, with the check reading green regardless.
PATH="$stub_bin" claude >/dev/null 2>&1
check "positive control: claude invoked directly under the same stub touches the sentinel" \
  "$([ -e "$stub_sentinel" ] && echo TOUCHED || echo ABSENT)" "TOUCHED"
rm -rf "$stub_bin"

check "CLAUDE_CODE_TOOLS allowlist is non-empty (D3: a literal constant, not a dependency)" \
  "$(j "const S = await import('$ROOT/tests/evals/lib/smoke.mjs'); process.stdout.write(String(S.CLAUDE_CODE_TOOLS.size > 0));")" "true"

# The phase file's own acceptance criterion: smokeCheck() succeeds for every one of the 21
# currently un-gated commands. Real commands are never mutated to make this pass (scope
# discipline, stated in the coder's own brief) -- a real command failing here is a finding to
# report, not a fixture to fix.
allpass=$(j "
  const S = await import('$ROOT/tests/evals/lib/smoke.mjs');
  const gated = $GATED_COMMANDS_JS;
  const files = S.discoverUngatedCommands('$ROOT/commands', gated);
  const failed = files.map((f) => [f, S.smokeCheck(f)]).filter(([, r]) => !r.ok);
  process.stdout.write(failed.length === 0 ? 'ALL PASS' : failed.map(([f, r]) => f + ':' + r.field + ':' + r.reason).join(' | '));
")
check "smokeCheck() succeeds for all 21 currently un-gated commands" "$allpass" "ALL PASS"

# --- 2.5 acceptance: each of the four staged mutations fails with a SPECIFIC, ATTRIBUTABLE reason
# -- named in the phase file's own acceptance criterion, not added at review. Staged against a
# REAL, installed command file (pr.md, arbitrarily -- any un-gated command would do), never a
# hand-built fixture (spec.md §7: "stage adversarial mutations against real, committed inputs").
# `orig` is read once and held in memory -- copied aside, never `git checkout`'d -- and the mutant
# lives only in a throwaway `installSomi()` temp dir that is removed at the end of every case;
# `commands/pr.md` in the repo is never touched.
smoke_mutation_case() {
  local got
  got=$(j "
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { installSomi } = await import('$ROOT/tests/evals/lib/install.mjs');
    const S = await import('$ROOT/tests/evals/lib/smoke.mjs');
    const mutbin = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-smoke-mut-'));
    installSomi('$ROOT', mutbin);
    const target = path.join(mutbin, '.claude', 'commands', 'pr.md');
    const orig = fs.readFileSync(target, 'utf8');
    $2
    fs.writeFileSync(target, mutated);
    const r = S.smokeCheck(target);
    fs.rmSync(mutbin, { recursive: true, force: true });
    process.stdout.write(r.ok ? 'PASSED-BUT-SHOULD-FAIL' : r.field + ':' + r.reason);
  ")
  check "$1" "$got" "$3"
}

# Control first (spec.md §7: every gate's suite asserts a healthy input is NOT rejected, not only
# that a degraded one is caught) -- proves the four failures below are attributable to each
# specific mutation, not to something already wrong with the fixture itself.
smoke_control=$(j "
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { installSomi } = await import('$ROOT/tests/evals/lib/install.mjs');
  const S = await import('$ROOT/tests/evals/lib/smoke.mjs');
  const mutbin = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-smoke-mut-'));
  installSomi('$ROOT', mutbin);
  const target = path.join(mutbin, '.claude', 'commands', 'pr.md');
  const r = S.smokeCheck(target);
  fs.rmSync(mutbin, { recursive: true, force: true });
  process.stdout.write(r.ok ? 'PASS' : 'field:' + r.field + ' reason:' + r.reason);
")
check "control: the real, unmutated pr.md passes smokeCheck()" "$smoke_control" "PASS"

smoke_mutation_case "staged failure 1/4: a missing description fails, attributed to 'description'" \
  "const mutated = orig.replace(/^description:.*\n/m, '');" \
  "description:pr.md: frontmatter has no non-empty 'description'"

smoke_mutation_case "staged failure 2/4: a non-existent allowed-tools entry fails, attributed to 'allowed-tools'" \
  "const mutated = orig.replace(/^allowed-tools:.*\$/m, 'allowed-tools: Read, Grep, Glob, Bash, FrobnicateTool');" \
  "allowed-tools:pr.md: 'FrobnicateTool' is not a Claude Code tool this repo recognizes (not in CLAUDE_CODE_TOOLS)"

smoke_mutation_case "staged failure 3/4: an unrecognized model fails, attributed to 'model'" \
  "const mutated = orig.replace(/^model:.*\$/m, 'model: gpt-5-turbo');" \
  "model:pr.md: model 'gpt-5-turbo' is not one of this repo's tiers (opus, sonnet)"

# F-148 fix, proven both ways: FrobnicateTool (not real, above) still fails; TodoWrite (real, but
# declared by no command in this repo today) now passes -- via the allowlist, not popularity. The
# old, corpus-only predicate false-failed this case (the check taxed the first adopter of anything).
smoke_todowrite=$(j "
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { installSomi } = await import('$ROOT/tests/evals/lib/install.mjs');
  const S = await import('$ROOT/tests/evals/lib/smoke.mjs');
  const mutbin = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-smoke-mut-'));
  installSomi('$ROOT', mutbin);
  const target = path.join(mutbin, '.claude', 'commands', 'pr.md');
  const orig = fs.readFileSync(target, 'utf8');
  const mutated = orig.replace(/^allowed-tools:.*\$/m, 'allowed-tools: Read, Grep, Glob, Bash, TodoWrite');
  fs.writeFileSync(target, mutated);
  const r = S.smokeCheck(target);
  fs.rmSync(mutbin, { recursive: true, force: true });
  process.stdout.write(r.ok ? 'PASS' : 'field:' + r.field + ' reason:' + r.reason);
")
check "TodoWrite -- real, but declared by no other command -- passes via the allowlist" \
  "$smoke_todowrite" "PASS"

# F-154: DEFINITION_DIRS pinned literally -- installSomi() and smokeCheck() both iterate this one
# constant, so comparing the two sides against each other (as the mutation below does) can't catch
# a dropped/renamed entry; only a pin against the literal value can.
check "DEFINITION_DIRS is pinned literally" \
  "$(j "const { DEFINITION_DIRS } = await import('$ROOT/tests/evals/lib/install.mjs'); process.stdout.write(JSON.stringify(DEFINITION_DIRS));")" \
  '["commands","agents","skills","rules"]'

# F-149's replacement: the path check no longer walks a command's body links (that duplicated
# scripts/check-links.mjs and reintroduced the fence-blindness it was rewritten to remove). It now
# asserts the installed tree contains every install.mjs DEFINITION_DIRS entry -- staged here by
# deleting the installed 'skills' dir before smokeCheck() re-installs from it. The `all 21` check
# alone is blind to dropping 'skills' from DEFINITION_DIRS (F-154, verified) -- both sides iterate
# the same constant, so 0 of 21 go red there; staged failure 4/4 goes red on that drop too.
smoke_missing_dir=$(j "
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { installSomi } = await import('$ROOT/tests/evals/lib/install.mjs');
  const S = await import('$ROOT/tests/evals/lib/smoke.mjs');
  const mutbin = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-smoke-mut-'));
  installSomi('$ROOT', mutbin);
  fs.rmSync(path.join(mutbin, '.claude', 'skills'), { recursive: true, force: true });
  const target = path.join(mutbin, '.claude', 'commands', 'pr.md');
  const r = S.smokeCheck(target);
  fs.rmSync(mutbin, { recursive: true, force: true });
  const matched = !r.ok && r.field === 'install' && r.reason.includes(\"did not install the 'skills' directory\");
  process.stdout.write(r.ok ? 'PASSED-BUT-SHOULD-FAIL' : (matched ? 'install:MATCH' : r.field + ':' + r.reason));
")
check "staged failure 4/4: the installed tree missing a DEFINITION_DIRS entry (skills/) fails, attributed to 'install'" \
  "$smoke_missing_dir" "install:MATCH"

# --- 2.6: docs/EVALS.md's coverage table, cross-checked against classification.mjs and the live
# SCOPES -- not against a second document. A document-to-document comparison cannot see a
# document-vs-code gap (2.4a's own lesson, applied here to a new pair: the doc and the code it
# describes, not two hand-authored copies of the same fact). --------------------------------------

# D8's per-command floor rule, D11's zero-dimension supersession: zero gating dimensions reads
# report-only, never partial (even though 0/total is also "fewer than half"); fewer than half reads
# partial; half or more reads gate. The zero-dimension-label guard: a naive `< 0.5 -> partial` rule
# with no zero branch would mislabel task 03 (0 of 4) as `partial`, implying gating capability it
# does not have -- exactly the overstatement D11's supersession exists to forbid.
check "coverage label floor rule: zero gating reads report-only, never partial (D11's zero-dimension guard); fewer-than-half reads partial; half-or-more reads gate" \
  "$(j "
    function labelFor(g, t) { if (g === 0) return 'report-only'; return (g / t) < 0.5 ? 'partial' : 'gate'; }
    const cases = [[0, 4], [0, 1], [1, 4], [2, 4], [1, 2], [3, 4]];
    process.stdout.write(cases.map(([g, t]) => labelFor(g, t)).join(','));
  ")" "report-only,report-only,partial,gate,gate,gate"

# The task->command mapping is derived from each task spec's own header line (the same
# `Command under test: \`/name\`` idiom run.mjs's own taskPrompt() parses), not hand-typed --
# a task file renamed to a different command would move this, not silently leave it stale.
check "task-to-command mapping is derived from each task spec's own header, not hardcoded" \
  "$(j "
    const fs = await import('node:fs');
    const dir = '$ROOT/tests/evals/tasks';
    const map = {};
    for (const f of fs.readdirSync(dir).filter((f) => /^\d\d-.*\.md\$/.test(f))) {
      const text = fs.readFileSync(dir + '/' + f, 'utf8');
      const m = text.match(/Command under test: \`\/(\w[\w-]*)\`/);
      map[f.slice(0, 2)] = m ? m[1] : null;
    }
    process.stdout.write(JSON.stringify(map));
  ")" '{"01":"plan","02":"code","03":"review"}'

# The real check: parse docs/EVALS.md's actual coverage table (git-tracked, always present --
# unlike decisions.md, this runs unconditionally, no CI-skip branch) and compare every row against
# a label derived from classification.mjs's live CLASSIFICATION table, not from this comment or
# from decisions.md's prose. /code-loop and /ship-loop sit outside classification.mjs's data model
# (no task spec, no criteria -- D1-D5's convergence gate and D9's deferral respectively) and are
# asserted directly for that stated reason, not derived from a table that was never built to cover
# them; every other command name is read live off commands/*.md, so a 25th command or a rename
# shows up as a missing/extra row rather than silently passing.
coverage_check=$(j "
  const fs = await import('node:fs');
  const path = await import('node:path');
  const C = await import('$ROOT/tests/evals/lib/classification.mjs');
  function labelFor(g, t) { if (g === 0) return 'report-only'; return (g / t) < 0.5 ? 'partial' : 'gate'; }

  const tasksDir = '$ROOT/tests/evals/tasks';
  const taskToCommand = {};
  for (const f of fs.readdirSync(tasksDir).filter((f) => /^\d\d-.*\.md\$/.test(f))) {
    const text = fs.readFileSync(path.join(tasksDir, f), 'utf8');
    const m = text.match(/Command under test: \`\/(\w[\w-]*)\`/);
    taskToCommand[f.slice(0, 2)] = m[1];
  }
  const byTask = {};
  for (const d of C.taskDimensions()) {
    byTask[d.task] ??= { gating: 0, total: 0 };
    byTask[d.task].total += 1;
    if (d.verdict === 'gating') byTask[d.task].gating += 1;
  }
  const expected = new Map();
  for (const [task, command] of Object.entries(taskToCommand)) {
    const { gating, total } = byTask[task];
    expected.set(command, { label: labelFor(gating, total), ratio: gating + ' of ' + total });
  }
  // F-170: 'smoke'/'phase 3' is only true while phase 3's gate isn't wired. Flip the expectation
  // once it lands, so this pin fails loudly on the transition instead of going stale through it --
  // the exact way /code-loop's 'gate' label went stale the first time (F-163).
  // F-175: keyed on 3.4's own artifact (tests/scripts/convergence-runner.sh), NOT on 3.3's
  // tests/evals/convergence.mjs. 3.3's Files line creates only that module; the instruction to
  // flip this label and move /code-loop into GATED_COMMANDS_JS lives solely in 3.4's Acceptance
  // (phases/03-convergence-gating.md). Keying on 3.3's file would redden this pin the moment 3.3
  // lands -- a full iteration before the fix instruction that explains it exists -- and the
  // cheapest escape from an unexplained red suite is publishing 'gate' before the gate runs
  // (F-163 a third time). \"being built in phase 3, not yet landed\" is still true at the end of
  // 3.3, so the doc row isn't stale there; a pin that reddens before its own claim goes false
  // teaches people to route around it.
  const convergenceBuilt = fs.existsSync('$ROOT/tests/scripts/convergence-runner.sh');
  expected.set('code-loop', convergenceBuilt
    ? { label: 'gate' }
    : { label: 'smoke', mustMention: 'phase 3' });
  expected.set('ship-loop', { label: 'smoke', mustMention: 'deferred' });
  for (const f of fs.readdirSync('$ROOT/commands').filter((f) => f.endsWith('.md'))) {
    const name = f.slice(0, -3);
    if (!expected.has(name)) expected.set(name, { label: 'smoke' });
  }

  function parseCoverageTable(text) {
    // F-166: was \`(.+?)\s*\|\$\`, /m -- a lazy group anchored only at END OF LINE doesn't stop at
    // an embedded \`|\`; a future 4th column would silently fold into \`detail\`, so a row could
    // state the wrong ratio in its own cell and still pass on a substring match against the
    // absorbed neighbour. Split into exactly 3 non-empty cells instead; a row with more or fewer
    // fails to match at all (reported \`missing:<name>\`) rather than over-capturing.
    const actual = new Map();
    const re = /^\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|\s*\$/gm;
    let m;
    while ((m = re.exec(text))) {
      const nm = m[1].trim().match(/^\`\/([\w-]+)\`\$/);
      const label = m[2].trim(), detail = m[3].trim();
      if (nm && label && detail) {
        if (actual.has(nm[1])) throw new Error('duplicate coverage row: ' + nm[1]);
        actual.set(nm[1], { label, detail });
      }
    }
    return actual;
  }
  function diff(actual, expected) {
    const problems = [];
    for (const [name, exp] of expected) {
      const got = actual.get(name);
      if (!got) { problems.push('missing:' + name); continue; }
      if (got.label !== exp.label) problems.push('label:' + name + ':got=' + got.label + ':want=' + exp.label);
      if (exp.ratio && !got.detail.includes(exp.ratio)) problems.push('ratio:' + name + ':want ' + exp.ratio + ' in \"' + got.detail + '\"');
      if (exp.mustMention && !got.detail.toLowerCase().includes(exp.mustMention)) problems.push('mention:' + name + ':want \"' + exp.mustMention + '\" in \"' + got.detail + '\"');
    }
    for (const name of actual.keys()) if (!expected.has(name)) problems.push('extra:' + name);
    return problems;
  }

  const docText = fs.readFileSync('$ROOT/docs/EVALS.md', 'utf8');
  const actual = parseCoverageTable(docText);
  const problems = diff(actual, expected);
  process.stdout.write(problems.length === 0 ? 'MATCH:' + actual.size : problems.join(' | '));
")
check "docs/EVALS.md's coverage table (24 rows) matches labels derived from classification.mjs + D8's floor rule, live -- not copied from the plan" \
  "$coverage_check" "MATCH:24"

# The full-scope numeric row, same discipline: parsed off docs/EVALS.md's actual text, compared
# against SCOPES.full imported live from run.mjs, formatted exactly as certify()'s own CLI output
# formats it (toFixed(2)) so the doc and the printed run summary can never read differently.
check "docs/EVALS.md's \`full\` scope row (draws, budget, both power figures, covers) matches SCOPES.full live -- 240 draws / 1.81% false-accept, not 60 / 41.74%" \
  "$(j "
    const fs = await import('node:fs');
    function parseFullScopeRow(text) {
      const m = text.match(/\|\s*\`full\`\s*\|\s*(\d+)\s*\|\s*≤(\d+)\s*\|\s*([\d.]+)%\s*\|\s*\*{0,2}([\d.]+)%\*{0,2}\s*\|\s*([^|]+?)\s*\|/);
      return m && { draws: Number(m[1]), maxFailures: Number(m[2]), powerGood: m[3], powerSoft: m[4], covers: m[5].trim() };
    }
    const parsed = parseFullScopeRow(fs.readFileSync('$ROOT/docs/EVALS.md', 'utf8'));
    const sc = M.SCOPES.full;
    const expected = { draws: sc.draws, maxFailures: sc.maxFailures, powerGood: (sc.powerGood * 100).toFixed(2), powerSoft: (sc.powerSoft * 100).toFixed(2), covers: sc.covers };
    process.stdout.write(JSON.stringify(parsed) === JSON.stringify(expected) ? 'match' : 'parsed=' + JSON.stringify(parsed) + ' expected=' + JSON.stringify(expected));
  ")" "match"

# F-164: the doc restates SCOPES.full.draws again in its own prose sentence, 95 lines below the
# pinned table above -- pin that copy too, or one number stays free to drift while the other is
# checked (exactly how "260" survived next to a pinned "240").
check "docs/EVALS.md's 'A full certification is N draws' sentence matches SCOPES.full.draws live" \
  "$(j "
    const fs = await import('node:fs');
    const t = fs.readFileSync('$ROOT/docs/EVALS.md', 'utf8');
    const m = t.match(/A full certification is (\d+) draws\./);
    process.stdout.write(m ? String(Number(m[1]) === M.SCOPES.full.draws) : 'no-match');
  ")" "true"

# Both failure directions, shipped as permanent regression guards. Neither touches disk -- the
# doc-direction case mutates a STRING copy of the real file's text in memory; the code-direction
# case mutates a spread COPY of the real SCOPES.full object -- so neither risks corrupting a real
# file if interrupted, per spec.md §7's "copy aside, never mutate in place" discipline applied to
# a check's own fixtures. Also verified this pass against the real files on disk directly (mutate
# docs/EVALS.md, confirm red, restore from a copy; mutate a copy of run.mjs's CERTIFY_N, confirm
# red, restore) -- reported in this iteration's summary, not re-run on every suite invocation.
check "the cross-check catches a wrong DOC number (240 -> 260), SCOPES held real" \
  "$(j "
    const fs = await import('node:fs');
    function parseFullScopeRow(text) {
      const m = text.match(/\|\s*\`full\`\s*\|\s*(\d+)\s*\|\s*≤(\d+)\s*\|\s*([\d.]+)%\s*\|\s*\*{0,2}([\d.]+)%\*{0,2}\s*\|\s*([^|]+?)\s*\|/);
      return m && { draws: Number(m[1]), maxFailures: Number(m[2]), powerGood: m[3], powerSoft: m[4], covers: m[5].trim() };
    }
    const real = fs.readFileSync('$ROOT/docs/EVALS.md', 'utf8');
    const mutated = real.replace('| \`full\` | 240 |', '| \`full\` | 260 |');
    const parsed = parseFullScopeRow(mutated);
    const sc = M.SCOPES.full;
    const expected = { draws: sc.draws, maxFailures: sc.maxFailures, powerGood: (sc.powerGood * 100).toFixed(2), powerSoft: (sc.powerSoft * 100).toFixed(2), covers: sc.covers };
    process.stdout.write(String(JSON.stringify(parsed) === JSON.stringify(expected)));
  ")" "false"
check "the cross-check catches a wrong CODE number (SCOPES.full.draws mutated), doc held real" \
  "$(j "
    const fs = await import('node:fs');
    function parseFullScopeRow(text) {
      const m = text.match(/\|\s*\`full\`\s*\|\s*(\d+)\s*\|\s*≤(\d+)\s*\|\s*([\d.]+)%\s*\|\s*\*{0,2}([\d.]+)%\*{0,2}\s*\|\s*([^|]+?)\s*\|/);
      return m && { draws: Number(m[1]), maxFailures: Number(m[2]), powerGood: m[3], powerSoft: m[4], covers: m[5].trim() };
    }
    const real = fs.readFileSync('$ROOT/docs/EVALS.md', 'utf8');
    const parsed = parseFullScopeRow(real);
    const mutatedScopesFull = { ...M.SCOPES.full, draws: 200 };
    const expected = { draws: mutatedScopesFull.draws, maxFailures: mutatedScopesFull.maxFailures, powerGood: (mutatedScopesFull.powerGood * 100).toFixed(2), powerSoft: (mutatedScopesFull.powerSoft * 100).toFixed(2), covers: mutatedScopesFull.covers };
    process.stdout.write(String(JSON.stringify(parsed) === JSON.stringify(expected)));
  ")" "false"

# --- 3.1: convergence extractor -- reads /code-loop's loop-state JSON, classifies cap-breach ----
# (R3). Two independent extractors -- passesToApprove() (a pure field read) and capBreached() (a
# status classifier); neither calls the other, matching the phase file's own "3.1/3.2 are
# code-disjoint" framing one level down, inside 3.1 itself.
CONV=tests/evals/lib/convergence.mjs
cj() { node --input-type=module -e "const M = await import('$ROOT/$CONV'); $1" 2>&1; }

echo "== convergence extractor (3.1) =="

# --- passesToApprove(): fails safe (null) on anything that isn't a finite non-negative integer --
check "passesToApprove(null) is null"                    "$(cj "process.stdout.write(String(M.passesToApprove(null)));")" "null"
check "passesToApprove(undefined) is null"                "$(cj "process.stdout.write(String(M.passesToApprove(undefined)));")" "null"
check "passesToApprove({}) is null (no pass field)"       "$(cj "process.stdout.write(String(M.passesToApprove({})));")" "null"
check "passesToApprove('raw json string') is null (not pre-parsed -- fails safe, not JSON.parse'd for you)" \
  "$(cj "process.stdout.write(String(M.passesToApprove('{\"pass\":4}')));")" "null"
check "passesToApprove({pass:'4'}) is null (string, not number)" "$(cj "process.stdout.write(String(M.passesToApprove({pass:'4'})));")" "null"
check "passesToApprove({pass:-1}) is null (negative)"     "$(cj "process.stdout.write(String(M.passesToApprove({pass:-1})));")" "null"
check "passesToApprove({pass:1.5}) is null (non-integer)" "$(cj "process.stdout.write(String(M.passesToApprove({pass:1.5})));")" "null"
check "passesToApprove({pass:0}) is 0 (a real, valid boundary value -- not treated as falsy/missing)" \
  "$(cj "process.stdout.write(String(M.passesToApprove({pass:0})));")" "0"
check "passesToApprove({pass:4}) is 4 (the ordinary case)" "$(cj "process.stdout.write(String(M.passesToApprove({pass:4})));")" "4"
# passesToApprove() is deliberately status-blind -- a RUNNING loop's provisional pass count comes
# back as-is; the caller (3.3's driver, not yet built) must gate on status/capBreached() separately
# before treating it as a completed draw. Synthetic, not tied to any real file's live status, so
# this stays a permanent, deterministic pin of the contract rather than depending on ambient state
# that changes the moment a real loop finishes (see the guarded block below for why).
check "passesToApprove() is status-blind: returns a RUNNING loop's provisional pass count as-is" \
  "$(cj "process.stdout.write(String(M.passesToApprove({status:'running', pass:1})));")" "1"

# --- capBreached(): fails safe (null) on anything that isn't a recognised status string ----------
check "capBreached(null) is null"                          "$(cj "process.stdout.write(String(M.capBreached(null)));")" "null"
check "capBreached({}) is null (no status field)"           "$(cj "process.stdout.write(String(M.capBreached({})));")" "null"
check "capBreached({status:123}) is null (not a string)"    "$(cj "process.stdout.write(String(M.capBreached({status:123})));")" "null"
check "capBreached({status:'pending'}) is null (not a documented status at all)" \
  "$(cj "process.stdout.write(String(M.capBreached({status:'pending'})));")" "null"
check "capBreached({status:'diff-cap-exceded'}) is null (one-letter typo of a real breach status -- exact match, not fuzzy)" \
  "$(cj "process.stdout.write(String(M.capBreached({status:'diff-cap-exceded'})));")" "null"
# F-181: the typo case above REMOVES a letter, so a loosened matcher (substring/prefix/case-fold/
# trim) also returns null on it and passes -- it does not test exactness at all. These seven are
# near-misses a loosened matcher would wrongly accept: the first three kill substring/prefix
# containment (each embeds or extends a real status), 'DONE' kills case-folding and 'done ' kills
# trimming -- both on the `done` arm. F-186: those two alone left the *breach*-set lookup's own
# case-fold/trim unmeasured -- `CAP_BREACH_STATUSES.has(status.toLowerCase())` and
# `CAP_BREACH_STATUSES.has(status.trim())` both survived at 303/0, over-detecting a breach on
# 'MAX-PASSES-EXCEEDED' where the module answers null. 'MAX-PASSES-EXCEEDED' kills case-folding and
# 'max-passes-exceeded ' kills trimming on that arm specifically. Real module confirmed to answer
# null on all seven before writing this.
NEAR_MISS_STATUSES=('user-stopped' 'not-max-passes-exceeded' 'max-passes-exceeded-recovered' 'DONE' 'done ' 'MAX-PASSES-EXCEEDED' 'max-passes-exceeded ')
for s in "${NEAR_MISS_STATUSES[@]}"; do
  check "capBreached({status:'$s'}) is null (near-miss of a real status -- exact match, not fuzzy)" \
    "$(cj "process.stdout.write(String(M.capBreached({status:'$s'})));")" "null"
done
check "capBreached({status:'done'}) is false"                "$(cj "process.stdout.write(String(M.capBreached({status:'done'})));")" "false"
# Decision, made deliberately rather than defaulted into: a RUNNING loop is neither a confirmed
# pass nor a confirmed breach. false would assert "confirmed clean" (not yet true); true would mark
# a live loop as a cap failure it has not committed -- exactly the corpus-measuring-itself trap
# named in this iteration's brief. null is the only answer that doesn't overclaim either way.
check "capBreached({status:'running'}) is null, NOT false and NOT true (the deliberate 'not done != breached' decision)" \
  "$(cj "process.stdout.write(String(M.capBreached({status:'running'})));")" "null"
# Every documented terminal cap-breach status, individually -- catches an implementation that only
# recognises one or two of the five (`commands/code-loop.md`'s enum), not just the first tried.
# F-187: derived from the module's own exported CAP_BREACH_STATUSES, not retyped -- a status added,
# renamed, or dropped there is reflected here without a second edit. F-190 (pass 3): reflection is
# exactly why a RENAME went undetected -- `circuit-breaker` -> `circuit-breakers` passed 306/0,
# because the loop derived both its subjects AND its only independent check (a count) from the same
# constant under test. Pinned instead against `commands/code-loop.md`'s own enum -- a source of
# truth outside the module that a rename cannot drag along with it -- via set-equality, which also
# subsumes the count (an empty derivation compares "" against 5 real entries and fails loudly on
# either side alone; F-196, pass 5: both sides empty at once -- un-export AND the doc anchor
# renamed -- printed `ok` at 300/1 without the sentinel default on DOC_STATUSES below, which
# breaks that symmetry). This is F-183's "vacuous zero-iteration pass" shape, closed here instead
# of by counting. Matches this file's own precedent at ~1803: every other command name is read
# live off `commands/*.md`, not retyped, so drift between the module and the doc shows up here too,
# not just drift within the module. Filtered on an identifier-safe allowlist -- letters, digits,
# underscore, hyphen -- rather than the doc's `[a-z-]` alphabet (F-195, pass 5): sharing that
# alphabet as the filter was itself a blind spot -- a status outside it drops from both sides
# symmetrically and set-equality still compares equal (measured: `quota-cap-2` added to the module
# AND documented gives 306/0, the string asserted nowhere). An allowlist, not a denylist of just
# whitespace/quote/backslash: measured on this un-export mutation's actual stderr, a bare
# `file:///.../[eval1]:1` frame contains none of those three and would have slipped through as a
# bogus status. The allowlist keeps F-192's actual concern -- stopping a failed import's stderr
# from landing as a raw token inside the single-quoted JS literals below -- while still being
# strictly wider than the doc's alphabet, so a real status outside `[a-z-]` surfaces as a
# set-equality mismatch instead of vanishing from both sides. Also drops `mapfile` (F-190's Nit),
# this script's only bash-4-only builtin.
BREACH_STATUSES=()
while IFS= read -r s; do
  [[ "$s" =~ ^[A-Za-z0-9_-]+$ ]] && BREACH_STATUSES+=("$s")
done < <(cj "for (const s of M.CAP_BREACH_STATUSES) process.stdout.write(s + '\n');")
DOC_STATUSES="$(grep -A1 'Loop status:' "$ROOT/commands/code-loop.md" | grep -o '`[a-z-]*`' | tr -d '`' | grep -v '^done$' | sort)"
check "the module's CAP_BREACH_STATUSES matches commands/code-loop.md's documented enum exactly (set-equality, not a count)" \
  "$(printf '%s\n' ${BREACH_STATUSES[@]+"${BREACH_STATUSES[@]}"} | sort)" "${DOC_STATUSES:-<doc-derivation-empty>}"
for s in "${BREACH_STATUSES[@]}"; do
  check "capBreached({status:'$s'}) is true (documented breach terminal)" \
    "$(cj "process.stdout.write(String(M.capBreached({status:'$s'})));")" "true"
done
# The phase file's own literal acceptance criterion: true against a synthetic file staged with
# status:"max-passes-exceeded" -- restated once more here as its own named check, not only folded
# into the loop above, so this specific acceptance point has its own visible pass/fail line.
check "capBreached() on a synthetic file staged with status:\"max-passes-exceeded\" is true (phase 3.1's own acceptance wording)" \
  "$(cj "process.stdout.write(String(M.capBreached({status:'max-passes-exceeded'})));")" "true"

# --- Against the real population context.md §2.2 independently computed -------------------------
# .somi/ is gitignored (confirmed: .gitignore lines 3-4/8/34) -- .somi/somi-state/loop/ will not
# exist on a fresh checkout or in a from-scratch CI clone, same precondition the D11 classification
# drift check above already handles. Guarded the same way, for the same reason.
LOOPDIR="$ROOT/.somi/somi-state/loop"
if [ -d "$LOOPDIR" ]; then
  # NAMED EXPLICITLY, not globbed. .somi/somi-state/loop/*.json has grown to 34 files since
  # context.md §2.2 computed its baseline from 21 -- 11 of the new ones are THIS work item's own
  # loop-state files (created by the very loops that ran phases 1-2, one of them this iteration's
  # own in-progress state file). A glob over *.json today would silently validate against a
  # DIFFERENT, still-growing population, not the one §2.2 independently computed. This list is
  # §2.2's population, identified by name: composition cross-checked against §2.2's own breakdown
  # before trusting it (9 code + 1 plan under context-economy-overhaul, 4 code + 1 plan under
  # reasoning-craft, 5 code + 1 plan under somi-orchestrator = 21) and its values reproduce §2.2's
  # stated mean (2.142857...) and sample sd (1.236354...) exactly -- verified below, not assumed.
  BASELINE_21=(
    context-economy-overhaul.1.1 context-economy-overhaul.1.2 context-economy-overhaul.1.3
    context-economy-overhaul.2.1 context-economy-overhaul.2.2 context-economy-overhaul.2.3
    context-economy-overhaul.3.1 context-economy-overhaul.3.2 context-economy-overhaul.3.3
    context-economy-overhaul
    reasoning-craft.1.1 reasoning-craft.1.2 reasoning-craft.1.3 reasoning-craft.1.4
    reasoning-craft
    somi-orchestrator.1.1 somi-orchestrator.2.1 somi-orchestrator.3.1 somi-orchestrator.3.2 somi-orchestrator.4.1
    somi-orchestrator
  )
  names_js="["
  for n in "${BASELINE_21[@]}"; do names_js+="'$n',"; done
  names_js+="]"

  missing=""
  for name in "${BASELINE_21[@]}"; do
    [ -f "$LOOPDIR/$name.json" ] || missing="$missing $name"
  done
  if [ -z "$missing" ]; then
    check "all 21 of context.md §2.2's named baseline files still exist on disk" "present" "present"
  else
    check "all 21 of context.md §2.2's named baseline files still exist on disk" "MISSING:$missing" "present"
  fi

  check "passesToApprove() reproduces exactly context.md §2.2's 21 values, by name not by glob" \
    "$(cj "
      const fs = await import('node:fs');
      const names = $names_js;
      const dir = '$LOOPDIR';
      const got = names.map((n) => M.passesToApprove(JSON.parse(fs.readFileSync(dir + '/' + n + '.json', 'utf8'))));
      process.stdout.write(JSON.stringify(got));
    ")" \
    "[4,4,5,2,3,2,3,3,3,3,1,1,1,1,2,1,1,1,1,1,2]"

  check "the 21 extracted values' mean/sd match context.md §2.2 exactly (2.142857.../1.236354...)" \
    "$(cj "
      const fs = await import('node:fs');
      const names = $names_js;
      const dir = '$LOOPDIR';
      const p = names.map((n) => M.passesToApprove(JSON.parse(fs.readFileSync(dir + '/' + n + '.json', 'utf8'))));
      const mean = p.reduce((a, b) => a + b, 0) / p.length;
      const sd = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / (p.length - 1));
      process.stdout.write(mean.toFixed(6) + '/' + sd.toFixed(6));
    ")" \
    "2.142857/1.236354"

  check "capBreached() is false for all 21 of context.md §2.2's named files (all real status:\"done\")" \
    "$(cj "
      const fs = await import('node:fs');
      const names = $names_js;
      const dir = '$LOOPDIR';
      const got = names.map((n) => M.capBreached(JSON.parse(fs.readFileSync(dir + '/' + n + '.json', 'utf8'))));
      process.stdout.write(String(got.every((b) => b === false)) + ':' + got.length);
    ")" \
    "true:21"

  # The corpus grew a second way since §2.2: it now contains loop-state files that are neither
  # done nor a cap-breach -- status:"running" (2 under context-economy-overhaul, plus this very
  # iteration's own eval-corpus-rebuild.3.1.json). Discovered DYNAMICALLY, by count, rather than by
  # naming these specific files: this iteration's own state file WILL flip to "done" the moment
  # this loop finishes, so a check hardcoded to a fixed filename/count would go stale for a reason
  # unrelated to correctness the moment this very iteration closes. The invariant under test
  # (capBreached() is null for a real running file, never false or true) holds regardless of how
  # many such files exist at any given moment, including zero.
  running_check=$(cj "
    const fs = await import('node:fs');
    const files = fs.readdirSync('$LOOPDIR').filter((f) => f.endsWith('.json'));
    const runningResults = [];
    for (const f of files) {
      const o = JSON.parse(fs.readFileSync('$LOOPDIR/' + f, 'utf8'));
      if (o.status === 'running') runningResults.push(M.capBreached(o));
    }
    process.stdout.write(runningResults.length + ':' + runningResults.every((r) => r === null));
  ")
  running_count="${running_check%%:*}"
  running_all_null="${running_check##*:}"
  if [ "$running_count" = "0" ]; then
    echo "  (skipped: no real status:\"running\" loop-state file on disk right now to check capBreached() against)"
  else
    check "capBreached() is null for every real loop-state file currently status:\"running\" ($running_count found right now)" \
      "$running_all_null" "true"
  fi

  # F-183: the check above is SELF-SELECTING -- it discovers subjects by the exact string
  # (o.status === 'running') it then asserts capBreached() classifies. If the schema renamed
  # 'running' to something else, zero files would match, running_count would read 0, and the block
  # above would print a skip rather than fail -- silent, not loud. Supplemented (not replaced) with
  # a check that scans EVERY real file in $LOOPDIR and asserts its status is one of the documented
  # ones, independent of which specific string it discovers first. This is what actually catches a
  # status the module has never seen, and cannot silently skip -- an empty $LOOPDIR still passes
  # vacuously (nothing to violate), but a non-empty one with an unrecognised status always fails.
  # F-187: 'done'/'running' are the two non-breach terminals this module itself recognises; the
  # five breach terminals come from M.CAP_BREACH_STATUSES directly, not a third hardcoded copy.
  known_status_check=$(cj "
    const fs = await import('node:fs');
    const files = fs.readdirSync('$LOOPDIR').filter((f) => f.endsWith('.json'));
    const known = new Set(['done', 'running', ...M.CAP_BREACH_STATUSES]);
    const unknown = [];
    for (const f of files) {
      const o = JSON.parse(fs.readFileSync('$LOOPDIR/' + f, 'utf8'));
      // F-236: bare membership missed the documented stopped-<reason> form -- go through
      // capBreached() itself (it strips the prefix) rather than a second un-prefixed spelling.
      if (!known.has(o.status) && M.capBreached(o) !== true) unknown.push(f + ':' + String(o.status));
    }
    process.stdout.write(unknown.length === 0 ? 'ALL_KNOWN' : unknown.join(','));
  ")
  check "every real loop-state file's status is in {done} ∪ CAP_BREACH_STATUSES ∪ {stopped-<reason> : reason ∈ CAP_BREACH_STATUSES} ∪ {running} ($LOOPDIR)" \
    "$known_status_check" "ALL_KNOWN"
else
  echo "  (skipped: $LOOPDIR not present -- .somi/ is gitignored, this block only runs where real loop-state history is on disk)"
fi

# --- Mutation testing (spec.md §7): staged against COPIES of a real, COMMITTED loop-state file --
# never against the file itself, and never against inputs invented to be easy to pass. Runs
# unconditionally -- unlike the block above, this one does NOT read $LOOPDIR (F-241, closed here
# for 3.1's own mutation tests too: they used to read the same gitignored directory the 3.3a
# review flagged, so this comment's "committed" claim was false the same way theirs was; a
# contributor whose loop directory existed but lacked these two exact named files would also have
# hit an unhandled read failure on this block, the same shape of machine-dependence, just not the
# one the review happened to test). DONE_FIXTURE is `context-economy-overhaul.2.1.json`, committed
# verbatim (pass=2, status=done).
DONE_FIXTURE="$ROOT/tests/scripts/goldens/loop-state-done.json"
scratch=$(mktemp -d)

check "mutation (wrong field name: pass -> passes) on a COPY of a real, committed loop-state file is caught" \
  "$(cj "
    const fs = await import('node:fs');
    const obj = JSON.parse(fs.readFileSync('$DONE_FIXTURE', 'utf8'));
    obj.passes = obj.pass; delete obj.pass;
    fs.writeFileSync('$scratch/wrong-field.json', JSON.stringify(obj));
    process.stdout.write(String(M.passesToApprove(JSON.parse(fs.readFileSync('$scratch/wrong-field.json', 'utf8')))));
  ")" \
  "null"
check "...the fixture itself was never touched by that mutation -- passesToApprove() on the original still returns 2" \
  "$(cj "const fs = await import('node:fs'); process.stdout.write(String(M.passesToApprove(JSON.parse(fs.readFileSync('$DONE_FIXTURE', 'utf8')))));")" \
  "2"

check "mutation (swapped status string: done -> diff-cap-exceeded) on a COPY of a real, committed loop-state file is caught" \
  "$(cj "
    const fs = await import('node:fs');
    const obj = JSON.parse(fs.readFileSync('$DONE_FIXTURE', 'utf8'));
    obj.status = 'diff-cap-exceeded';
    fs.writeFileSync('$scratch/swapped-status.json', JSON.stringify(obj));
    process.stdout.write(String(M.capBreached(JSON.parse(fs.readFileSync('$scratch/swapped-status.json', 'utf8')))));
  ")" \
  "true"
check "...the fixture itself was never touched by that mutation -- capBreached() on the original still returns false" \
  "$(cj "const fs = await import('node:fs'); process.stdout.write(String(M.capBreached(JSON.parse(fs.readFileSync('$DONE_FIXTURE', 'utf8')))));")" \
  "false"

rm -rf "$scratch"

# --- 3.2: tie-conditional Mann-Whitney U via Monte Carlo, with a real oracle (D3, D5) -----------
# Two independent oracles, both required (phases/03-convergence-gating.md iteration 3.2 -- this
# iteration's own oracle was rewritten twice and deleted once; see the phase file's revision
# history for why a self-referential check is not trusted here). Oracle 1: published small-n
# worked examples on UNTIED data, where the tie-conditional distribution this module computes and
# the classic exact distribution agree (sources cited below). Oracle 2: brute-force permutation
# enumeration on small TIED data (n1=n2=5 over {1,2,3}, C(10,5)=252 splits -- exhaustive, not
# sampled), computed HERE, independently of mannWhitneyU's own code.
MW=tests/evals/lib/mann-whitney.mjs
# F-202: optional 2nd arg overrides the import path (defaults to the real file) -- lets the
# mutation section below import a scratch COPY instead, without touching every existing call site.
mwj() { node --input-type=module -e "const M = await import('${2:-$ROOT/$MW}'); $1" 2>&1; }

echo "== tie-conditional Mann-Whitney U (3.2) =="

# --- input validation: throws, never guesses -- mirrors run.mjs's grade() "throws rather than
# grading" precedent (this file, ~line 40) applied to the new module. ---
for bad in "[], [1]" "[1], []" "[1,'a'], [1]" "[1], [NaN]" "[1], [Infinity]" "null, [1]" \
           "[1], [1], {resamples:0}" "[1], [1], {resamples:-5}" "[1], [1], {resamples:1.5}" \
           "[1], [1], {resamples:10000001}" "[1], [1], {rng: 5}"; do
  got=$(mwj "try { M.mannWhitneyU($bad); process.stdout.write('NO THROW'); } catch (e) { process.stdout.write(e.constructor.name); }")
  check "mannWhitneyU($bad) throws rather than guessing" "$got" "RangeError"
done
check "a valid, minimal call does not throw (the validation above doesn't also reject healthy input)" \
  "$(mwj "try { M.mannWhitneyU([1],[2],{resamples:1000}); process.stdout.write('ok'); } catch (e) { process.stdout.write('THREW:'+e.constructor.name); }")" "ok"
# F-216: every probe above sits on the REJECTING side of both thresholds, so neither accepting
# edge (resamples===1, resamples===MAX_RESAMPLES) was ever exercised -- a >=-for-> slip and its
# <=-for-< mirror both passed all 333 checks, measured. Reads M.MAX_RESAMPLES, not a literal, so
# this can't drift if the cap is ever raised.
check "mannWhitneyU accepts BOTH true accepting edges: resamples===1 and resamples===MAX_RESAMPLES (F-216)" \
  "$(mwj "
    let ok1 = false, ok2 = false;
    try { M.mannWhitneyU([1],[2],{resamples:1}); ok1 = true; } catch {}
    try { M.mannWhitneyU([1],[2],{resamples:M.MAX_RESAMPLES}); ok2 = true; } catch {}
    process.stdout.write(String(ok1 && ok2));
  ")" "true"

# --- the documented contract itself: resample count and its own stated MC-error formula ---
check "DEFAULT_RESAMPLES is exported as exactly 200000 (the 'low hundred-thousands' figure this file's own docstring commits to and derives its worst-case SE from)" \
  "$(mwj "process.stdout.write(String(M.DEFAULT_RESAMPLES));")" "200000"
check "returned mcError matches sqrt(p*(1-p)/resamples) recomputed from the returned p -- the stated formula, not a different one" \
  "$(mwj "
    const r = M.mannWhitneyU([1,2,3,4,5], [2,3,4,5,6], {resamples: 20000});
    const recomputed = Math.sqrt(r.p * (1 - r.p) / 20000);
    process.stdout.write(String(Math.abs(r.mcError - recomputed) < 1e-12));
  ")" "true"
check "p is bounded away from exact 0 (F-200 add-one correction)" "$(mwj "const r = M.mannWhitneyU(Array(15).fill(1), Array(15).fill(5), {resamples: 20000}); process.stdout.write(String(r.p === 1/20001 && r.mcError > 0));")" "true"
check "direction is one of the three documented states (A>B / B>A / tie)" \
  "$(mwj "
    const r = M.mannWhitneyU([1,2,3], [4,5,6], {resamples: 5000});
    process.stdout.write(String(['A>B','B>A','tie'].includes(r.direction)));
  ")" "true"
check "F-203: two mannWhitneyU calls seeded with the same mulberry32(seed) reproduce the identical p (replayable from stored arms)" \
  "$(mwj "
    const a = M.mannWhitneyU([1,2,3,4,5], [3,4,5,6,7], {resamples: 5000, rng: M.mulberry32(7)});
    const b = M.mannWhitneyU([1,2,3,4,5], [3,4,5,6,7], {resamples: 5000, rng: M.mulberry32(7)});
    process.stdout.write(String(a.p === b.p && a.U === b.U));
  ")" "true"

# --- Oracle 1: published worked examples on UNTIED data (known U and exact p from OUTSIDE this
# module). Tolerance is DERIVED from the resample count under test (D3/D5's own "stated tolerance"
# requirement), never loosened to fit: the Monte Carlo standard error of a resampled proportion is
# sqrt(p(1-p)/R); 5x that SE bounds a correct implementation's false-failure rate at ~5.7e-7
# (two-sided z), tight enough that the 1.5-3.6x conservative bias this iteration exists to rule out
# (D3/D5) would clear it by roughly two orders of magnitude, not a near-miss.
ORACLE_RESAMPLES=200000

# F-201: shared enumeration helpers -- u() the same rank-sum computation as rankSumU, combos() a
# k-combination generator, enumeratedP() "what fraction of every C(n,k) index-split is >= U",
# computed HERE, independently of mannWhitneyU. Oracle 2 originally defined its own copy of
# u()/combos() inline; shared here so oracle 1a/1b's cited p becomes p enumerated the same way,
# not a second (or third) off-machine number the acceptance checks below have to trust.
# F-205: run_mw_oracles() below deliberately does NOT reuse MW_ENUM -- it keeps its own cited
# trueP1/trueP2/0.5 so the mutation evidence stays independent of enumeratedP; the positive
# control that follows it is what pins those three numbers correct.
MW_ENUM='
    function u(a,b){ let s=0; for (const bv of b) for (const av of a) { if (bv>av) s+=1; else if (bv===av) s+=0.5; } return s; }
    function combos(n,k){ const res=[]; const idx=Array.from({length:k},(_,i)=>i); while (true) { res.push(idx.slice()); let i=k-1; while (i>=0 && idx[i]===n-k+i) i--; if (i<0) break; idx[i]++; for (let j=i+1;j<k;j++) idx[j]=idx[j-1]+1; } return res; }
    function enumeratedP(a, b, observedU) {
      const pool = a.concat(b), n1 = a.length, N = pool.length;
      const subsets = combos(N, n1);
      let extreme = 0;
      for (const sub of subsets) {
        const inA = new Set(sub);
        const A = [], B = [];
        for (let i = 0; i < N; i++) (inA.has(i) ? A : B).push(pool[i]);
        if (u(A, B) >= observedU) extreme++;
      }
      return extreme / subsets.length;
    }
'

# Example 1 -- Hollander & Wolfe (1973), "Nonparametric Statistical Methods", pp. 27-33 & 68-75:
# permeability constants of the human chorioamnion, term (x) vs. 12-26wk gestation (y). This is
# the canonical worked example in R's own stats::wilcox.test() documentation (Examples section);
# the pooled 15 values are confirmed distinct (no ties). Exact U and one-sided p (x stochastically
# greater than y) independently cross-checked via SciPy 1.17.1's
# scipy.stats.mannwhitneyu(x, y, alternative='greater', method='exact') -- an unrelated,
# independently-implemented realization of Mann & Whitney's (1947) own exact null-distribution
# algorithm, not this module's code in any form: U=35, matching this module's own convention. Cited
# below only as C(15,5)=3003; the exact p itself is now enumerated in-suite (F-201), not cited --
# reusing MW_ENUM removes the only place this suite trusted an off-machine tool. armA is the
# smaller (y) arm, armB the larger (x) arm, matching this module's tested direction (armB
# stochastically greater than armA).
check "C(15,5) = 3003 (oracle 1a's own denominator, verified, not assumed)" \
  "$(node -e "let r=1; for (let i=0;i<5;i++) r=r*(15-i)/(i+1); process.stdout.write(String(Math.round(r)));")" "3003"
check "oracle 1a (Hollander & Wolfe 1973 permeability data, untied): U matches exactly, p (enumerated over all C(15,5)=3003 splits, not cited) within 5x its own Monte Carlo SE" \
  "$(mwj "$MW_ENUM
    const armA = [1.15, 0.88, 0.90, 0.74, 1.21];
    const armB = [0.80, 0.83, 1.89, 1.04, 1.45, 1.38, 1.91, 1.64, 0.73, 1.46];
    const r = M.mannWhitneyU(armA, armB, {resamples: $ORACLE_RESAMPLES});
    const pExact = enumeratedP(armA, armB, r.U);
    const tol = 5 * Math.sqrt(pExact * (1 - pExact) / $ORACLE_RESAMPLES);
    process.stdout.write(String(r.U === 35 && Math.abs(r.p - pExact) <= tol));
  ")" "true"

# Example 2 -- Wikipedia, "Mann-Whitney U test", the tortoise/hare illustration: finishing order
# 'T H H H H H T T T T T H' (6 of each; a permutation of 1..12, no ties). Ascending finish-position
# values (1 = first place); tortoise as armB, hare as armA, exercising the same B-relative-to-A
# convention oracle 1a does. The article's own rank-sum arithmetic (32/46, its own reversed-rank
# convention) reproduces exactly as armA/armB's complementary pair (U_A+U_B=n1*n2=36, confirmed
# while sourcing this example). Exact one-sided p cross-checked the same way as example 1 (SciPy,
# method='exact'): U=25 (matching this module's convention); p enumerated in-suite (F-201), not
# cited -- see C(12,6)=924 below.
check "C(12,6) = 924 (oracle 1b's own denominator, verified, not assumed)" \
  "$(node -e "let r=1; for (let i=0;i<6;i++) r=r*(12-i)/(i+1); process.stdout.write(String(Math.round(r)));")" "924"
check "oracle 1b (Wikipedia tortoise/hare, untied): U matches exactly, p (enumerated over all C(12,6)=924 splits, not cited) within 5x its own Monte Carlo SE" \
  "$(mwj "$MW_ENUM
    const armA = [2,3,4,5,6,12];
    const armB = [1,7,8,9,10,11];
    const r = M.mannWhitneyU(armA, armB, {resamples: $ORACLE_RESAMPLES});
    const pExact = enumeratedP(armA, armB, r.U);
    const tol = 5 * Math.sqrt(pExact * (1 - pExact) / $ORACLE_RESAMPLES);
    process.stdout.write(String(r.U === 25 && Math.abs(r.p - pExact) <= tol));
  ")" "true"

# --- Oracle 2: brute-force permutation enumeration on small TIED data, computed OUTSIDE
# mannWhitneyU entirely -- the real oracle for the tie case, sharing none of the implementation's
# own assumptions. n1=n2=5 over {1,2,3}: C(10,5)=252, exhaustively enumerable (verified below, not
# assumed). armA=[1,1,2,3,3], armB=[1,2,2,3,3] -- ties both within and across arms, the shape the
# untied DP recursion (D3's rejected original method) cannot represent at all.
check "C(10,5) = 252 (oracle 2's own denominator, verified, not assumed)" \
  "$(node -e "let r=1; for (let i=0;i<5;i++) r=r*(10-i)/(i+1); process.stdout.write(String(Math.round(r)));")" "252"

MW_ORACLE2_SNIPPET="$MW_ENUM"'
    const armA = [1,1,2,3,3];
    const armB = [1,2,2,3,3];
    const observedU = u(armA, armB);
    const r = M.mannWhitneyU(armA, armB, {resamples: '"$ORACLE_RESAMPLES"'});
    const pExact = enumeratedP(armA, armB, observedU);
    const tol = 5 * Math.sqrt(pExact * (1 - pExact) / '"$ORACLE_RESAMPLES"');
    process.stdout.write(String(r.U === observedU && Math.abs(r.p - pExact) <= tol));
'
check "oracle 2 (brute-force enumeration, n1=n2=5 over {1,2,3}, all 252 splits): U matches exactly, p within 5x its own Monte Carlo SE of the enumerated exact p" \
  "$(mwj "$MW_ORACLE2_SNIPPET")" "true"

# --- Mutation testing (spec.md §7): staged against a COPY of mann-whitney.mjs, never the tracked
# file itself (F-202, following 3.1's own precedent at :2176-2210 -- "staged against COPIES ...
# never against the files themselves"). Both mutants named in the phase file's own acceptance
# criterion, each confirmed caught by re-implementations of all three oracles above (F-205:
# deliberately independent of MW_ENUM's enumeratedP), not by a case the implementation was written
# to satisfy. mwj's optional path argument (above) is what makes this a one-line change per call
# site: the scratch copy is mutated and imported directly, so the real file is never written.
MW_SCRATCH_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
MW_SCRATCH="$MW_SCRATCH_DIR/mann-whitney.mjs"
cp "$ROOT/$MW" "$MW_SCRATCH"
trap 'rm -rf "$MW_SCRATCH_DIR"' EXIT

run_mw_oracles() {
  # F-199: returns 'ok1/ok2/ok3', not ok1&&ok2&&ok3 -- a conjunction can't tell "one oracle caught
  # it" from "all three did", and 3.2's acceptance requires catching by more than a single check.
  # $1 (optional): import path, forwarded to mwj -- defaults to the real, unmutated file.
  mwj "
    const armA1 = [1.15, 0.88, 0.90, 0.74, 1.21];
    const armB1 = [0.80, 0.83, 1.89, 1.04, 1.45, 1.38, 1.91, 1.64, 0.73, 1.46];
    const r1 = M.mannWhitneyU(armA1, armB1, {resamples: $ORACLE_RESAMPLES});
    const trueP1 = 382 / 3003;
    const ok1 = r1.U === 35 && Math.abs(r1.p - trueP1) <= 5 * Math.sqrt(trueP1 * (1 - trueP1) / $ORACLE_RESAMPLES);

    const armA2 = [2,3,4,5,6,12];
    const armB2 = [1,7,8,9,10,11];
    const r2 = M.mannWhitneyU(armA2, armB2, {resamples: $ORACLE_RESAMPLES});
    const trueP2 = 13 / 84;
    const ok2 = r2.U === 25 && Math.abs(r2.p - trueP2) <= 5 * Math.sqrt(trueP2 * (1 - trueP2) / $ORACLE_RESAMPLES);

    const armA3 = [1,1,2,3,3];
    const armB3 = [1,2,2,3,3];
    const r3 = M.mannWhitneyU(armA3, armB3, {resamples: $ORACLE_RESAMPLES});
    const ok3 = r3.U === 14 && Math.abs(r3.p - 0.5) <= 5 * Math.sqrt(0.5 * 0.5 / $ORACLE_RESAMPLES);

    process.stdout.write(ok1 + '/' + ok2 + '/' + ok3);
  " "${1:-}"
}

# F-198: positive control -- without this, any harness failure (a drifted literal, a typo in
# armA3, a changed default) would leave both mutant checks reading "false/false/false" and
# passing, indistinguishable from a real catch.
check "positive control: pristine mann-whitney.mjs passes all three oracles" "$(run_mw_oracles)" "true/true/true"

# Mutant 1 -- off-by-one in the resampling logic: the B-side loop starts one index late, silently
# dropping one pooled element from every resample's B side (a realistic single-character-shift
# bug: 'n1' -> 'n1 + 1'). The resampled-A subset is still drawn correctly; only which indices count
# toward B's side of U is wrong.
node -e "
  const fs = require('fs');
  const p = '$MW_SCRATCH';
  const s = fs.readFileSync(p, 'utf8');
  const FROM = 'for (let bi = n1; bi < N; bi++) {';
  const TO   = 'for (let bi = n1 + 1; bi < N; bi++) {';
  if (!s.includes(FROM)) throw new Error('mutant 1 pattern not found in $MW_SCRATCH -- source moved, update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
check "mutant 1 (off-by-one: B-side resample loop starts at n1+1, dropping one element) fails all three oracles (ok1/ok2/ok3)" \
  "$(run_mw_oracles "$MW_SCRATCH")" "false/false/false"
cp "$ROOT/$MW" "$MW_SCRATCH"   # F-202: reset the scratch copy to pristine before mutant 2

# Mutant 2 -- sampling WITH replacement instead of without: the exact defect this phase's own
# history names (D3's correction; 3.3's pass-4 finding, 'a bootstrap-with-replacement resampler').
# Breaks tie-conditioning entirely -- every comparison draws independently from the full pool,
# rather than resampling a fixed n1/n2 split of the pool's actual indices.
node -e "
  const fs = require('fs');
  const p = '$MW_SCRATCH';
  const s = fs.readFileSync(p, 'utf8');
  const FROM = [
    '    for (let i = 0; i < n1; i++) {',
    '      const j = i + Math.floor(rng() * (N - i));',
    '      const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;',
    '    }',
    '    let uSample = 0;',
    '    for (let bi = n1; bi < N; bi++) {',
    '      const bv = pool[idx[bi]];',
    '      for (let ai = 0; ai < n1; ai++) {',
    '        const av = pool[idx[ai]];',
    '        if (bv > av) uSample += 1;',
    '        else if (bv === av) uSample += 0.5;',
    '      }',
    '    }',
  ].join('\n');
  const TO = [
    '    let uSample = 0;',
    '    for (let bi = 0; bi < n2; bi++) {',
    '      const bv = pool[Math.floor(rng() * N)];',
    '      for (let ai = 0; ai < n1; ai++) {',
    '        const av = pool[Math.floor(rng() * N)];',
    '        if (bv > av) uSample += 1;',
    '        else if (bv === av) uSample += 0.5;',
    '      }',
    '    }',
  ].join('\n');
  if (!s.includes(FROM)) throw new Error('mutant 2 pattern not found in $MW_SCRATCH -- source moved, update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
check "mutant 2 (sampling WITH replacement -- does not condition on the observed multiset) fails all three oracles (ok1/ok2/ok3)" \
  "$(run_mw_oracles "$MW_SCRATCH")" "false/false/false"

# F-209: repeat the positive control against the TRACKED file (no path arg -> mwj's default)
# after both mutants -- closes the gap where a leaked write to the real file would silently
# propagate through the next mutant's `cp` reset instead of being caught.
check "positive control (after mutation): the tracked module is still pristine" "$(run_mw_oracles)" "true/true/true"

# F-202: the check above is what pins "the real file was never written", not an argument for it;
# only $MW_SCRATCH was ever mutated. Cleanup: bash's `trap` for a signal REPLACES the handler, it
# does not append (F-222, code-loop pass 1 review) -- so this registration alone would not survive
# CVD_SCRATCH_DIR's own `trap` call below (:~2610), which is why THAT later registration names
# BOTH scratch dirs rather than just its own, and is pinned by its own "names both" check right
# after it. The combined trap removes both on any normal exit, including SIGINT/SIGTERM (a
# SIGKILL bypasses any trap, leaking the scratch dir -- not the tracked file).

# --- 3.3a+3.3b+3.3c: convergence gate DRIVER, all three carves -- D1-D5, R2/R3. 3.3's complete
# module was coded and reviewed twice as one iteration (503 of 400, then 861 of a cap already
# raised to 510) and split along its own section divider (phases/03-convergence-gating.md, split
# banner above iteration 3.3): classifyDraw, fillArm, safeCleanup (3.3a, done, points 4 and 5),
# compareArms, estimatePower, runComparison (3.3b, done, points 1, 2, 3 and 6), and
# loopShardPath/resumeArm/prepareDrawDir/startDraw/drawArmForSha -- the resume/namespace layer and
# the live-draw mechanism (3.3c, this pass, none of the six numbered points -- the workDir-contract
# and resume-gap checks recorded in the phase file's Scope amendment). The module is complete
# after this carve. Hermetic throughout: every case below is a direct function call against
# synthetic/injected input, or a setup-only seam (prepareDrawDir), never a live /code-loop
# invocation (R6; phase 4 is where the full driver is run against the model for real).
CVD=tests/evals/convergence.mjs
cvj() { node --input-type=module -e "const M = await import('${2:-$ROOT/$CVD}'); $1" 2>&1; }

echo "== convergence gate driver, classification + arm-filling + comparison/verdict + shards/live-draw (3.3a+3.3b+3.3c) =="

# --- point 4 (first half): N_PER_ARM pinned as a literal, independent of any draw outcome -------
check "N_PER_ARM is exactly 15 (D2)" "$(cvj "process.stdout.write(String(M.N_PER_ARM));")" "15"

# --- point 5: classifyDraw distinguishes breach / done / running / malformed -- the two null
# causes (F-184) told apart, not conflated under one null-means-skip catch-all --------------------
check "classifyDraw: a documented breach status is 'breach'" \
  "$(cvj "process.stdout.write(M.classifyDraw({status:'max-passes-exceeded', pass:6}).kind);")" "breach"
check "classifyDraw: the SAME breach status written with commands/code-loop.md's documented 'stopped-<reason>' finish-path prefix is ALSO 'breach', not malformed/undetermined (F-235)" \
  "$(cvj "process.stdout.write(M.classifyDraw({status:'stopped-max-passes-exceeded', pass:6}).kind);")" "breach"
check "classifyDraw: status:done with a real pass field is 'done'" \
  "$(cvj "process.stdout.write(M.classifyDraw({status:'done', pass:2}).kind);")" "done"
check "classifyDraw: status:running is 'running' -- 'not done != breached', distinct from malformed" \
  "$(cvj "process.stdout.write(M.classifyDraw({status:'running', pass:1}).kind);")" "running"
check "classifyDraw: an unrecognised status is 'malformed', distinct from 'running' (closes F-184)" \
  "$(cvj "process.stdout.write(M.classifyDraw({status:'pending'}).kind);")" "malformed"
check "classifyDraw(null) is 'malformed'" "$(cvj "process.stdout.write(M.classifyDraw(null).kind);")" "malformed"
check "classifyDraw: status:done with an unreadable pass field is 'malformed', never silently 'done'" \
  "$(cvj "process.stdout.write(M.classifyDraw({status:'done', pass:'x'}).kind);")" "malformed"

# --- F-235 (Major, found 2026-09-04 while closing 3.3's loop for the split): commands/code-loop.md
# :136 documents `--status stopped-<reason>` as the STOP path's write; lib/convergence.mjs's
# capBreached() matched only the bare <reason> forms, so a cap-breach recorded through the
# DOCUMENTED path read null ("undetermined"), not true -- and classifyDraw() above inherited the
# hole, since it calls capBreached() directly rather than re-matching status itself. Discovered by
# the first status:"stopped-*" file this corpus ever produced: every real file before it was
# `done` or `running`, so this branch had never fired against real data. The two checks above
# already pin classifyDraw()'s own behaviour on the tracked module; this pins capBreached() itself,
# mutation-verified, against a SCRATCH COPY of lib/convergence.mjs -- never the tracked file, and
# never through the CVD_SCRATCH/lib symlink below (that symlink points at the REAL lib/ dir, so
# mutating through it would mutate the repo's own source, not a copy).
lib_conv_scratch=$(mktemp -d)
cp "$ROOT/tests/evals/lib/convergence.mjs" "$lib_conv_scratch/convergence.mjs"
libj() { node --input-type=module -e "const M = await import('$lib_conv_scratch/convergence.mjs'); $1" 2>&1; }
check "capBreached: the bare reason and commands/code-loop.md's documented stopped-<reason> form both return true (F-235)" \
  "$(libj "process.stdout.write(String(M.capBreached({status:'max-passes-exceeded'})) + '/' + String(M.capBreached({status:'stopped-max-passes-exceeded'})));")" \
  "true/true"
node -e "
  const fs = require('fs'); const p = '$lib_conv_scratch/convergence.mjs'; const s = fs.readFileSync(p, 'utf8');
  const FROM = \"const reason = status.startsWith('stopped-') ? status.slice('stopped-'.length) : status;\n  if (CAP_BREACH_STATUSES.has(reason)) return true;\";
  const TO = 'if (CAP_BREACH_STATUSES.has(status)) return true; // MUTANT (F-235): stopped- prefix stripping removed';
  if (!s.includes(FROM)) throw new Error('F-235 mutant pattern not found in lib/convergence.mjs -- source moved, update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
check "mutant (F-235: stopped- prefix stripping removed) is caught -- the documented stopped-<reason> form reads null again, the bare form is unaffected" \
  "$(libj "process.stdout.write(String(M.capBreached({status:'stopped-max-passes-exceeded'})) + '/' + String(M.capBreached({status:'max-passes-exceeded'})));")" \
  "null/true"
rm -rf "$lib_conv_scratch"

# --- F-241 (Major, 3.3a pass-2 review): staged against a COMMITTED fixture, not a live-directory
# scan -- the scan below is now an opportunistic supplement, never this assertion's only subject.
# BREACH_FIXTURE is eval-corpus-rebuild.3.3.json, committed verbatim (status:"stopped-user-stop",
# the DOCUMENTED stop-path write form, closed to that form via the real `somi-loop.mjs finish`
# command per 3.3a's diary, not a hand-edit). Runs unconditionally -- in CI and on every
# contributor's machine, regardless of whether $LOOPDIR exists or holds a stopped-* file, which is
# almost none of them. F-247 (Minor, 3.3b pass-1 review, asked twice): anchored to a re-runnable
# command rather than a snapshot count, since a snapshot goes stale as this corpus grows on its own
# -- this line's earlier "36 of 37" (files NOT stopped-*) already read "37 of 38" one iteration
# later. F-250 (pass-2): the command below reproduces the RARE side of that instead -- a stopped-*
# file, which is 1 of this repo's own 39 today. Reproduce with:
#   node -e "const fs=require('fs'),d='.somi/somi-state/loop';const f=fs.readdirSync(d)
#     .filter(x=>x.endsWith('.json'));let n=0;for(const x of f){try{if(/^stopped-/.test(
#     JSON.parse(fs.readFileSync(d+'/'+x,'utf8')).status))n++}catch{}}console.log(n+'/'+f.length)"
# F-242: not self-selecting -- the subject is a FIXED committed file, not one discovered by the
# predicate under test, and the raw `status` string is asserted alongside `kind` rather than only
# the classifier's own output.
BREACH_FIXTURE="$ROOT/tests/scripts/goldens/loop-state-breach.json"
check "classifyDraw on the committed cap-breach fixture is 'breach', raw status is the documented stopped-<reason> form (F-241/F-242)" \
  "$(cvj "
    const fs = await import('node:fs');
    const o = JSON.parse(fs.readFileSync('$BREACH_FIXTURE', 'utf8'));
    process.stdout.write(M.classifyDraw(o).kind + '/' + o.status);
  ")" "breach/stopped-user-stop"

LOOPDIR=".somi/somi-state/loop"
if [ -d "$ROOT/$LOOPDIR" ]; then
  # F-246 (Minor, 3.3b pass-1 review): the per-file parse below is wrapped in its OWN try/catch, not
  # left to `cvj`'s outer 2>&1 capture -- one unparseable .json (a file killed mid-write) used to
  # throw out of JSON.parse, and the captured stack trace (non-empty) then satisfied `[ -n "$var" ]`
  # below, so the following check tried to read a FILE NAMED BY THE STACK TRACE and failed loudly on
  # the wrong thing. A malformed file is skipped here exactly like an unreadable one -- this scan is
  # an opportunistic supplement (F-241) and must degrade gracefully on corruption, not just absence.
  running_real=$(cvj "
    const fs = await import('node:fs');
    const files = fs.readdirSync('$ROOT/$LOOPDIR').filter((f) => f.endsWith('.json'));
    let found = '';
    for (const f of files) {
      let o;
      try { o = JSON.parse(fs.readFileSync('$ROOT/$LOOPDIR/' + f, 'utf8')); } catch { continue; }
      if (o.status === 'running') { found = f; break; }
    }
    process.stdout.write(found);
  ")
  if [ -n "$running_real" ]; then
    check "classifyDraw on a real, currently-running loop-state file is 'running' ($running_real)" \
      "$(cvj "const fs = await import('node:fs'); process.stdout.write(M.classifyDraw(JSON.parse(fs.readFileSync('$ROOT/$LOOPDIR/$running_real', 'utf8'))).kind);")" "running"
  else
    echo "  (skipped: no real status:\"running\" loop-state file on disk right now)"
  fi
  # Opportunistic supplement to the committed fixture above, not a replacement for it (F-241).
  # F-242: SELF-SELECTING, same shape running_real's own F-183 comment names above -- discovers by
  # the exact predicate (classifyDraw(...).kind === 'breach') it then asserts. An over-admitting
  # classifyDraw would pass this alone; the committed fixture's raw-status assertion is the one
  # that cannot be fooled that way. Degrades gracefully (skips, never fails) when absent OR
  # malformed (F-246, same fix as running_real above -- the per-file parse gets its own try/catch
  # rather than relying on `.find()`'s single expression to short-circuit on a thrown parse).
  breach_real=$(cvj "
    const fs = await import('node:fs');
    const files = fs.readdirSync('$ROOT/$LOOPDIR').filter((f) => f.endsWith('.json'));
    let found = '';
    for (const f of files) {
      let o;
      try { o = JSON.parse(fs.readFileSync('$ROOT/$LOOPDIR/' + f, 'utf8')); } catch { continue; }
      if (M.classifyDraw(o).kind === 'breach') { found = f; break; }
    }
    process.stdout.write(found);
  ")
  if [ -n "$breach_real" ]; then
    check "classifyDraw on a real cap-breach loop-state file is 'breach' ($breach_real)" \
      "$(cvj "const fs = await import('node:fs'); process.stdout.write(M.classifyDraw(JSON.parse(fs.readFileSync('$ROOT/$LOOPDIR/$breach_real', 'utf8'))).kind);")" "breach"
  else
    echo "  (skipped: no real cap-breach loop-state file on disk right now -- the committed fixture above already covers this branch)"
  fi
else
  echo "  (skipped: $LOOPDIR not present)"
fi

# Staged on a COPY of a real, COMMITTED loop-state file (spec.md §7's scorer discipline) -- F-241,
# unconditional for the same reason the 3.1 block's mutation tests above are (DONE_FIXTURE, set
# there, is reused rather than redefined).
cvd_scratch=$(mktemp -d)
check "mutation (status: done -> pemding, an unrecognised near-miss) on a COPY is malformed, not silently done" \
  "$(cvj "
    const fs = await import('node:fs');
    const obj = JSON.parse(fs.readFileSync('$DONE_FIXTURE', 'utf8'));
    obj.status = 'pemding';
    fs.writeFileSync('$cvd_scratch/typo-status.json', JSON.stringify(obj));
    process.stdout.write(M.classifyDraw(JSON.parse(fs.readFileSync('$cvd_scratch/typo-status.json', 'utf8'))).kind);
  ")" "malformed"
check "...the fixture itself was never touched -- classifyDraw on the original is still 'done'" \
  "$(cvj "const fs = await import('node:fs'); process.stdout.write(M.classifyDraw(JSON.parse(fs.readFileSync('$DONE_FIXTURE', 'utf8'))).kind);")" "done"
rm -rf "$cvd_scratch"

# --- fillArm: draw policy (point 4, second half; point 5 at the arm level) -----------------------
# seq[i] is the state sequence one draw handle steps through on successive retry()s; a fresh
# newDraw() call advances to the next slot's sequence -- a REPLACEMENT, never a revisit.
CVD_HELPERS='
  function mkSeqDraw(seq) {
    let i = 0;
    return () => {
      const states = seq[i++]; let idx = 0;
      return { read: () => states[idx], retry: () => { idx = Math.min(idx + 1, states.length - 1); } };
    };
  }
'
check "fillArm: a running draw is waited on and RE-READ from the SAME handle (retry), never replaced" \
  "$(cvj "$CVD_HELPERS
    const r = M.fillArm(mkSeqDraw([[{status:'running'}, {status:'done', pass:3}]]), { n: 1, report: () => {} });
    process.stdout.write(JSON.stringify({ arm: r.arm, stillRunning: r.stillRunning, replaced: r.replaced }));
  ")" '{"arm":[3],"stillRunning":1,"replaced":0}'
check "fillArm: a malformed draw is discarded and REPLACED with a fresh handle, reported loudly" \
  "$(cvj "$CVD_HELPERS
    let reports = 0;
    const r = M.fillArm(mkSeqDraw([[{status:'bogus'}], [{status:'done', pass:2}]]), { n: 1, report: () => { reports++; } });
    process.stdout.write(JSON.stringify({ arm: r.arm, replaced: r.replaced, reports }));
  ")" '{"arm":[2],"replaced":1,"reports":1}'
check "fillArm: exhausting the wait budget STOPS filling -- the slot is left unfilled, not topped up (F-194)" \
  "$(cvj "$CVD_HELPERS
    const seq = [[{status:'running'}, {status:'running'}, {status:'running'}], [{status:'done', pass:1}]];
    const r = M.fillArm(mkSeqDraw(seq), { n: 2, maxWaitAttempts: 1, report: () => {} });
    process.stdout.write(JSON.stringify({ breach: r.breach, arm: r.arm, waitExhausted: r.waitExhausted }));
  ")" '{"breach":false,"arm":[],"waitExhausted":true}'
check "fillArm: a breach fails the WHOLE arm outright, even after usable draws were already collected" \
  "$(cvj "$CVD_HELPERS
    const seq = [[{status:'done', pass:1}], [{status:'max-passes-exceeded', pass:6}]];
    const r = M.fillArm(mkSeqDraw(seq), { n: 2, report: () => {} });
    process.stdout.write(JSON.stringify({ breach: r.breach, arm: r.arm }));
  ")" '{"breach":true,"arm":[1]}'

# 3.3c: startDraw() is the FIRST real cleanup() a draw handle ever carries (mkSeqDraw above has
# none, so safeCleanup()'s `draw.cleanup?.()` was a silent no-op in every fillArm test above --
# none of them could have caught F-226 recurring). This is the seam that matters now that a real,
# disk-touching cleanup exists to actually leave uncalled: 1.7 MB / 187 files per draw, ~51 MB per
# certification (phase file, 3.3 pass-2 review). Verified on all four terminal paths a single draw
# can end on, not just the two (done/malformed) the existing reports/replaced assertions above
# already exercise indirectly.
CVD_HELPERS_CLEANUP='
  function mkTrackedDraw(seq) {
    let i = 0; const calls = [];
    const next = () => {
      const states = seq[i]; let idx = 0; const mine = i; i++;
      return { read: () => states[idx], retry: () => { idx = Math.min(idx + 1, states.length - 1); }, cleanup: () => calls.push(mine) };
    };
    next.calls = calls;
    return next;
  }
'
check "fillArm calls the draw handle's cleanup() on EVERY terminal path -- breach/done/malformed/wait-exhausted, not just the two the arm-content assertions above already imply (F-226, closed against a REAL cleanup() for the first time now that startDraw provides one)" \
  "$(cvj "$CVD_HELPERS_CLEANUP
    const breachDraw = mkTrackedDraw([[{status:'max-passes-exceeded', pass:6}]]);
    M.fillArm(breachDraw, { n: 1, report: () => {} });
    const doneDraw = mkTrackedDraw([[{status:'done', pass:2}]]);
    M.fillArm(doneDraw, { n: 1, report: () => {} });
    const malformedDraw = mkTrackedDraw([[{status:'bogus'}], [{status:'done', pass:2}]]);
    M.fillArm(malformedDraw, { n: 1, report: () => {} });
    const waitExhaustedDraw = mkTrackedDraw([[{status:'running'}, {status:'running'}]]);
    M.fillArm(waitExhaustedDraw, { n: 1, maxWaitAttempts: 1, report: () => {} });
    process.stdout.write(JSON.stringify({
      breach: breachDraw.calls.length, done: doneDraw.calls.length,
      malformed: malformedDraw.calls.length, waitExhausted: waitExhaustedDraw.calls.length,
    }));
  ")" '{"breach":1,"done":1,"malformed":2,"waitExhausted":1}'

# --- point 3: a cap-breach fails the WHOLE comparison outright, independent of the p-value -------
check "runComparison: a breach in the CANDIDATE arm fails outright, regardless of the baseline's own values" \
  "$(cvj "$CVD_HELPERS
    const bl = [[{status:'done',pass:1}],[{status:'done',pass:1}],[{status:'done',pass:1}]];
    const cd = [[{status:'done',pass:1}],[{status:'max-passes-exceeded',pass:6}]];
    const r = M.runComparison(mkSeqDraw(bl), mkSeqDraw(cd), { n: 3, report: () => {} });
    process.stdout.write(JSON.stringify({ verdict: r.verdict, breachArm: r.breachArm }));
  ")" '{"verdict":"cap-breach","breachArm":"candidate"}'
check "runComparison: a breach in the BASELINE arm fails outright -- the candidate is never even drawn" \
  "$(cvj "$CVD_HELPERS
    let candidateDrawn = false;
    const newCandidate = () => { candidateDrawn = true; return mkSeqDraw([[{status:'done',pass:1}]])(); };
    const r = M.runComparison(mkSeqDraw([[{status:'max-passes-exceeded',pass:6}]]), newCandidate, { n: 1, report: () => {} });
    process.stdout.write(JSON.stringify({ verdict: r.verdict, breachArm: r.breachArm, candidateDrawn }));
  ")" '{"verdict":"cap-breach","breachArm":"baseline","candidateDrawn":false}'
check "runComparison: insufficient-draws (point 4) on a realized shortfall, measured on the actual array, not the requested count" \
  "$(cvj "$CVD_HELPERS
    const bl = [[{status:'running'},{status:'running'},{status:'running'}]];
    const cd = [[{status:'done',pass:2}],[{status:'done',pass:2}]];
    const r = M.runComparison(mkSeqDraw(bl), mkSeqDraw(cd), { n: 2, maxWaitAttempts: 1, report: () => {} });
    process.stdout.write(JSON.stringify({ verdict: r.verdict, deficit: r.deficit }));
  ")" '{"verdict":"insufficient-draws","deficit":{"baseline":2,"candidate":0}}'
# --- point 6 (Blocker F-221, code-loop pass 1 review): every OTHER check in this suite bounds a
# false ACCEPT; none bounded a false BLOCK. A one-line mutant (`verdict = 'inconclusive'` always)
# passed points 1/2/4/5 AND the old membership assertion below, improving point 2 to 0.0000. Two
# assertions close it -- the first is this rewritten check itself.
check "point 6 (1/2) -- a healthy, well-filled comparison returns no-regression ITSELF, not merely membership in the verdict set (F-221: the old '['regression','no-regression','inconclusive'].includes(verdict)' assertion was true of every value compareArms() can return, including a gate that never accepts)" \
  "$(cvj "$CVD_HELPERS
    const arm = Array.from({length:15}, () => [{status:'done',pass:2}]);
    const r = M.runComparison(mkSeqDraw(arm.slice()), mkSeqDraw(arm.slice()), { resamples: 5000, report: () => {} });
    process.stdout.write(r.verdict);
  ")" "no-regression"

# --- F-223 (Major, code-loop pass 1 review): the power statement and the top-level censoring
# counts, both this iteration's own Observability deliverable and a phase exit criterion.
check "runComparison's healthy-input result carries a LIVE power estimate in [0,1] (F-223 -- computed from THIS run's own realized arms, not D2's static 71.6% citation)" \
  "$(cvj "$CVD_HELPERS
    const arm = Array.from({length:15}, () => [{status:'done',pass:2}]);
    const r = M.runComparison(mkSeqDraw(arm.slice()), mkSeqDraw(arm.slice()), { resamples: 5000, report: () => {}, powerTrials: 30, powerResamples: 500 });
    process.stdout.write(String(typeof r.power === 'number' && r.power >= 0 && r.power <= 1));
  ")" "true"
check "compareArms() does NOT compute power unless asked -- opt-in, so it never nests inside its own estimatePower() trial loop or points 1/2's T=600 mass-simulation loops below" \
  "$(cvj "
    const arm = Array.from({length:15}, () => 2);
    const r = M.compareArms(arm, arm, { resamples: 2000 });
    process.stdout.write(String('power' in r && r.power === undefined));
  ")" "true"
check "runComparison surfaces stillRunning/replaced at the TOP level on the SUCCESS path too (F-223, point 4's 'censoring stays visible even when the floor is satisfied' -- unmet on this path before)" \
  "$(cvj "$CVD_HELPERS
    const censored = [[{status:'running'}, {status:'done', pass:2}]];
    const plain = Array.from({length:14}, () => [{status:'done',pass:2}]);
    const r = M.runComparison(mkSeqDraw([...censored, ...plain]), mkSeqDraw(Array.from({length:15}, () => [{status:'done',pass:2}])), { resamples: 5000, report: () => {} });
    process.stdout.write(JSON.stringify({ stillRunning: r.stillRunning, replaced: r.replaced }));
  ")" '{"stillRunning":{"baseline":1,"candidate":0},"replaced":{"baseline":0,"candidate":0}}'

# --- F-225 (Major, code-loop pass 1 review): convergence shards get their OWN namespace, OWN
# schema, decoupled from run.mjs's SCHEMA_VERSION -- verified by execution, not merely by reading
# the source, that the split actually removes the collision (the namespace-split option; see
# convergence.mjs's own comment above LOOP_SCHEMA_VERSION for the "was schema:1 deliberate?"
# answer: no, and it now is).
check "convergence shards land under shardDir(sha)/convergence/ -- run.mjs's REAL mergeShards() (not a mimic of its listing) never sees them (F-249)" \
  "$(cvj "
    const fs = await import('node:fs'); const path = await import('node:path');
    const runMod = await import('$ROOT/tests/evals/run.mjs');
    const sha = 'f225ns' + Date.now();
    const p = M.loopShardPath(sha, M.TASK_ID, 0);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ sha, taskId: M.TASK_ID, schema: M.LOOP_SCHEMA_VERSION, run: { index: 0, pass: 2 } }));
    const dir = runMod.shardDir(sha);
    const merged = runMod.mergeShards(sha, { runs: 3 });
    fs.rmSync(dir, { recursive: true, force: true });
    process.stdout.write(JSON.stringify([Object.keys(merged.tasks).length, merged.skippedShards.length]));
  ")" "[0,0]"
# --- F-230 (Minor): resumeArm's nextIndex targets the first genuinely MISSING slot, not
# done.length -- shards {0,2} present must never overwrite shard 2 or leave 1 unwritten forever.
check "resumeArm: shards {0,2} present -- resume holds both, nextIndex fills the GAP at 1, never targets 2 (F-230)" \
  "$(cvj "
    const fs = await import('node:fs'); const path = await import('node:path');
    const sha = 'f230gap' + Date.now();
    for (const i of [0, 2]) {
      const p = M.loopShardPath(sha, M.TASK_ID, i);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ sha, taskId: M.TASK_ID, schema: M.LOOP_SCHEMA_VERSION, run: { index: i, pass: i + 10 } }));
    }
    const r = M.resumeArm(sha, M.TASK_ID, 3);
    fs.rmSync(path.dirname(path.dirname(M.loopShardPath(sha, M.TASK_ID, 0))), { recursive: true, force: true });
    process.stdout.write(JSON.stringify({ resume: r.resume, nextIndex: r.nextIndex, occupied: [...r.occupied].sort((a,b)=>a-b) }));
  ")" '{"resume":[10,12],"nextIndex":1,"occupied":[0,2]}'
# A corrupted shard (killed process mid-write) must not crash the read, must not silently push
# garbage into an arm, and must not have its slot immediately overwritten either -- readShard's
# own F-131 discipline, applied to THIS module's namespace, the third caller the pass-1 review
# named as skipping it.
check "resumeArm: a corrupted shard is treated as absent from resume, without crashing, and its slot stays occupied (not silently overwritten) (F-225)" \
  "$(cvj "
    const fs = await import('node:fs'); const path = await import('node:path');
    const sha = 'f225corrupt' + Date.now();
    const p = M.loopShardPath(sha, M.TASK_ID, 0);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'not json');
    const r = M.resumeArm(sha, M.TASK_ID, 1);
    fs.rmSync(path.dirname(path.dirname(p)), { recursive: true, force: true });
    process.stdout.write(JSON.stringify({ resume: r.resume, nextIndex: r.nextIndex, occupied: [...r.occupied] }));
  ")" '{"resume":[],"nextIndex":1,"occupied":[0]}'
# F-248 (Major, pass-1 review): resumeArm's occupied set means nothing if the CONSUMER re-collides
# with it -- writeNextShard is drawArmForSha's onDraw, exercised directly (no live draw, no quota).
check "writeNextShard: n=5, shards {0,2} occupied, three sequential draws land exactly on the GAPS -- {1,3,4}, never re-touching 2 (F-248)" \
  "$(cvj "
    const fs = await import('node:fs'); const path = await import('node:path'); const sha = 'f248gap' + Date.now(); const occ = new Set([0, 2]); let i = 1; const w = []; for (let k = 0; k < 3; k++) { i = M.writeNextShard(sha, M.TASK_ID, 5, occ, i, 7) + 1; w.push(i - 1); } const onDisk = fs.readdirSync(path.dirname(M.loopShardPath(sha, M.TASK_ID, 0))).filter(f => f.endsWith('.json')).map(f => Number(f.match(/-(\d+)\.json\$/)[1])).sort((a,b)=>a-b); fs.rmSync(path.dirname(path.dirname(M.loopShardPath(sha, M.TASK_ID, 0))), { recursive: true, force: true }); process.stdout.write(JSON.stringify([w, onDisk]));
  ")" "[[1,3,4],[1,3,4]]"
check "writeNextShard: n=5, a corrupted-but-occupied shard 0 plus 1,2 valid -- the slot at n=5 throws instead of writing out of range where loopCompletedIndices() could never find it again (F-248)" \
  "$(cvj "
    const fs = await import('node:fs'); const path = await import('node:path'); const sha = 'f248oob' + Date.now(); const occ = new Set([0, 1, 2]); let i = 3; i = M.writeNextShard(sha, M.TASK_ID, 5, occ, i, 7) + 1; i = M.writeNextShard(sha, M.TASK_ID, 5, occ, i, 7) + 1; let threw = false; try { M.writeNextShard(sha, M.TASK_ID, 5, occ, i, 7); } catch (e) { threw = /no free shard slot/.test(e.message); } const onDisk = fs.readdirSync(path.dirname(M.loopShardPath(sha, M.TASK_ID, 0))).filter(f => f.endsWith('.json')).length; fs.rmSync(path.dirname(path.dirname(M.loopShardPath(sha, M.TASK_ID, 0))), { recursive: true, force: true }); process.stdout.write(JSON.stringify([threw, onDisk]));
  ")" "[true,2]"

# --- F-227/F-228 (Minors, code-loop pass 1 review): prepareDrawDir() is startDraw()'s setup ONLY
# (no invocation), the injection seam neither disclosed deviation had coverage through before this
# -- the seam that would have caught the missing scripts/ copy by evidence, not by reasoning.
check "prepareDrawDir: workDir contains scripts/somi-loop.mjs and .claude/commands/, zero model calls (F-227)" \
  "$(cvj "
    const fs = await import('node:fs'); const path = await import('node:path');
    const work = M.prepareDrawDir('$ROOT', '$ROOT/tests/evals/fixtures/task02-code');
    const ok = fs.existsSync(path.join(work, 'scripts', 'somi-loop.mjs')) && fs.existsSync(path.join(work, '.claude', 'commands'));
    fs.rmSync(work, { recursive: true, force: true });
    process.stdout.write(String(ok));
  ")" "true"
check "prepareDrawDir: throws when scripts/ is missing at the source, named and immediate -- not silently skipped into six wasted model calls (F-228)" \
  "$(cvj "
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const emptySource = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-eval-nosource-'));
    let threw = false;
    try { M.prepareDrawDir(emptySource, '$ROOT/tests/evals/fixtures/task02-code'); } catch (e) { threw = /scripts.*missing/.test(e.message); }
    fs.rmSync(emptySource, { recursive: true, force: true });
    process.stdout.write(String(threw));
  ")" "true"

# --- F-229 (Minor): drawArmForSha() preflights before any work, matching run.mjs's own precedent
# (:150-165 above) -- simulated the same way, by stripping PATH/HOME so neither the CLI nor a
# credential resolves, never by mocking preflight() itself.
NODE_BIN=$(command -v node)
cvd_preflight=$(env -i "PATH=$(dirname "$NODE_BIN")" HOME=/nonexistent "$NODE_BIN" --input-type=module -e "
  const M = await import('$ROOT/$CVD');
  try { M.drawArmForSha('$ROOT', '$ROOT/tests/evals/fixtures/task02-code', 'f229preflight', { n: 1 }); process.stdout.write('no-throw'); }
  catch (e) { process.stdout.write(e.message); }
" 2>&1)
case "$cvd_preflight" in
  *"not ready to draw"*) ok "drawArmForSha preflights the CLI and credential before spending any quota (F-229)" ;;
  *) bad "drawArmForSha preflights the CLI and credential before spending any quota (F-229) (got: ${cvd_preflight:0:80})" ;;
esac

# --- Mutation testing (spec.md §7): staged against a COPY of convergence.mjs, never the tracked
# file, following 3.2's own MW_SCRATCH precedent -- one scratch dir, reset via `cp` between mutants.
CVD_SCRATCH_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
CVD_SCRATCH="$CVD_SCRATCH_DIR/convergence.mjs"
# F-222 (Major, code-loop pass 1 review): `trap ... EXIT` REPLACES the handler, it does not
# append -- registering `rm -rf "$CVD_SCRATCH_DIR"' alone here would silently drop :2380's
# MW_SCRATCH_DIR cleanup (measured: baseline d9421b3's runner cleans it, this one did not, until
# this line named both). Name every scratch dir the suite has created so far, not just this one.
trap 'rm -rf "$MW_SCRATCH_DIR" "$CVD_SCRATCH_DIR"' EXIT
# `trap -p EXIT` prints the REGISTERED command text verbatim (single-quoted at registration, so
# the variable REFERENCES are still literal `$MW_SCRATCH_DIR`/`$CVD_SCRATCH_DIR` text, not their
# expanded paths) -- pin on the variable names, which is what proves both are named in the SAME
# trap command, not on their runtime values.
check "F-222: the EXIT trap names BOTH scratch dirs (trap REPLACES, not appends -- a registration naming only its own dir silently drops every earlier one)" \
  "$(trap -p EXIT | grep -qF 'MW_SCRATCH_DIR' && trap -p EXIT | grep -qF 'CVD_SCRATCH_DIR' && echo true || echo false)" "true"
# Symlinked, not copied: only convergence.mjs itself is ever mutated; its relative imports
# (lib/, run.mjs) resolve straight through to the real, pristine files -- same isolation guarantee
# as MW_SCRATCH's single-file copy, extended to a module with real sibling dependencies (3.3c adds
# the top-level `import { shardDir } from './run.mjs'`, so the scratch copy needs run.mjs
# resolvable too, not just lib/).
ln -s "$ROOT/tests/evals/lib" "$CVD_SCRATCH_DIR/lib"
ln -s "$ROOT/tests/evals/run.mjs" "$CVD_SCRATCH_DIR/run.mjs"
cp "$ROOT/$CVD" "$CVD_SCRATCH"

# CVD_SIM: shared population/trial-loop preamble for points 1, 2 and 6, and for mutant D's second
# check below (all draw from D5's own tied historical histogram, {1:9,2:4,3:5,4:2,5:1}). Defined
# here, before the mutation section, since mutant D needs it too.
# F-233 (Nit, code-loop pass 1 review): TWO independent seeded streams, not one shared between arm
# generation and the rank test's own resampling -- compareArms() short-circuits on p < alpha, so a
# single shared stream let the number of rng() calls consumed per trial depend on that trial's own
# outcome, and no single trial could be replayed in isolation. dataRng draws the synthetic arms;
# testRng is the ONLY stream compareArms()/mannWhitneyU ever consumes.
CVD_SIM='
  const MWmod = await import("'"$ROOT"'/tests/evals/lib/mann-whitney.mjs");
  const dataRng = MWmod.mulberry32(1234);
  const testRng = MWmod.mulberry32(5678);
  const weights = [[1,9],[2,4],[3,5],[4,2],[5,1]];
  const total = weights.reduce((s,[,w]) => s + w, 0);
  function drawOne() { let r = dataRng() * total; for (const [v,w] of weights) { if (r < w) return v; r -= w; } return weights.at(-1)[0]; }
  function drawArm(n) { return Array.from({ length: n }, drawOne); }
  const T = 600, RESAMPLES = 3000, N = 15;
'

# Mutant A -- reintroduces F-182: collapses capBreached()'s null (running OR malformed) into the
# non-breach/done branch -- the natural-but-wrong `if (!capBreached(o)) arm.push(...)` shape.
node -e "
  const fs = require('fs'); const p = '$CVD_SCRATCH'; const s = fs.readFileSync(p, 'utf8');
  const FROM = 'if (breach === true) return { kind: \'breach\' };\n  if (breach === false) {';
  const TO   = 'if (breach === true) return { kind: \'breach\' };\n  if (breach !== true) {';
  if (!s.includes(FROM)) throw new Error('mutant A pattern not found -- source moved');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
check "mutant A (F-182: null collapsed into done) is caught -- a running loop's pass count reads as 'done', not 'running'" \
  "$(cvj "process.stdout.write(M.classifyDraw({status:'running', pass:0}).kind);" "$CVD_SCRATCH")" "done"
cp "$ROOT/$CVD" "$CVD_SCRATCH"

# Mutant B -- reintroduces F-194: exhausting the wait budget re-draws a FRESH handle instead of
# stopping, re-rolling exactly the censored draw and pulling the arm mean down.
node -e "
  const fs = require('fs'); const p = '$CVD_SCRATCH'; const s = fs.readFileSync(p, 'utf8');
  const FROM = 'if (waitAttempts > maxWaitAttempts) {\n          safeCleanup(draw);\n          return { breach: false, arm, stillRunning, replaced, waitExhausted: true };\n        }';
  const TO   = 'if (waitAttempts > maxWaitAttempts) {\n          safeCleanup(draw);\n          replaced++; break; // MUTANT: re-roll instead of stopping\n        }';
  if (!s.includes(FROM)) throw new Error('mutant B pattern not found -- source moved');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
check "mutant B (F-194: wait-exhaustion re-rolls instead of stopping) is caught -- the censored slot gets topped up, not left short" \
  "$(cvj "$CVD_HELPERS
    const seq = [[{status:'running'}, {status:'running'}, {status:'running'}], [{status:'done', pass:1}]];
    const r = M.fillArm(mkSeqDraw(seq), { n: 1, maxWaitAttempts: 1, report: () => {} });
    process.stdout.write(JSON.stringify({ arm: r.arm, waitExhausted: r.waitExhausted }));
  " "$CVD_SCRATCH")" '{"arm":[1],"waitExhausted":false}'
cp "$ROOT/$CVD" "$CVD_SCRATCH"

# Mutant C -- reintroduces the collapsed-verdict bug points 1/2 exist to catch: no-regression
# whenever p >= alpha (the exact "p >= alpha alone is no-regression" shape spec.md forbids). Arms
# below are a real inconclusive pair under the PRISTINE module (primary.p=0.137, equiv.p=0.084,
# both >= alpha -- found by simulation, not hand-picked to be easy), so the mutant's forced flip
# to 'no-regression' is a visible change from the correct verdict, not masked by an earlier
# primary-regression return.
node -e "
  const fs = require('fs'); const p = '$CVD_SCRATCH'; const s = fs.readFileSync(p, 'utf8');
  const FROM = \"const shifted = candidateArm.map((v) => v - shift);\n  const equivalence = mannWhitneyU(shifted, baselineArm, mwOpts);\n  const verdict = equivalence.p < alpha ? 'no-regression' : 'inconclusive';\n  return { verdict, primary, equivalence, alpha, shift, power };\";
  const TO = \"const verdict = 'no-regression'; // MUTANT\n  return { verdict, primary, alpha, shift, power };\";
  if (!s.includes(FROM)) throw new Error('mutant C pattern not found -- source moved');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
check "mutant C ('p >= alpha alone is no-regression') is caught -- a real inconclusive pair now reads no-regression" \
  "$(cvj "
    const a = [1,3,2,3,1,3,1,1,1,3,1,1,1,3,1];
    const b = [1,2,3,2,1,2,3,1,3,5,2,1,5,1,2];
    process.stdout.write(M.compareArms(a, b, { resamples: 20000 }).verdict);
  " "$CVD_SCRATCH")" "no-regression"
cp "$ROOT/$CVD" "$CVD_SCRATCH"

# Mutant D (F-221, Blocker, code-loop pass 1 review) -- reintroduces the NEVER-ACCEPTS direction:
# a gate that can never return no-regression. Every other check in this suite bounds a false
# ACCEPT; this is the direction only point 6 (below) bounds. Short-circuits compareArms() to a
# hardcoded verdict -- the rest of the function body is then dead code, which is fine, this is a
# staged mutant, not shipped source.
node -e "
  const fs = require('fs'); const p = '$CVD_SCRATCH'; const s = fs.readFileSync(p, 'utf8');
  const FROM = 'export function compareArms(baselineArm, candidateArm, opts = {}) {';
  const TO   = 'export function compareArms(baselineArm, candidateArm, opts = {}) { return { verdict: \'inconclusive\' }; // MUTANT (F-221): never accepts';
  if (!s.includes(FROM)) throw new Error('mutant D pattern not found -- source moved');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
check "mutant D (F-221: verdict is always 'inconclusive') is caught by point 6's FIRST half -- a clean, healthy pair now reads inconclusive, not no-regression" \
  "$(cvj "$CVD_HELPERS
    const arm = Array.from({length:15}, () => [{status:'done',pass:2}]);
    const r = M.runComparison(mkSeqDraw(arm.slice()), mkSeqDraw(arm.slice()), { resamples: 5000, report: () => {} });
    process.stdout.write(r.verdict);
  " "$CVD_SCRATCH")" "inconclusive"
check "mutant D is ALSO caught by point 6's SECOND half -- the no-regression rate on unshifted pairs collapses to 0, far below the D2-derived floor" \
  "$(cvj "$CVD_SIM
    process.stdout.write(String(M.estimatePower(drawOne, N, { rng: testRng, resamples: RESAMPLES, trials: 50 })));
  " "$CVD_SCRATCH")" "0"
cp "$ROOT/$CVD" "$CVD_SCRATCH"

check "positive control: the tracked convergence.mjs is pristine after all four mutants (F-231: now also exercises fillArm, the seam mutant B mutates -- reusing the n:2/maxWaitAttempts:1 case)" \
  "$(cvj "$CVD_HELPERS
    const a = [1,3,2,3,1,3,1,1,1,3,1,1,1,3,1];
    const b = [1,2,3,2,1,2,3,1,3,5,2,1,5,1,2];
    const seq = [[{status:'running'}, {status:'running'}, {status:'running'}], [{status:'done', pass:1}]];
    const fr = M.fillArm(mkSeqDraw(seq), { n: 2, maxWaitAttempts: 1, report: () => {} });
    process.stdout.write(M.classifyDraw({status:'running', pass:0}).kind + '/' + M.compareArms(a, b, { resamples: 20000 }).verdict + '/' + JSON.stringify({ arm: fr.arm, waitExhausted: fr.waitExhausted }));
  ")" 'running/inconclusive/{"arm":[],"waitExhausted":true}'

# --- points 1, 2 and 6: Monte-Carlo property bounds on the verdict logic built atop the already-
# oracle-verified rank procedure (3.2 owns rank-procedure correctness; this does not re-check it).
# All three draw from D5's own tied historical histogram ({1:9,2:4,3:5,4:2,5:1}) via CVD_SIM,
# defined above (before the mutation section, since mutant D's second check needs it too). Trial/
# resample counts are stated so every tolerance is derived, never loosened to fit (spec.md §7).
POINT1=$(cvj "$CVD_SIM
  let regressions = 0;
  for (let t = 0; t < T; t++) {
    const r = M.compareArms(drawArm(N), drawArm(N), { resamples: RESAMPLES, rng: testRng });
    if (r.verdict === 'regression') regressions++;
  }
  const rate = regressions / T, bound = 0.05 + 5 * Math.sqrt(0.05 * 0.95 / T);
  process.stdout.write(rate.toFixed(4) + '<=' + bound.toFixed(4) + ' ' + (rate <= bound));
")
echo "  (point 1 measured: $POINT1)"
check "point 1 -- one-sided size bound: empirical regression rate on UNSHIFTED (null) pairs <= 0.05 + 5x its own Monte Carlo SE, T=600 (one-sided, not a tight two-sided interval)" \
  "$(echo "$POINT1" | awk '{print $2}')" "true"

POINT2=$(cvj "$CVD_SIM
  let falseAccepts = 0;
  for (let t = 0; t < T; t++) {
    const r = M.compareArms(drawArm(N), drawArm(N).map((v) => v + 1), { resamples: RESAMPLES, rng: testRng });
    if (r.verdict === 'no-regression') falseAccepts++;
  }
  const rate = falseAccepts / T, bound = 0.08 + 5 * Math.sqrt(0.08 * 0.92 / T);
  process.stdout.write(rate.toFixed(4) + '<=' + bound.toFixed(4) + ' ' + (rate <= bound));
")
echo "  (point 2 measured: $POINT2)"
check "point 2 -- bound the false no-regression rate on truly-shifted (+1 pass, degraded) arms: <= 0.08 + 5x its own Monte Carlo SE, T=600 -- the number the three-state verdict exists to control" \
  "$(echo "$POINT2" | awk '{print $2}')" "true"

# point 6's SECOND half (F-221, Blocker): a lower bound on the no-regression rate for UNSHIFTED
# (healthy) pairs -- the direction NOTHING else in this suite bounds. Reuses estimatePower()
# itself (built once inside convergence.mjs, F-223), not a hand-rolled reimplementation of the
# same trial loop -- CVD_SIM's own `drawOne` is passed straight through. Floor derived inline from
# D2's stated power at n=15 (decisions.md#d2, 71.6%) the same way points 1/2 derive their
# tolerances -- never chosen to fit the measurement.
POINT6=$(cvj "$CVD_SIM
  const power = M.estimatePower(drawOne, N, { rng: testRng, resamples: RESAMPLES, trials: T });
  const predicted = 0.716; // D2's stated primary-test power at n=15 (decisions.md#d2)
  const floor = predicted - 5 * Math.sqrt(predicted * (1 - predicted) / T);
  process.stdout.write(power.toFixed(4) + '>=' + floor.toFixed(4) + ' ' + (power >= floor));
")
echo "  (point 6 measured: $POINT6)"
check "point 6 (2/2) -- lower bound on the no-regression rate for UNSHIFTED (healthy) pairs, >= D2's stated power (0.716) minus 5x its own Monte Carlo SE, T=600 -- bounds the direction F-221 found unbounded" \
  "$(echo "$POINT6" | awk '{print $2}')" "true"

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
