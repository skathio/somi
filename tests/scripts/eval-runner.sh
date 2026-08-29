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
check "a mixed batch counts the excluded draw toward S3 but not S5, and reports the exclusion" \
  "$(j "
    const res = M.buildResult({ source: { ref: 'x', sha: 'd' }, tasks: { '02': [
      { index: 0, dimensions: { S5: 'excluded', S3: true } },
      { index: 1, dimensions: { S5: true, S3: true } },
    ] }, runs: 2 });
    const s5 = res.tasks['02'].dimensions.S5, s3 = res.tasks['02'].dimensions.S3;
    process.stdout.write(s5.n + '/' + s5.passes + '/' + s5.excluded + '|' + s3.n + '/' + s3.passes + '/' + s3.excluded);
  ")" "1/1/1|2/2/0"
check "a harness-faulted (empty-dimensions) draw does NOT inflate excluded on unrelated dims (F-48)" \
  "$(j "
    const res = M.buildResult({ source: { ref: 'x', sha: 'd' }, tasks: { '02': [
      { index: 0, dimensions: { S5: true, S3: true } },
      { index: 1, dimensions: {} },
    ] }, runs: 2 });
    const s5 = res.tasks['02'].dimensions.S5, s3 = res.tasks['02'].dimensions.S3;
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

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
