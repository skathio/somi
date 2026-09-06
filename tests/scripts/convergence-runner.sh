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
#
# Exception (phase 4, iteration 4.1 pass 2, F-267): terminalVerdict()/writeNextShard()'s new
# `verdict` param/makeShardWriter() are shard/resume-layer additions, eval-runner.sh's stated home
# -- pinned here instead because this pass's own scope is exactly these three files, not
# eval-runner.sh. Still fully hermetic (synthetic loop-state objects and scratch shas only, per
# this pass's own instruction not to spend a live draw), so it belongs with everything else in
# this file that shares that property, disjointness convention notwithstanding.
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

# --- F-267: shards carry the loop's terminal verdict alongside its pass count -------------------
# Phase 4 iteration 4.1's first live batch (diary.md, 2026-09-05) showed task02-code sitting at
# the pass-count floor (arm [1,1,1], mean 1.0, sd 0.0) with no retained artifact able to say WHY
# -- the shard carried only `pass`, and cleanup() (F-226) correctly destroys the workDir the
# instant a draw completes. terminalVerdict() (lib/convergence.mjs) is the read side;
# writeNextShard()'s new `verdict` param and makeShardWriter() (this module) are the write side
# that threads it into the shard.
LCONV=tests/evals/lib/convergence.mjs
lj() { node --input-type=module -e "const L = await import('$ROOT/$LCONV'); $1" 2>&1; }

# terminalVerdict() fails safe, same posture as passesToApprove()/capBreached() -- those two's own
# extractor-level tests live in eval-runner.sh's "3.1" section; terminalVerdict() is pinned here
# instead per this file's own F-267 exception above.
check "terminalVerdict(null) is null (fails safe)" \
  "$(lj "process.stdout.write(String(L.terminalVerdict(null)));")" "null"
check "terminalVerdict(undefined) is null" \
  "$(lj "process.stdout.write(String(L.terminalVerdict(undefined)));")" "null"
check "terminalVerdict(42) is null (non-object input, not coerced)" \
  "$(lj "process.stdout.write(String(L.terminalVerdict(42)));")" "null"
check "terminalVerdict({}) is null (no history field at all -- the three real F-266 shards' own shape, pre-F-267)" \
  "$(lj "process.stdout.write(String(L.terminalVerdict({})));")" "null"
check "terminalVerdict({history:[]}) is null (empty history)" \
  "$(lj "process.stdout.write(String(L.terminalVerdict({history:[]})));")" "null"
check "terminalVerdict({history:'nope'}) is null (history not an array, not coerced)" \
  "$(lj "process.stdout.write(String(L.terminalVerdict({history:'nope'})));")" "null"
check "terminalVerdict({history:[{pass:1}]}) is null (entry present, no verdict field)" \
  "$(lj "process.stdout.write(String(L.terminalVerdict({history:[{pass:1}]})));")" "null"
check "terminalVerdict({history:[{verdict:7}]}) is null (verdict not a string, not coerced)" \
  "$(lj "process.stdout.write(String(L.terminalVerdict({history:[{verdict:7}]})));")" "null"
check "terminalVerdict on a single-pass history returns that pass's verdict" \
  "$(lj "process.stdout.write(String(L.terminalVerdict({history:[{pass:1,verdict:'approve'}]})));")" "approve"
check "terminalVerdict on a two-pass history returns the LAST entry's verdict, not the first -- 'terminal', not 'initial'" \
  "$(lj "process.stdout.write(String(L.terminalVerdict({history:[{pass:1,verdict:'request-changes'},{pass:2,verdict:'approve'}]})));")" "approve"

# Mutation: prove the "LAST, not first" assertion above can actually fail. Staged on a scratch
# copy (mktemp -d), never the tracked file.
F267_MUT_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$F267_MUT_DIR"' EXIT
F267_MUT="$F267_MUT_DIR/convergence.mjs"
cp "$ROOT/$LCONV" "$F267_MUT"
node -e "
  const fs = require('fs'); const p = '$F267_MUT'; const s = fs.readFileSync(p, 'utf8');
  const FROM = 'const last = history[history.length - 1];';
  const TO = 'const last = history[0]; // MUTANT (F-267): reads the FIRST pass, not the terminal one';
  if (!s.includes(FROM)) throw new Error('F-267 mutant pattern not found in lib/convergence.mjs -- source moved, update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
mutant_verdict=$(node --input-type=module -e "
  const L = await import('$F267_MUT');
  process.stdout.write(String(L.terminalVerdict({history:[{pass:1,verdict:'request-changes'},{pass:2,verdict:'approve'}]})));
")
check "mutant (F-267: terminalVerdict reads history[0]) returns the FIRST verdict ('request-changes'), catching the exact regression the 'LAST, not first' test above exists for" \
  "$mutant_verdict" "request-changes"
pristine_verdict=$(lj "process.stdout.write(String(L.terminalVerdict({history:[{pass:1,verdict:'request-changes'},{pass:2,verdict:'approve'}]})));")
check "pristine lib/convergence.mjs (mutation reverted -- a fresh copy, not the mutated scratch file) still returns the terminal verdict ('approve')" \
  "$pristine_verdict" "approve"
rm -rf "$F267_MUT_DIR"
trap - EXIT

# --- F-268: terminalVerdict() alone can't tell a real coder/reviewer round trip from a loop that
# approved an untouched tree ({pass:1, verdict:'approve'} is exactly what a do-nothing loop would
# also write) -- terminalOutcome() widens the extraction to the whole terminal entry. Same
# fail-safe posture, each field independently null -- a missing count reads as "unknown", not 0.
check "terminalOutcome(null) is null (fails safe)" \
  "$(lj "process.stdout.write(String(L.terminalOutcome(null)));")" "null"
check "terminalOutcome({}) is null (no history -- the three real F-266 shards' own shape)" \
  "$(lj "process.stdout.write(String(L.terminalOutcome({})));")" "null"
check "terminalOutcome({history:[]}) is null (empty history)" \
  "$(lj "process.stdout.write(String(L.terminalOutcome({history:[]})));")" "null"
check "terminalOutcome extracts all four fields from the TERMINAL (not first) entry" \
  "$(lj "process.stdout.write(JSON.stringify(L.terminalOutcome({history:[{pass:1,verdict:'request-changes',blockers:2,majors:1,diff_lines:40},{pass:2,verdict:'approve',blockers:0,majors:0,diff_lines:58}]})));")" \
  '{"verdict":"approve","blockers":0,"majors":0,"diffLines":58}'
check "terminalOutcome: entry missing blockers/majors/diff_lines -- each independently null, not defaulted to 0" \
  "$(lj "process.stdout.write(JSON.stringify(L.terminalOutcome({history:[{verdict:'approve'}]})));")" \
  '{"verdict":"approve","blockers":null,"majors":null,"diffLines":null}'
check "terminalOutcome: wrong-typed/negative counts are not coerced -- null, not passed through" \
  "$(lj "process.stdout.write(JSON.stringify(L.terminalOutcome({history:[{verdict:'approve',blockers:'2',majors:-1,diff_lines:1.5}]})));")" \
  '{"verdict":"approve","blockers":null,"majors":null,"diffLines":null}'

# --- writeNextShard(): the new `verdict` parameter, and backward compatibility for every
# pre-F-267 6-arg call site (this file's own MERGE_SHA writes above, eval-runner.sh's F-248 tests) -
F267_SHA1="f267verdict$(date +%s)"
verdict_written=$(cj "
  const fs = await import('node:fs');
  const occ = new Set();
  const idx = M.writeNextShard('$F267_SHA1', M.TASK_ID, 5, occ, 0, 2, 'approve');
  const rec = JSON.parse(fs.readFileSync(M.loopShardPath('$F267_SHA1', M.TASK_ID, idx), 'utf8'));
  process.stdout.write(JSON.stringify(rec.run));
")
check "writeNextShard(..., verdict) writes it into run.verdict (run.terminal an explicit null, F-268, when not passed)" \
  "$verdict_written" '{"index":0,"pass":2,"verdict":"approve","terminal":null}'
rm -rf "$ROOT/tests/evals/results/$F267_SHA1"

F267_SHA2="f267noverdict$(date +%s)"
verdict_defaulted=$(cj "
  const fs = await import('node:fs');
  const occ = new Set();
  const idx = M.writeNextShard('$F267_SHA2', M.TASK_ID, 5, occ, 0, 3);
  const rec = JSON.parse(fs.readFileSync(M.loopShardPath('$F267_SHA2', M.TASK_ID, idx), 'utf8'));
  process.stdout.write(JSON.stringify(rec.run) + '|' + ('verdict' in rec.run) + '|' + ('terminal' in rec.run));
")
check "writeNextShard called with NO verdict/terminal arg (every pre-F-267 call site's own shape) still writes both as explicit null keys, not omitted ones" \
  "$verdict_defaulted" '{"index":0,"pass":3,"verdict":null,"terminal":null}|true|true'
rm -rf "$ROOT/tests/evals/results/$F267_SHA2"

# --- makeShardWriter(): the real onDraw wiring drawArmForSha() uses, driven through the REAL
# fillArm() with a synthetic (non-live) draw handle -- no /code-loop invocation, no quota spent ---
F267_SHA3="f267wiring$(date +%s)"
wiring_check=$(cj "
  const fs = await import('node:fs');
  const state = { status: 'done', pass: 2, history: [{ pass: 1, verdict: 'request-changes' }, { pass: 2, verdict: 'approve', blockers: 0, majors: 0, diff_lines: 58 }] };
  const makeDraw = () => ({ read: () => state, retry() {}, cleanup() {} });
  const occ = new Set();
  const { newDraw, onDraw } = M.makeShardWriter(makeDraw, '$F267_SHA3', M.TASK_ID, 1, occ, 0);
  const r = M.fillArm(newDraw, { n: 1, onDraw });
  const rec = JSON.parse(fs.readFileSync(M.loopShardPath('$F267_SHA3', M.TASK_ID, 0), 'utf8'));
  process.stdout.write(JSON.stringify({ arm: r.arm, verdict: rec.run.verdict, terminal: rec.run.terminal }));
")
check "makeShardWriter()'s onDraw, driven for real through fillArm(), writes the TERMINAL verdict AND the widened terminal object (F-268) from a two-entry history -- the exact assembly drawArmForSha() uses, without a live draw" \
  "$wiring_check" '{"arm":[2],"verdict":"approve","terminal":{"verdict":"approve","blockers":0,"majors":0,"diffLines":58}}'
rm -rf "$ROOT/tests/evals/results/$F267_SHA3"

# --- constraint 1: a shard with NO run.verdict key at all (the real, pre-fix shape -- see
# diary.md, 2026-09-05; independently checked by hand against the actual quota-paid shards at
# tests/evals/results/39411eb.../convergence/, gitignored and session-specific, so NOT reproduced
# here as a committed dependency -- see the coder's own report) must still fold as a usable draw:
# never discarded, never an error. Staged as a synthetic legacy shard so this guard stays hermetic
# and portable across clones/CI that don't carry that local, gitignored quota-paid data.
F267_LEGACY_SHA="f267legacy$(date +%s)"
cj "
  const fs = await import('node:fs');
  const path = await import('node:path');
  const p = M.loopShardPath('$F267_LEGACY_SHA', M.TASK_ID, 0);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ sha: '$F267_LEGACY_SHA', taskId: M.TASK_ID, schema: M.LOOP_SCHEMA_VERSION, run: { index: 0, pass: 1 } }) + '\n');
" >/dev/null
legacy_resume() { cj "process.stdout.write(JSON.stringify(M.resumeArm('$F267_LEGACY_SHA', M.TASK_ID, 1).resume));"; }
check "F-267/constraint 1: a shard with NO run.verdict key at all (the real, pre-fix shape) still folds as a usable draw" \
  "$(legacy_resume)" "[1]"

# Mutation: prove the guard above can actually fail. readLoopShard()'s schema gate is mutated to
# ALSO require a verdict -- the exact shape of regression constraint 1 forbids -- staged on a
# scratch copy, read against the SAME on-disk legacy shard (read-only; confirmed untouched by the
# final re-check below).
F267_C1_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$F267_C1_DIR"' EXIT
F267_C1="$F267_C1_DIR/convergence.mjs"
cp "$ROOT/$CVD" "$F267_C1"
ln -s "$ROOT/tests/evals/lib" "$F267_C1_DIR/lib"
ln -s "$ROOT/tests/evals/run.mjs" "$F267_C1_DIR/run.mjs"
node -e "
  const fs = require('fs'); const p = '$F267_C1'; const s = fs.readFileSync(p, 'utf8');
  const FROM = 'return rec?.schema === LOOP_SCHEMA_VERSION ? rec : null;';
  const TO = 'return rec?.schema === LOOP_SCHEMA_VERSION \&\& rec.run?.verdict != null ? rec : null; // MUTANT (F-267): wrongly requires a verdict to fold';
  if (!s.includes(FROM)) throw new Error('F-267 constraint-1 mutant pattern not found in convergence.mjs -- source moved, update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
mutant_resume=$(node --input-type=module -e "
  const M = await import('$F267_C1');
  process.stdout.write(JSON.stringify(M.resumeArm('$F267_LEGACY_SHA', M.TASK_ID, 1).resume));
")
check "mutant (F-267: readLoopShard wrongly requires a verdict) discards the legacy shard -- [] not [1], catching the exact regression constraint 1 forbids" \
  "$mutant_resume" "[]"
pristine_resume=$(legacy_resume)
check "pristine convergence.mjs (mutation reverted -- a fresh copy, not the mutated scratch file) still folds the legacy shard, [1]" \
  "$pristine_resume" "[1]"
rm -rf "$F267_C1_DIR"
trap - EXIT
rm -rf "$ROOT/tests/evals/results/$F267_LEGACY_SHA"

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
