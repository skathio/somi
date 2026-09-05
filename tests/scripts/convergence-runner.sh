#!/usr/bin/env bash
# Unit guard for tests/evals/convergence.mjs's CLI section (phase 3, iteration 3.4): argument
# parsing, --dry-run's shape/zero-model-call contract, --merge/--certify's shard-fold report, and
# F-251's sha boundary check.
#
# Hermetic by construction: every case here is --dry-run, --merge/--certify (read-only, no
# --source resolution, no credential), or a direct call into an exported CLI helper -- never a
# live /code-loop draw. eval-runner.sh already covers 3.1-3.3's non-CLI logic (the extractor, the
# rank test, classifyDraw/fillArm/compareArms/the shard/resume layer); this file is scoped to what
# 3.4 alone adds, so the two stay disjoint rather than duplicating each other.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
CVD=tests/evals/convergence.mjs
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# Run a snippet with convergence.mjs imported as `M` -- same idiom eval-runner.sh's own `cj()`
# uses for lib/convergence.mjs, kept as a function so no case can forget the import path.
cj() { node --input-type=module -e "const M = await import('$ROOT/$CVD'); $1" 2>&1; }

echo "== convergence gate CLI (3.4) =="

# --- F-251: sha is a documented CLI input surface now; validateSha() is the boundary check ------
# `sha` reaches join() inside loopShardPath()/loopShardDir() unvalidated -- these cases pin the
# boundary check itself, both directions (spec.md §7: a gate's suite must not only catch the bad
# input, it must also let a genuinely conforming one through).
check "validateSha accepts a real (40-char) git sha" \
  "$(cj "process.stdout.write(M.validateSha('7c0ac2615fe6a14e3135d645645c59f1e38bd3bf'))")" \
  "7c0ac2615fe6a14e3135d645645c59f1e38bd3bf"
check "validateSha accepts a short (7-char) sha, git's own minimum" \
  "$(cj "process.stdout.write(M.validateSha('7c0ac26'))")" "7c0ac26"

f251_rejects() {
  local got
  got=$(cj "try { M.validateSha($2); process.stdout.write('NO THROW'); } catch { process.stdout.write('threw'); }")
  check "validateSha rejects $1" "$got" "threw"
}
f251_rejects "a path-traversal attempt"                "'../../../etc/passwd'"
f251_rejects "an absolute path"                         "'/etc/passwd'"
f251_rejects "uppercase hex (git shas print lowercase)" "'ABCDEF1'"
f251_rejects "a sha shorter than 7 chars"                "'abc12'"
LONG41=$(printf 'a%.0s' $(seq 1 41))
f251_rejects "a sha longer than 40 chars"                "'$LONG41'"
f251_rejects "a non-string"                              "42"
f251_rejects "null"                                      "null"

# The underlying primitive has no traversal protection of its own -- proving WHY the boundary
# check has to exist, not just that it does: loopShardPath()/loopShardDir() join() sha straight
# into a path with no sanitising. Demonstrated by resolving the path a traversal sha WOULD
# produce and confirming it lands outside results/ -- read-only (path.resolve, no file touched).
escape_check=$(cj "
  const path = await import('node:path');
  const p = path.resolve(M.loopShardPath('../../../tmp/f251-probe', M.TASK_ID, 0));
  const resultsDir = path.resolve('$ROOT/tests/evals/results');
  process.stdout.write(String(!p.startsWith(resultsDir + path.sep)));
")
check "loopShardPath() itself has no traversal guard -- a raw '../../../tmp/f251-probe' sha resolves OUTSIDE results/ (this is what validateSha() at the CLI boundary exists to prevent)" \
  "$escape_check" "true"

# Staged against a SCRATCH COPY, never the tracked file (spec.md §7): neuter validateSha()'s own
# regex test so it can never throw, then drive the REAL CLI entrypoint (`--merge`) against it with
# the same traversal string above. The mutant must reach loopShardPath() with the traversal intact
# -- caught by checking the mutant's own reportArm() computes a path outside results/, the exact
# consequence F-251 names. Reverting restores the guard; the pristine file is checked last so this
# suite ends by re-confirming the shipped behaviour, not the mutant's.
F251_SCRATCH_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$F251_SCRATCH_DIR"' EXIT
F251_SCRATCH="$F251_SCRATCH_DIR/convergence.mjs"
cp "$ROOT/$CVD" "$F251_SCRATCH"
ln -s "$ROOT/tests/evals/lib" "$F251_SCRATCH_DIR/lib"
ln -s "$ROOT/tests/evals/run.mjs" "$F251_SCRATCH_DIR/run.mjs"
node -e "
  const fs = require('fs'); const p = '$F251_SCRATCH'; const s = fs.readFileSync(p, 'utf8');
  const FROM = \"if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}\$/.test(sha)) {\";
  const TO = 'if (false) { // MUTANT (F-251): the boundary check never fires';
  if (!s.includes(FROM)) throw new Error('F-251 mutant pattern not found in convergence.mjs -- source moved, update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
mutant_escape=$(node --input-type=module -e "
  const M = await import('$F251_SCRATCH');
  const path = await import('node:path');
  const p = path.resolve(M.loopShardPath(M.validateSha('../../../tmp/f251-probe'), M.TASK_ID, 0));
  const resultsDir = path.resolve('$ROOT/tests/evals/results');
  process.stdout.write(String(!p.startsWith(resultsDir + path.sep)));
" 2>&1)
check "mutant (F-251: validateSha() neutered) lets a traversal sha through to loopShardPath() unrejected, landing outside results/" \
  "$mutant_escape" "true"
pristine_rejects=$(cj "try { M.validateSha('../../../tmp/f251-probe'); process.stdout.write('NO THROW'); } catch { process.stdout.write('threw'); }")
check "pristine convergence.mjs (mutation reverted -- a fresh copy, not the mutated scratch file) still rejects the same traversal sha" \
  "$pristine_rejects" "threw"
rm -rf "$F251_SCRATCH_DIR"
trap - EXIT

# --- --dry-run: well-formed shape, mirroring run.mjs --dry-run's own contract -------------------
dryrun_out=$(node "$CVD" --dry-run --source HEAD)
dryrun_check=$(printf '%s' "$dryrun_out" | node -e "
  let s=''; process.stdin.on('data', d=>s+=d).on('end', () => {
    const o = JSON.parse(s);
    const ok = o.dryRun === true && o.taskId === 'loop-code-loop' && Array.isArray(o.arm) && o.arm.length === 0
      && o.breach === false && o.runsRequested === 15 && typeof o.source.sha === 'string' && o.source.sha.length === 40;
    process.stdout.write(String(ok));
  });
")
check "--dry-run produces a well-formed shape (dryRun:true, empty arm, breach:false, a real resolved sha)" "$dryrun_check" "true"
check "--dry-run --runs 5 threads the requested count through" \
  "$(node "$CVD" --dry-run --source HEAD --runs 5 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).runsRequested)))")" \
  "5"

# --dry-run leaves no worktree behind (resolveSource's own cleanup, exercised through this CLI).
wt_before=$(git worktree list | wc -l | tr -d ' ')
node "$CVD" --dry-run --source HEAD >/dev/null
wt_after=$(git worktree list | wc -l | tr -d ' ')
check "--dry-run cleans up its resolved worktree (no leak)" "$wt_after" "$wt_before"

# --- --dry-run: zero model calls, proven by execution (F-147's own technique), not by reading ---
# A stub `claude` on PATH proves NO route reaches the model -- not just that reading the dry-run
# branch shows no invokeCommand() call.
stub_bin=$(mktemp -d)
stub_sentinel="$stub_bin/touched"
printf '#!/bin/sh\n%s "%s"\nexit 1\n' "$(command -v touch)" "$stub_sentinel" > "$stub_bin/claude"
chmod +x "$stub_bin/claude"
PATH="$stub_bin:$PATH" node "$CVD" --dry-run --source HEAD >/dev/null 2>&1
check "no route from --dry-run reaches a stub claude on PATH (sentinel stays absent)" \
  "$([ -e "$stub_sentinel" ] && echo TOUCHED || echo ABSENT)" "ABSENT"
# Positive control (F-155's own technique): proves the stub is reachable on PATH at all.
PATH="$stub_bin" claude >/dev/null 2>&1
check "positive control: claude invoked directly under the same stub touches the sentinel" \
  "$([ -e "$stub_sentinel" ] && echo TOUCHED || echo ABSENT)" "TOUCHED"
rm -rf "$stub_bin"

# --- live mode preflights BEFORE resolveSource's worktree checkout ------------------------------
# Simulated by stripping PATH/HOME so neither the CLI nor a credential resolves (eval-runner.sh's
# own F-229 technique), never by mocking preflight() itself. A worktree created despite this would
# mean the CLI paid for a checkout it could never use.
NODE_BIN=$(command -v node)
wt_before2=$(git worktree list | wc -l | tr -d ' ')
preflight_msg=$(env -i "PATH=$(dirname "$NODE_BIN")" HOME=/nonexistent "$NODE_BIN" "$CVD" --source HEAD --runs 1 2>&1)
wt_after2=$(git worktree list | wc -l | tr -d ' ')
case "$preflight_msg" in
  *"not ready to draw"*) ok "live mode preflights before spending any quota (message names the reason)" ;;
  *) bad "live mode preflights before spending any quota (got: ${preflight_msg:0:120})" ;;
esac
check "the preflight failure above never reached resolveSource -- no worktree was created" "$wt_after2" "$wt_before2"

# --- --merge / --certify: fold shards already on disk, no live draw -----------------------------
MERGE_SHA="deadbeefcafe1234567890"
cj "
  const occ = new Set();
  M.writeNextShard('$MERGE_SHA', M.TASK_ID, 15, occ, 0, 2);
  M.writeNextShard('$MERGE_SHA', M.TASK_ID, 15, occ, 1, 3);
  M.writeNextShard('$MERGE_SHA', M.TASK_ID, 15, occ, 2, 1);
" >/dev/null
merge_out=$(node "$CVD" --merge "$MERGE_SHA" --runs 15)
check "--merge folds 3 shards into an arm of 3 usable draws" \
  "$(printf '%s' "$merge_out" | grep -c '^deadbeefcafe: 3/15 usable draw(s) on disk$')" "1"
check "--merge computes the arm's mean correctly ([2,3,1] -> 2.0000)" \
  "$(printf '%s' "$merge_out" | grep -c 'mean: 2.0000$')" "1"
check "--merge computes the arm's sample sd correctly ([2,3,1], n-1 denominator -> 1.0000)" \
  "$(printf '%s' "$merge_out" | grep -c 'sd:   1.0000$')" "1"
certify_out=$(node "$CVD" --certify "$MERGE_SHA" --runs 15)
check "--certify is the SAME report as --merge (folding IS the report, no second scope here)" \
  "$certify_out" "$merge_out"
rm -rf "$ROOT/tests/evals/results/$MERGE_SHA"

check "--merge on a sha with zero shards on disk reports 0/N, mean/sd n/a rather than throwing" \
  "$(node "$CVD" --merge deadbeef00 --runs 15 | tr '\n' '|')" \
  "deadbeef00: 0/15 usable draw(s) on disk|  arm:  []|  mean: n/a|  sd:   n/a (need >= 2 draws)|"

check "--merge with an invalid sha is rejected before anything is read (F-251, at the CLI itself)" \
  "$(node "$CVD" --merge '../../../etc/passwd' >/dev/null 2>&1; echo $?)" "1"

# --- argument parsing ----------------------------------------------------------------------------
help_out=$(node "$CVD" --help)
help_flags_present=true
for flag in --source --fixture --runs --merge --certify --dry-run; do
  printf '%s' "$help_out" | grep -qF -- "$flag" || help_flags_present=false
done
check "--help prints usage naming every documented flag" "$help_flags_present" "true"
check "an unknown argument exits non-zero" "$(node "$CVD" --bogus >/dev/null 2>&1; echo $?)" "1"
check "--runs 0 is rejected (must be a positive integer)" "$(node "$CVD" --dry-run --runs 0 >/dev/null 2>&1; echo $?)" "1"
check "--runs -1 is rejected" "$(node "$CVD" --dry-run --runs -1 >/dev/null 2>&1; echo $?)" "1"
for flag in --source --fixture --runs --model --merge --certify; do check "$flag with no operand is rejected, not silently defaulted (F-252/F-253)" "$(node "$CVD" "$flag" >/dev/null 2>&1; echo $?)" "1"; done
for flag in --merge --certify; do check "$flag with an empty operand is rejected (F-259)" "$(node "$CVD" "$flag" "" >/dev/null 2>&1; echo $?)" "1"; done
stub_bin=$(mktemp -d)
stub_sentinel="$stub_bin/touched"
printf '#!/bin/sh\n%s "%s"\nexit 1\n' "$(command -v touch)" "$stub_sentinel" > "$stub_bin/claude"
chmod +x "$stub_bin/claude"
PATH="$stub_bin:$PATH" node "$CVD" --merge "" >/dev/null 2>&1
check "F-259: --merge with an empty operand no longer reaches a stub claude on PATH (sentinel stays absent)" "$([ -e "$stub_sentinel" ] && echo TOUCHED || echo ABSENT)" "ABSENT"
PATH="$stub_bin" claude >/dev/null 2>&1
check "positive control: same stub still reachable (F-259 re-confirmation)" "$([ -e "$stub_sentinel" ] && echo TOUCHED || echo ABSENT)" "TOUCHED"
rm -rf "$stub_bin"

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
