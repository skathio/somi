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

# --- F-276: a censored draw retains a diagnostic record (elapsed wall-clock, wait attempts, ------
# last-seen loop state) -- phase 4 iteration 4.4. 4.1's own first live batch showed three draws
# read back as still-`running`; once the wait budget is exhausted, fillArm() previously discarded
# the last-read state entirely -- no shard is written and the workDir is cleaned up, so "the loop
# was genuinely slow" (cost-correlated, F-185) and "the subprocess died in thirty seconds"
# (uncorrelated with cost) were indistinguishable from any retained artifact. censoredDrawSnapshot()
# (lib/convergence.mjs) is the read side; fillArm()'s new `censor` field and writeCensorRecord()
# (this module) are the write side. Does NOT change what counts as a usable draw or the censoring
# policy itself (still exactly `waitAttempts > maxWaitAttempts`) -- only what gets recorded.
MK_SEQ_DRAW='
  function mkSeqDraw(seq) {
    let i = 0;
    return () => {
      const states = seq[i++]; let idx = 0;
      return { read: () => states[idx], retry: () => { idx = Math.min(idx + 1, states.length - 1); } };
    };
  }
'

# censoredDrawSnapshot() fails safe, same posture as terminalVerdict()/terminalOutcome() above --
# always an object (the caller only calls this once a censoring event is already known to have
# happened); status/historyEmpty independently null on an unrecognised shape, stateReadable always
# a determinate boolean (F-279, code-loop pass 2 review).
check "censoredDrawSnapshot(null) is {status:null,historyEmpty:null,stateReadable:false} (fails safe)" \
  "$(lj "process.stdout.write(JSON.stringify(L.censoredDrawSnapshot(null)));")" \
  '{"status":null,"historyEmpty":null,"stateReadable":false}'
check "censoredDrawSnapshot(undefined) is the same" \
  "$(lj "process.stdout.write(JSON.stringify(L.censoredDrawSnapshot(undefined)));")" \
  '{"status":null,"historyEmpty":null,"stateReadable":false}'
check "censoredDrawSnapshot(42) is the same (non-object input, not coerced)" \
  "$(lj "process.stdout.write(JSON.stringify(L.censoredDrawSnapshot(42)));")" \
  '{"status":null,"historyEmpty":null,"stateReadable":false}'
check "censoredDrawSnapshot({}) -- stateReadable true (it IS an object), status/historyEmpty still null (no fields to read)" \
  "$(lj "process.stdout.write(JSON.stringify(L.censoredDrawSnapshot({})));")" \
  '{"status":null,"historyEmpty":null,"stateReadable":true}'
check "censoredDrawSnapshot({status:'running'}) reports the status; historyEmpty null (no history field to read)" \
  "$(lj "process.stdout.write(JSON.stringify(L.censoredDrawSnapshot({status:'running'})));")" \
  '{"status":"running","historyEmpty":null,"stateReadable":true}'
check "censoredDrawSnapshot({status:'running',history:[]}) -- empty history means no pass has COMPLETED yet (scripts/somi-loop.mjs init's own pre-work state), NOT proof the loop died immediately -- a stalled pass 1 reads identically (F-277, code-loop pass 2 review)" \
  "$(lj "process.stdout.write(JSON.stringify(L.censoredDrawSnapshot({status:'running',history:[]})));")" \
  '{"status":"running","historyEmpty":true,"stateReadable":true}'
check "censoredDrawSnapshot({status:'running',history:[{pass:1}]}) -- non-empty history is the 'at least one pass completed' shape" \
  "$(lj "process.stdout.write(JSON.stringify(L.censoredDrawSnapshot({status:'running',history:[{pass:1}]})));")" \
  '{"status":"running","historyEmpty":false,"stateReadable":true}'
check "censoredDrawSnapshot: wrong-typed status/history are not coerced -- null, not passed through; stateReadable still true (an object WAS read, however malformed its fields)" \
  "$(lj "process.stdout.write(JSON.stringify(L.censoredDrawSnapshot({status:7,history:'nope'})));")" \
  '{"status":null,"historyEmpty":null,"stateReadable":true}'
check "F-279: stateReadable now separates 'no readable state at all' (null) from 'state read but malformed' ({status:7,...}) -- previously both collapsed to the identical {status:null,historyEmpty:null} record" \
  "$(lj "process.stdout.write(JSON.stringify([L.censoredDrawSnapshot(null).stateReadable, L.censoredDrawSnapshot({status:7,history:'nope'}).stateReadable]));")" \
  '[false,true]'

# fillArm(): the `censor` field on the wait-exhausted path. `now` is injectable (defaults to
# Date.now) so elapsedMs is deterministic under test, the same seam newDraw/report/resume already
# are.
check "fillArm: wait-exhaustion returns a real censor record -- elapsedMs from the injected clock, waitAttempts the loop's own count, lastState from the last-read (still-running) state" \
  "$(cj "$MK_SEQ_DRAW
    let t = 1000;
    const now = () => (t += 1000);
    const seq = [[{status:'running'}, {status:'running'}, {status:'running'}]];
    const r = M.fillArm(mkSeqDraw(seq), { n: 1, maxWaitAttempts: 2, report: () => {}, now });
    process.stdout.write(JSON.stringify(r.censor));
  ")" '{"elapsedMs":1000,"waitAttempts":3,"lastState":{"status":"running","historyEmpty":null,"stateReadable":true}}'
check "fillArm: censor.lastState.historyEmpty is true when the last-read state's history is empty (no pass has completed yet -- not proof nothing started; see censoredDrawSnapshot()'s docstring, F-277)" \
  "$(cj "$MK_SEQ_DRAW
    const seq = [[{status:'running',history:[]}]];
    const r = M.fillArm(mkSeqDraw(seq), { n: 1, maxWaitAttempts: 0, report: () => {} });
    process.stdout.write(JSON.stringify(r.censor.lastState));
  ")" '{"status":"running","historyEmpty":true,"stateReadable":true}'
check "fillArm: elapsedMs includes the span newDraw() itself consumes before returning a handle, not just the retries after it (F-278, code-loop pass 2 review -- mkSeqDraw above can't pin this, since its newDraw() never calls now() and is instantaneous either way)" \
  "$(cj "
    let f278t = 0;
    const f278NewDraw = () => { f278t += 60000; return { read: () => ({ status: 'running' }), retry: () => {}, cleanup: () => {} }; };
    const r = M.fillArm(f278NewDraw, { n: 1, maxWaitAttempts: 0, report: () => {}, now: () => f278t });
    process.stdout.write(String(r.censor.elapsedMs));
  ")" "60000"
check "fillArm: censor is null on the breach path (only the wait-exhausted path retains anything)" \
  "$(cj "$MK_SEQ_DRAW
    const r = M.fillArm(mkSeqDraw([[{status:'max-passes-exceeded',pass:6}]]), { n: 1, report: () => {} });
    process.stdout.write(String(r.censor));
  ")" "null"
check "fillArm: censor is null on the done path" \
  "$(cj "$MK_SEQ_DRAW
    const r = M.fillArm(mkSeqDraw([[{status:'done',pass:2}]]), { n: 1, report: () => {} });
    process.stdout.write(String(r.censor));
  ")" "null"

# writeCensorRecord()/censorRecordPath(): persisting the record, own namespace, self-healing slot.
F276_SHA="f276censor$(date +%s)"
censor_written=$(cj "
  const fs = await import('node:fs');
  const seq = M.writeCensorRecord('$F276_SHA', M.TASK_ID, { elapsedMs: 278000, waitAttempts: 3, lastState: { status: 'running', historyEmpty: true } });
  const p = M.censorRecordPath('$F276_SHA', M.TASK_ID, seq);
  const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
  process.stdout.write(JSON.stringify({ seq, sha: rec.sha, taskId: rec.taskId, schema: rec.schema, censor: rec.censor }));
")
check "writeCensorRecord() persists the record at seq 0 with the module's schema, sha and taskId alongside it" \
  "$censor_written" \
  "{\"seq\":0,\"sha\":\"$F276_SHA\",\"taskId\":\"loop-code-loop\",\"schema\":1,\"censor\":{\"elapsedMs\":278000,\"waitAttempts\":3,\"lastState\":{\"status\":\"running\",\"historyEmpty\":true}}}"
check "writeCensorRecord() called again for the same sha self-heals to the NEXT free slot (seq 1), never overwriting the first" \
  "$(cj "
    const seq = M.writeCensorRecord('$F276_SHA', M.TASK_ID, { elapsedMs: 1000, waitAttempts: 1, lastState: { status: 'running', historyEmpty: false } });
    process.stdout.write(String(seq));
  ")" "1"
check "a censored draw's record lives OUTSIDE the numbered shard namespace -- resumeArm() sees no usable draw from it (F-276 does not change what counts as usable, constraint 1)" \
  "$(cj "process.stdout.write(JSON.stringify(M.resumeArm('$F276_SHA', M.TASK_ID, 15).resume));")" \
  "[]"
rm -rf "$ROOT/tests/evals/results/$F276_SHA"

# The exact assembly drawArmForSha() uses (fillArm's censor return, persisted via
# writeCensorRecord()) -- without a live /code-loop invocation, no quota spent.
F276_WIRING_SHA="f276wiring$(date +%s)"
wiring_censor=$(cj "
  const fs = await import('node:fs');
  const makeDraw = () => ({ read: () => ({ status: 'running', history: [] }), retry() {}, cleanup() {} });
  const occ = new Set();
  const { newDraw, onDraw } = M.makeShardWriter(makeDraw, '$F276_WIRING_SHA', M.TASK_ID, 1, occ, 0);
  const r = M.fillArm(newDraw, { n: 1, maxWaitAttempts: 1, onDraw, report: () => {} });
  const seq = r.censor ? M.writeCensorRecord('$F276_WIRING_SHA', M.TASK_ID, r.censor) : null;
  const rec = seq === null ? null : JSON.parse(fs.readFileSync(M.censorRecordPath('$F276_WIRING_SHA', M.TASK_ID, seq), 'utf8'));
  process.stdout.write(JSON.stringify({ arm: r.arm, waitExhausted: r.waitExhausted, persisted: rec ? rec.censor.lastState : null }));
")
check "the exact assembly drawArmForSha() uses (fillArm's censor return + writeCensorRecord) persists a censored draw's evidence, without a live draw" \
  "$wiring_censor" '{"arm":[],"waitExhausted":true,"persisted":{"status":"running","historyEmpty":true,"stateReadable":true}}'
rm -rf "$ROOT/tests/evals/results/$F276_WIRING_SHA"

# Mutation: prove the retained record can actually fail to be retained. Staged on a scratch copy,
# never the tracked file.
F276_MUT_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$F276_MUT_DIR"' EXIT
F276_MUT="$F276_MUT_DIR/convergence.mjs"
cp "$ROOT/$CVD" "$F276_MUT"
ln -s "$ROOT/tests/evals/lib" "$F276_MUT_DIR/lib"
ln -s "$ROOT/tests/evals/run.mjs" "$F276_MUT_DIR/run.mjs"
node -e "
  const fs = require('fs'); const p = '$F276_MUT'; const s = fs.readFileSync(p, 'utf8');
  const FROM = 'const censor = { elapsedMs: now() - drawStartedAt, waitAttempts, lastState: censoredDrawSnapshot(state) };';
  const TO = 'const censor = null; // MUTANT (F-276): the censored draw retains nothing, same as before this pass';
  if (!s.includes(FROM)) throw new Error('F-276 mutant pattern not found in convergence.mjs -- source moved, update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
mutant_censor=$(node --input-type=module -e "
  const M = await import('$F276_MUT');
  $MK_SEQ_DRAW
  const r = M.fillArm(mkSeqDraw([[{status:'running'}, {status:'running'}, {status:'running'}]]), { n: 1, maxWaitAttempts: 2, report: () => {} });
  process.stdout.write(String(r.censor));
")
check "mutant (F-276: censor forced to null) reproduces the exact pre-fix gap -- a censored draw retains nothing, catching the regression the tests above exist for" \
  "$mutant_censor" "null"
pristine_censor=$(cj "$MK_SEQ_DRAW
  const r = M.fillArm(mkSeqDraw([[{status:'running'}, {status:'running'}, {status:'running'}]]), { n: 1, maxWaitAttempts: 2, report: () => {} });
  process.stdout.write(String(r.censor !== null));
")
check "pristine convergence.mjs (mutation reverted -- a fresh copy, not the mutated scratch file) still retains a real censor record" \
  "$pristine_censor" "true"
rm -rf "$F276_MUT_DIR"
trap - EXIT

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

# --- F-263: --fixture/--source/--model have exactly ONE defender (val()'s own `v === ''` clause),
# no downstream validator the way --merge/--certify have (val() + the `!== null` guard +
# validateSha()) -- so this case, unlike F-259's, had no committed test at all before this pass.
for flag in --source --fixture --model; do check "$flag with an empty operand is rejected (F-261)" "$(node "$CVD" --dry-run "$flag" "" >/dev/null 2>&1; echo $?)" "1"; done
check "--fixture -h is rejected as a flag-shaped operand, not silently accepted as a literal value (F-262)" \
  "$(node "$CVD" --dry-run --fixture -h >/dev/null 2>&1; echo $?)" "1"

stub_bin=$(mktemp -d)
stub_sentinel="$stub_bin/touched"
printf '#!/bin/sh\n%s "%s"\nexit 1\n' "$(command -v touch)" "$stub_sentinel" > "$stub_bin/claude"
chmod +x "$stub_bin/claude"
PATH="$stub_bin:$PATH" node "$CVD" --merge "" >/dev/null 2>&1
check "F-259: --merge with an empty operand no longer reaches a stub claude on PATH (sentinel stays absent)" "$([ -e "$stub_sentinel" ] && echo TOUCHED || echo ABSENT)" "ABSENT"
PATH="$stub_bin" claude >/dev/null 2>&1
check "positive control: same stub still reachable (F-259 re-confirmation)" "$([ -e "$stub_sentinel" ] && echo TOUCHED || echo ABSENT)" "TOUCHED"
rm -rf "$stub_bin"

# Mutation: prove the F-261 cases above actually depend on val()'s `v === ''` clause -- the
# reviewer's own measurement was that today they would NOT redden if it were removed. Staged on a
# scratch copy, never the tracked file.
F263_MUT_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$F263_MUT_DIR"' EXIT
F263_MUT="$F263_MUT_DIR/convergence.mjs"
cp "$ROOT/$CVD" "$F263_MUT"
ln -s "$ROOT/tests/evals/lib" "$F263_MUT_DIR/lib"
ln -s "$ROOT/tests/evals/run.mjs" "$F263_MUT_DIR/run.mjs"
node -e "
  const fs = require('fs'); const p = '$F263_MUT'; const s = fs.readFileSync(p, 'utf8');
  const FROM = \"v === undefined || v === '' || /^-/.test(v)\";
  const TO = \"v === undefined || /^-/.test(v)\"; // MUTANT (F-263): empty-string operand no longer rejected
  if (!s.includes(FROM)) throw new Error('F-263 mutant pattern not found in convergence.mjs -- source moved, update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
mutant_exit=$(node "$F263_MUT" --dry-run --source "" >/dev/null 2>&1; echo $?)
check "mutant (F-263: val()'s v === '' clause removed) lets --source \"\" through -- the F-261 case above would now go GREEN on a broken guard, confirming it currently depends on this exact clause" \
  "$mutant_exit" "0"
pristine_exit=$(node "$CVD" --dry-run --source "" >/dev/null 2>&1; echo $?)
check "pristine convergence.mjs (mutation reverted -- a fresh copy, not the mutated scratch file) still rejects --source \"\"" \
  "$pristine_exit" "1"
rm -rf "$F263_MUT_DIR"
trap - EXIT

# --- F-284 (first defect): the shard namespace carries no fixture identity, phase 4 iteration 4.5.
# Before this, loopShardPath() took no fixture component at all -- task02's draw 0 and a NEW
# fixture's draw 0 landed at the byte-identical path, and resumeArm() folded both as one arm,
# mixing two fixtures' draws into a single mean/sd. Demonstrated below by construction, then by a
# mutation that reproduces the exact collision.
F284_SHA="f284ns$(date +%s)"
check "loopShardPath: two DIFFERENT fixtureIds at the SAME sha/index now resolve to DIFFERENT paths -- the collision is gone" \
  "$(cj "process.stdout.write(String(M.loopShardPath('$F284_SHA', M.TASK_ID, 0, 'task02-code') !== M.loopShardPath('$F284_SHA', M.TASK_ID, 0, 'task02-code-degraded')));")" \
  "true"
check "loopShardPath: fixtureId OMITTED still reads the flat path -- unchanged from every shard on disk before this iteration (constraint 1)" \
  "$(cj "process.stdout.write(String(M.loopShardPath('$F284_SHA', M.TASK_ID, 0) === M.loopShardPath('$F284_SHA', M.TASK_ID, 0, null)));")" \
  "true"

# resumeArm folds STRICTLY per fixtureId -- two fixtures' shards written at the SAME index of the
# SAME sha never merge into one arm.
cj "
  const occA = new Set(); M.writeNextShard('$F284_SHA', M.TASK_ID, 5, occA, 0, 3, null, null, 'task02-code');
  const occB = new Set(); M.writeNextShard('$F284_SHA', M.TASK_ID, 5, occB, 0, 9, null, null, 'task02-code-degraded');
" >/dev/null
check "resumeArm(sha, taskId, n, 'task02-code') folds only its OWN fixture's shard, [3] -- not the OTHER fixture's [9] written at the same index" \
  "$(cj "process.stdout.write(JSON.stringify(M.resumeArm('$F284_SHA', M.TASK_ID, 5, 'task02-code').resume));")" "[3]"
check "resumeArm(sha, taskId, n, 'task02-code-degraded') folds only [9], not [3]" \
  "$(cj "process.stdout.write(JSON.stringify(M.resumeArm('$F284_SHA', M.TASK_ID, 5, 'task02-code-degraded').resume));")" "[9]"
check "writeNextShard: the record itself carries fixture identity (F-284), not only the path -- rec.fixture" \
  "$(cj "const fs = await import('node:fs'); const rec = JSON.parse(fs.readFileSync(M.loopShardPath('$F284_SHA', M.TASK_ID, 0, 'task02-code'), 'utf8')); process.stdout.write(rec.fixture);")" \
  "task02-code"
rm -rf "$ROOT/tests/evals/results/$F284_SHA"

# makeShardWriter()/writeNextShard(): fixtureId threads through the EXACT assembly drawArmForSha()
# uses, without a live draw -- same style as the F-267/F-268 wiring checks above.
F284_WIRING_SHA="f284wiring$(date +%s)"
check "the exact assembly drawArmForSha() uses threads fixtureId into both the shard's path and its record" \
  "$(cj "
    const fs = await import('node:fs');
    const makeDraw = () => ({ read: () => ({ status: 'done', pass: 2 }), retry() {}, cleanup() {} });
    const occ = new Set();
    const { newDraw, onDraw } = M.makeShardWriter(makeDraw, '$F284_WIRING_SHA', M.TASK_ID, 1, occ, 0, 'task02-code');
    M.fillArm(newDraw, { n: 1, onDraw });
    const p = M.loopShardPath('$F284_WIRING_SHA', M.TASK_ID, 0, 'task02-code');
    process.stdout.write(JSON.stringify({ shardAtFixturePath: fs.existsSync(p), recordFixture: JSON.parse(fs.readFileSync(p, 'utf8')).fixture }));
  ")" '{"shardAtFixturePath":true,"recordFixture":"task02-code"}'
rm -rf "$ROOT/tests/evals/results/$F284_WIRING_SHA"

# writeCensorRecord() also records fixture identity (F-284) -- the censored/ evidence stream gets
# the same honesty about which fixture it came from, even though (unlike numbered shards) it stays
# unqualified by directory, since nothing folds censor records back into an arm (F-283, open).
F284_CENSOR_SHA="f284censor$(date +%s)"
check "writeCensorRecord(..., fixtureId) persists it alongside the censor payload" \
  "$(cj "
    const fs = await import('node:fs');
    const seq = M.writeCensorRecord('$F284_CENSOR_SHA', M.TASK_ID, { elapsedMs: 1, waitAttempts: 1, lastState: { status: 'running', historyEmpty: true, stateReadable: true } }, 'task02-code');
    process.stdout.write(JSON.parse(fs.readFileSync(M.censorRecordPath('$F284_CENSOR_SHA', M.TASK_ID, seq), 'utf8')).fixture);
  ")" "task02-code"
rm -rf "$ROOT/tests/evals/results/$F284_CENSOR_SHA"

# Legacy shards (every shard written before this iteration, including the five quota-paid ones
# D12 rests on) carry NO fixture key at all -- taken to mean UNKNOWN, never assumed to be
# task02-code (D9's default) or any other fixture. Staged as a synthetic legacy shard so this stays
# hermetic and portable across clones/CI that don't carry the real, gitignored quota-paid data.
F284_LEGACY_SHA="f284legacy$(date +%s)"
cj "
  const fs = await import('node:fs'); const path = await import('node:path');
  const p = M.loopShardPath('$F284_LEGACY_SHA', M.TASK_ID, 0);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ sha: '$F284_LEGACY_SHA', taskId: M.TASK_ID, schema: M.LOOP_SCHEMA_VERSION, run: { index: 0, pass: 1 } }) + '\n');
" >/dev/null
check "a legacy shard (no fixture key at all) still folds via resumeArm() with fixtureId OMITTED -- the unqualified/unknown bucket" \
  "$(cj "process.stdout.write(JSON.stringify(M.resumeArm('$F284_LEGACY_SHA', M.TASK_ID, 1).resume));")" "[1]"
check "the SAME legacy shard is invisible when a REAL fixtureId is asked for -- 'unknown' is never silently treated as 'task02-code'" \
  "$(cj "process.stdout.write(JSON.stringify(M.resumeArm('$F284_LEGACY_SHA', M.TASK_ID, 1, 'task02-code').resume));")" "[]"
rm -rf "$ROOT/tests/evals/results/$F284_LEGACY_SHA"

# Mutation: revert loopShardPath() to its pre-fix shape (fixtureId accepted but ignored) and
# reproduce the EXACT collision the phase file demonstrates by hand -- two different fixtures'
# draw 0 landing at the byte-identical path. Staged on a scratch copy, never the tracked file.
# Occurrence count asserted, not just presence (standing discipline): this exact anchor is unique
# in the file, unlike e.g. `mkdirSync(dirname(p), { recursive: true });`, which occurs twice and
# would select the wrong one positionally under a plain .replace().
F284_MUT_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$F284_MUT_DIR"' EXIT
F284_MUT="$F284_MUT_DIR/convergence.mjs"
cp "$ROOT/$CVD" "$F284_MUT"
ln -s "$ROOT/tests/evals/lib" "$F284_MUT_DIR/lib"
ln -s "$ROOT/tests/evals/run.mjs" "$F284_MUT_DIR/run.mjs"
node -e "
  const fs = require('fs'); const p = '$F284_MUT'; const s = fs.readFileSync(p, 'utf8');
  const FROM = 'const dir = fixtureId == null ? loopShardDir(sha) : join(loopShardDir(sha), fixtureId);';
  const TO = 'const dir = loopShardDir(sha); // MUTANT (F-284): fixtureId accepted but ignored, the pre-fix shape';
  const count = s.split(FROM).length - 1;
  if (count !== 1) throw new Error('F-284 mutant anchor occurs ' + count + ' time(s), not exactly 1 -- update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
mutant_collision=$(node --input-type=module -e "
  const M = await import('$F284_MUT');
  process.stdout.write(String(M.loopShardPath('$F284_SHA', M.TASK_ID, 0, 'task02-code') === M.loopShardPath('$F284_SHA', M.TASK_ID, 0, 'task02-code-degraded')));
")
check "mutant (F-284: fixtureId ignored, the pre-fix shape) reproduces the EXACT collision the phase file demonstrates by hand -- task02's draw 0 and a NEW fixture's draw 0 land at the SAME path" \
  "$mutant_collision" "true"
pristine_collision=$(cj "process.stdout.write(String(M.loopShardPath('$F284_SHA', M.TASK_ID, 0, 'task02-code') === M.loopShardPath('$F284_SHA', M.TASK_ID, 0, 'task02-code-degraded')));")
check "pristine convergence.mjs (mutation reverted -- a fresh copy, not the mutated scratch file) no longer collides" \
  "$pristine_collision" "false"
rm -rf "$F284_MUT_DIR"
trap - EXIT

# --- F-285 (Blocker): --merge/--certify ignored --fixture entirely, so a fixture-qualified arm on
# disk silently underreported as 0/N through the unqualified read -- disjoint from the write side.
F285_SHA="f285$(date +%s)"
cj "const occ = new Set(); M.writeNextShard('$F285_SHA', M.TASK_ID, 5, occ, 0, 4, null, null, 'tests/evals/fixtures/task02-code');" >/dev/null
check "--merge --fixture <id> folds that fixture's own arm, [4] -- the read side now agrees with the write side (F-285)" \
  "$(node "$CVD" --merge "$F285_SHA" --fixture tests/evals/fixtures/task02-code --runs 5 | grep -c 'arm:  \[4\]')" "1"
check "--merge WITHOUT --fixture on the SAME sha now WARNS a fixture-qualified sibling exists, instead of silently reading 0/N (F-285)" \
  "$(node "$CVD" --merge "$F285_SHA" --runs 5 2>&1 >/dev/null | grep -c 'also has fixture-qualified draws')" "1"

# Mutation: drop --fixture from reportArm()'s call site, reproducing F-285's disjoint read.
F285_MUT_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$F285_MUT_DIR"' EXIT
F285_MUT="$F285_MUT_DIR/convergence.mjs"
cp "$ROOT/$CVD" "$F285_MUT"
ln -s "$ROOT/tests/evals/lib" "$F285_MUT_DIR/lib"
ln -s "$ROOT/tests/evals/run.mjs" "$F285_MUT_DIR/run.mjs"
node -e "
  const fs = require('fs'); const p = '$F285_MUT'; const s = fs.readFileSync(p, 'utf8');
  const FROM = 'reportArm(validateSha(args.merge ?? args.certify), args.runs, resolveFixtureId(args.fixture));';
  const TO = 'reportArm(validateSha(args.merge ?? args.certify), args.runs); // MUTANT (F-285): --fixture never threaded';
  const count = s.split(FROM).length - 1;
  if (count !== 1) throw new Error('F-285 mutant anchor occurs ' + count + ' time(s), not exactly 1 -- update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
mutant_merge=$(node "$F285_MUT" --merge "$F285_SHA" --fixture tests/evals/fixtures/task02-code --runs 5 | grep -c 'arm:  \[4\]')
check "mutant (F-285: --fixture dropped before reportArm) can no longer see the fixture-qualified arm -- 0, not 1" \
  "$mutant_merge" "0"
pristine_merge=$(node "$CVD" --merge "$F285_SHA" --fixture tests/evals/fixtures/task02-code --runs 5 | grep -c 'arm:  \[4\]')
check "pristine convergence.mjs (mutation reverted -- a fresh copy, not the mutated scratch file) sees it again, 1" \
  "$pristine_merge" "1"
rm -rf "$F285_MUT_DIR"
trap - EXIT
rm -rf "$ROOT/tests/evals/results/$F285_SHA"

# --- F-284 (second defect): --fixture is now pinned to the drawn SHA's own worktree, refused (not
# warned) if it escapes that tree or is git-dirty there. assertFixturePinned() is the guard;
# resolveFixtureDir()/drawArmForSha() are its call sites.
PIN_SRC=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$PIN_SRC"' EXIT
mkdir -p "$PIN_SRC/fixtures/task02-code"
echo hello > "$PIN_SRC/fixtures/task02-code/a.txt"
check "assertFixturePinned: a fixture path INSIDE sourceDir is accepted (unversioned source, sha null -- no git-dirty check applies)" \
  "$(cj "try { M.assertFixturePinned('$PIN_SRC', '$PIN_SRC/fixtures/task02-code', null); process.stdout.write('ok'); } catch (e) { process.stdout.write('threw: ' + e.message); }")" \
  "ok"
PIN_OUTSIDE=$(mktemp -d)
check "assertFixturePinned: a fixture path OUTSIDE sourceDir is refused, not silently accepted" \
  "$(cj "try { M.assertFixturePinned('$PIN_SRC', '$PIN_OUTSIDE', null); process.stdout.write('NO THROW'); } catch { process.stdout.write('threw'); }")" \
  "threw"
rm -rf "$PIN_OUTSIDE"

# The git-dirty half needs a REAL repo (git status is the assertion, not a comment claiming
# nothing touches the worktree) -- built and torn down here, never the tracked repo.
(cd "$PIN_SRC" && git init -q -b main && git config user.email x@x.invalid && git config user.name x && git add -A && git commit -qm baseline) >/dev/null 2>&1
check "assertFixturePinned: a CLEAN worktree (freshly committed, nothing touched since) passes even with a real sha" \
  "$(cj "try { M.assertFixturePinned('$PIN_SRC', '$PIN_SRC/fixtures/task02-code', 'deadbeef'); process.stdout.write('ok'); } catch (e) { process.stdout.write('threw: ' + e.message); }")" \
  "ok"
echo modified > "$PIN_SRC/fixtures/task02-code/a.txt"
check "assertFixturePinned: an uncommitted edit to the fixture inside the worktree is refused as DIRTY relative to the drawn SHA" \
  "$(cj "try { M.assertFixturePinned('$PIN_SRC', '$PIN_SRC/fixtures/task02-code', 'deadbeef'); process.stdout.write('NO THROW'); } catch (e) { process.stdout.write(/dirty/.test(e.message) ? 'threw-dirty' : 'threw-other: ' + e.message); }")" \
  "threw-dirty"
check "assertFixturePinned: the SAME dirty worktree is NOT checked when the source is unversioned (sha null) -- resolveSource() already documents that case as non-reproducible" \
  "$(cj "try { M.assertFixturePinned('$PIN_SRC', '$PIN_SRC/fixtures/task02-code', null); process.stdout.write('ok'); } catch (e) { process.stdout.write('threw: ' + e.message); }")" \
  "ok"

# F-286: --fixture IS sourceDir -- relative() returns '', join()'s no-op aliases onto the bucket.
check "assertFixturePinned: --fixture . (rel === '') is refused, not aliased onto the unqualified bucket (F-286)" \
  "$(cj "try { M.assertFixturePinned('$PIN_SRC', '$PIN_SRC', null); process.stdout.write('NO THROW'); } catch { process.stdout.write('threw'); }")" \
  "threw"
mkdir -p "$PIN_SRC/..scratch" # F-287: a CONTAINED sibling merely named like a parent ref
check "assertFixturePinned: a CONTAINED dir named ..scratch is accepted, not falsely refused as an escape (F-287)" \
  "$(cj "try { M.assertFixturePinned('$PIN_SRC', '$PIN_SRC/..scratch', null); process.stdout.write('ok'); } catch (e) { process.stdout.write('threw: ' + e.message); }")" \
  "ok"
rm -rf "$PIN_SRC"
trap - EXIT

# CLI integration: an explicit --fixture given as a path RELATIVE TO THE SOURCE TREE resolves
# inside the checked-out worktree (not this shell's cwd) -- the SHA-pin actually takes effect, not
# merely accepted.
dryrun_pinned=$(node "$CVD" --dry-run --source HEAD --fixture tests/evals/fixtures/task02-code)
dryrun_pinned_fixture=$(printf '%s' "$dryrun_pinned" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).fixture))")
check "--dry-run --fixture <source-relative path> resolves to a path INSIDE the checked-out worktree, not \$ROOT (F-284 actually took effect, not merely accepted)" \
  "$(case "$dryrun_pinned_fixture" in "$ROOT"/*) echo "still-rooted-at-ROOT" ;; *task02-code) echo "inside-worktree" ;; *) echo "unexpected: $dryrun_pinned_fixture" ;; esac)" \
  "inside-worktree"
# F-288: assert the MESSAGE -- git itself refuses an out-of-worktree pathspec independent of our
# guard, so exit 1 alone can't attribute the refusal (neutering the check below still exits 1).
escape_head_out=$(node "$CVD" --dry-run --source HEAD --fixture /tmp 2>&1 >/dev/null)
check "--dry-run --fixture <path escaping the resolved source tree> is refused BY OUR OWN GUARD, not merely exit 1 (F-288)" \
  "$(printf '%s' "$escape_head_out" | grep -c 'must resolve to a real subdirectory')" "1"

# Mutation: neuter assertFixturePinned()'s containment check and confirm the escape above is no
# longer refused -- the guard is load-bearing, not decorative.
F284_PIN_MUT_DIR=$(mktemp -d) || { bad "mktemp failed"; exit 1; }
trap 'rm -rf "$F284_PIN_MUT_DIR"' EXIT
F284_PIN_MUT="$F284_PIN_MUT_DIR/convergence.mjs"
cp "$ROOT/$CVD" "$F284_PIN_MUT"
ln -s "$ROOT/tests/evals/lib" "$F284_PIN_MUT_DIR/lib"
ln -s "$ROOT/tests/evals/run.mjs" "$F284_PIN_MUT_DIR/run.mjs"
node -e "
  const fs = require('fs'); const p = '$F284_PIN_MUT'; const s = fs.readFileSync(p, 'utf8');
  const FROM = \"if (rel === '' || rel === '..' || rel.startsWith('..' + sep)) {\";
  const TO = 'if (false) { // MUTANT (F-284/F-286/F-287): the containment check never fires';
  const count = s.split(FROM).length - 1;
  if (count !== 1) throw new Error('F-284 pin mutant anchor occurs ' + count + ' time(s), not exactly 1 -- update this mutation');
  fs.writeFileSync(p, s.replace(FROM, TO));
"
# Unversioned source (--source ., sha null) so the git-dirty defense-in-depth check (which itself
# refuses a path outside the repo, git's own error, not this module's) is out of the picture --
# containment is the ONLY guard standing, isolating exactly what this mutation tests.
mutant_pin_exit=$(node "$F284_PIN_MUT" --dry-run --source . --fixture /tmp >/dev/null 2>&1; echo $?)
check "mutant (F-284/F-286/F-287: assertFixturePinned's containment check neutered) lets --fixture /tmp through -- confirming the guard above currently depends on this exact check" \
  "$mutant_pin_exit" "0"
pristine_pin_exit=$(node "$CVD" --dry-run --source . --fixture /tmp >/dev/null 2>&1; echo $?)
check "pristine convergence.mjs (mutation reverted -- a fresh copy, not the mutated scratch file) still refuses --fixture /tmp" \
  "$pristine_pin_exit" "1"
rm -rf "$F284_PIN_MUT_DIR"
trap - EXIT

# --- F-289: committed hash baseline for the five quota-paid shards D12 rests on (results/ is
# gitignored, so a git-diff check there is vacuously empty) -- MANIFEST.sha256 (`git add -f`'d past
# the ignore) is verified when present, skipped VISIBLY when absent (F-237), never silently.
CONV_DIR="$ROOT/tests/evals/results/39411eb4d2785c47e1491e0b6c54be174a3ac753/convergence"
conv_n=$(ls "$CONV_DIR"/loop-code-loop-*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$conv_n" = "5" ]; then
  (cd "$CONV_DIR" && sha256sum -c --status MANIFEST.sha256)
  check "F-289: the five quota-paid shards match the committed MANIFEST.sha256 baseline" "$?" "0"
elif [ "$conv_n" = "0" ]; then
  echo "  (skipped: $CONV_DIR's shards not present -- results/ is gitignored except MANIFEST.sha256, expected on a fresh clone/CI)"
else
  bad "F-289: $CONV_DIR has $conv_n of 5 quota-paid shards on disk -- a real gap, not the expected all-or-nothing fresh-clone absence"
fi
# Guard shown to fail: verified BY HAND against a mktemp -d copy of the real shards, never the
# tracked files (sha256sum -c is external, already battle-tested, not re-proven here) -- corrupt
# flips OK to FAILED, restore flips back; real shards hashed identical before/after. Coder's report.

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
