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
res=$( j "
  const s = M.resolveSource('HEAD');
  const fs = await import('node:fs');
  const had = fs.existsSync(s.dir) && fs.existsSync(s.dir + '/package.json');
  s.cleanup();
  const gone = !fs.existsSync(s.dir);
  process.stdout.write(s.sha + '|' + had + '|' + gone);
")
check "--source HEAD checks out a worktree and cleans it up" "$res" "$head_sha|true|true"
check "no worktree is left registered" "$(git worktree list | grep -c somi-eval-src || true)" "0"

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
# Live scoring is 3.4b. Until then a non-dry run must refuse, not silently produce empty grades.
if node "$R" --source HEAD --tasks 01 --runs 1 --out "$out" >/dev/null 2>&1; then
  bad "a non-dry run refuses until 3.4b lands"
else
  ok "a non-dry run refuses until 3.4b lands"
fi
rm -f "$out"

# --- npm test must not invoke this runner ------------------------------------------------------
# Structural, per phase 3's exit criteria: a `node --check` glob merely NAMING the directory is
# explicitly permitted; what is forbidden is executing it.
if grep -nE '(node|bash)[^|]*tests/evals/run\.mjs' scripts/validate.sh package.json >/dev/null 2>&1; then
  bad "neither validate.sh nor package.json executes the eval runner"
else
  ok "neither validate.sh nor package.json executes the eval runner"
fi

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
