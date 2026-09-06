#!/usr/bin/env bash
# End-to-end tests for scripts/somi-loop.sh and scripts/somi-findings.sh.
#
# Exercises the deterministic loop core in a throwaway git repo: cap resolution
# (flag > env > config > default), pass counting, weighted diff measurement
# (out-of-scope double-counting, .somi/.claude exclusion), resume-after-death,
# and the findings ledger (identity, consecutive-pass breaker, cross-run
# recurrence, resolve lifecycle).
#
# Wired into scripts/validate.sh (npm test) — CI fails when the loop arithmetic
# or the breaker semantics regress.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOOP="$ROOT/scripts/somi-loop.mjs"
FINDINGS="$ROOT/scripts/somi-findings.mjs"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failures=0
total=0
check() { # $1 = name, $2 = 0/1 pass
  total=$((total + 1))
  if [[ "$2" != "0" ]]; then
    echo "FAIL: $1" >&2
    failures=$((failures + 1))
  fi
}
expect_exit() { # $1 = name, $2 = expected code, then the command …
  local name="$1" want="$2" got=0; shift 2
  "$@" >/dev/null 2>&1 || got=$?
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $name — expected exit $want, got $got" >&2
    failures=$((failures + 1))
  fi
  total=$((total + 1))
}

# --- throwaway project repo ---------------------------------------------------
REPO="$TMP/repo"
mkdir -p "$REPO/src" "$REPO/.somi"
cd "$REPO"
git init -q -b main
git config user.email t@t && git config user.name t
printf 'one\n' > src/a.txt
printf 'one\n' > src/b.txt
git add -A && git commit -qm init

export CLAUDE_PROJECT_DIR="$REPO"
unset SOMI_CODE_LOOP_MAX_PASSES SOMI_CODE_LOOP_DIFF_CAP SOMI_CODE_LOOP_SEVERITY_FLOOR 2>/dev/null || true

# --- somi-loop: init + cap precedence ------------------------------------------
printf '{"code_loop": {"max_passes": 2, "diff_cap_lines": 10}}\n' > .somi/config.json
out="$(node "$LOOP" init --slug demo --loop code --iteration 1.1 --files "src/a.txt")"
check "init: config max_passes=2 wins over default" \
  "$(jq -e '.caps.max_passes == 2 and .caps.diff_cap_lines == 10' <<<"$out" >/dev/null; echo $?)"

out="$(SOMI_CODE_LOOP_MAX_PASSES=5 node "$LOOP" init --force --slug demo --loop code --iteration 1.1 --files "src/a.txt")"
check "init: env beats config" \
  "$(jq -e '.caps.max_passes == 5' <<<"$out" >/dev/null; echo $?)"

out="$(node "$LOOP" init --force --slug demo --loop code --iteration 1.1 --max-passes 1 --diff-cap 6 --files "src/a.txt")"
check "init: CLI flag beats env and config" \
  "$(jq -e '.caps.max_passes == 1 and .caps.diff_cap_lines == 6' <<<"$out" >/dev/null; echo $?)"

expect_exit "init: refuses to clobber a running loop without --force" 64 \
  node "$LOOP" init --slug demo --loop code --iteration 1.1 --files "src/a.txt"

# --- somi-loop: pass counting ---------------------------------------------------
node "$LOOP" pass --slug demo --iteration 1.1 >/dev/null
expect_exit "pass: exceeding max_passes exits 2" 2 \
  node "$LOOP" pass --slug demo --iteration 1.1

# --- somi-loop: weighted diff + exclusions --------------------------------------
printf 'one\ntwo\nthree\n' > src/a.txt          # in-scope: 2 added lines → weight 2
printf 'artifact churn\n' >> .somi/notes.md      # excluded entirely
out="$(node "$LOOP" check-diff --slug demo --iteration 1.1)"
check "check-diff: in-scope lines counted, .somi excluded" \
  "$(jq -e '.diff_lines == 2 and .weighted_lines == 2 and (.out_of_scope | length) == 0' <<<"$out" >/dev/null; echo $?)"

printf 'one\ntwo\nthree\n' > src/b.txt           # out-of-scope: 2 added lines → weight 4; total weighted 6 = cap
out="$(node "$LOOP" check-diff --slug demo --iteration 1.1)"
check "check-diff: out-of-scope counts double, at cap is ok" \
  "$(jq -e '.weighted_lines == 6 and .out_of_scope == ["src/b.txt"]' <<<"$out" >/dev/null; echo $?)"

printf 'four\n' >> src/b.txt                     # weighted 8 > cap 6
expect_exit "check-diff: over weighted cap exits 3" 3 \
  node "$LOOP" check-diff --slug demo --iteration 1.1

# F-220: `git diff` reads the index and tracked work-tree paths, so a file git
# has never been told about is in NEITHER -- a brand-new file counted zero until
# someone ran `git add`, and the cap under-measured by the whole size of every
# file an iteration introduced. Silently, and in the direction that lets work
# through. Measured on the same tree before and after the file exists, rather
# than asserted against a hardcoded total that would drift with the block above.
node "$LOOP" init --force --slug untracked --loop code --iteration 1.1 \
  --files "src/new.txt" --diff-cap 100 >/dev/null
before="$(node "$LOOP" check-diff --slug untracked --iteration 1.1 | jq .diff_lines)"
printf 'x\ny\nz\n' > src/new.txt               # untracked: never `git add`ed
after="$(node "$LOOP" check-diff --slug untracked --iteration 1.1 | jq .diff_lines)"
check "check-diff: an untracked file counts its lines (F-220)" \
  "$([[ "$after" == "$((before + 3))" ]]; echo $?)"

printf 'churn\n' > .somi/untracked-note.md       # excluded pathspec, must stay 0
after2="$(node "$LOOP" check-diff --slug untracked --iteration 1.1 | jq .diff_lines)"
check "check-diff: untracked .somi files stay excluded (F-220)" \
  "$([[ "$after2" == "$after" ]]; echo $?)"

# --- somi-loop: record/finish/resume (session-death recovery) -------------------
node "$LOOP" record-pass --slug demo --iteration 1.1 --verdict request-changes --blockers 0 --majors 2 >/dev/null
out="$(node "$LOOP" resume --slug demo --iteration 1.1)"
check "resume: state survives with pass count and history" \
  "$(jq -e '.pass == 1 and (.history | length) == 1 and .status == "running"' <<<"$out" >/dev/null; echo $?)"
node "$LOOP" finish --slug demo --iteration 1.1 --status stopped-diff-cap >/dev/null
out="$(node "$LOOP" stats --slug demo --iteration 1.1)"
check "finish: status recorded for the run ledger" \
  "$(jq -e '.status == "stopped-diff-cap"' <<<"$out" >/dev/null; echo $?)"

# --- somi-loop: mid-loop cap re-resolution without --force (F-29) ---------------
# commands/code-loop.md's documented remedy for a fired gate: "the user adjusts the
# env var explicitly and re-runs — the loop does not 'decide' to widen its own
# bounds." Before this fix, caps were resolved only at `init` and frozen into state:
# setting the env var and re-running `pass`/`check-diff` changed nothing, and the
# only path that DID re-resolve (`init --force`) discarded pass history — the one
# thing a mid-loop raise must not do. This block is the regression guard: it fails
# red against the pre-fix scripts/somi-loop.mjs (verified by hand, not committed —
# see the coder's summary) and asserts the remedy now actually works, on the SAME
# subcommand, without losing baseline/history, with the raise persisted for audit.
#
# Runs against ITS OWN throwaway repo — $REPO above has, by this point, accumulated
# scenario-specific mutations to src/a.txt and src/b.txt plus an untracked src/new.txt
# from earlier sections; none are in capfix's iteration_files, so every one of them
# would count double against its narrow 4-line cap. Same reasoning as the golden
# section further down, which isolates itself for exactly this reason.
F29_REPO="$TMP/f29-repo"
mkdir -p "$F29_REPO/src" "$F29_REPO/.somi"
(
  cd "$F29_REPO"
  git init -q -b main
  git config user.email t@t && git config user.name t
  printf 'one\n' > src/a.txt
  git add -A && git commit -qm init
)
export CLAUDE_PROJECT_DIR="$F29_REPO"
cd "$F29_REPO"
unset SOMI_CODE_LOOP_MAX_PASSES SOMI_CODE_LOOP_DIFF_CAP 2>/dev/null || true

node "$LOOP" init --slug capfix --loop code --iteration 1.1 \
  --files "src/capfix.txt" --max-passes 1 --diff-cap 4 >/dev/null
baseline_before="$(node "$LOOP" stats --slug capfix --iteration 1.1 | jq -r .baseline_sha)"

node "$LOOP" pass --slug capfix --iteration 1.1 >/dev/null                      # pass 1 of 1 — ok
node "$LOOP" record-pass --slug capfix --iteration 1.1 \
  --verdict request-changes --blockers 0 --majors 1 >/dev/null
expect_exit "F-29: pass beyond max_passes still gates before any override" 2 \
  node "$LOOP" pass --slug capfix --iteration 1.1

# `|| true` below: under `set -euo pipefail`, a bare `var=$(cmd)` that exits
# non-zero aborts the WHOLE suite right here with no test name and every check
# below unreported — reproduced by hand against the pre-fix script (exit 2,
# "max-passes-exceeded: pass 2 > cap 1"). `|| true` keeps a regression a reported
# `check` failure instead of a silent suite death.
out="$(SOMI_CODE_LOOP_MAX_PASSES=5 node "$LOOP" pass --slug capfix --iteration 1.1)" || true
check "F-29: env var re-run of the SAME subcommand (no --force) honours the raised cap" \
  "$(jq -e '.max_passes == 5 and .pass == 2' <<<"$out" >/dev/null; echo $?)"
unset SOMI_CODE_LOOP_MAX_PASSES 2>/dev/null || true

out="$(node "$LOOP" stats --slug capfix --iteration 1.1)"
check "F-29: baseline_sha untouched by the override" \
  "$([[ "$(jq -r .baseline_sha <<<"$out")" == "$baseline_before" ]]; echo $?)"
check "F-29: pass history from before the override survives (still 1 entry)" \
  "$(jq -e '(.history | length) == 1 and .history[0].verdict == "request-changes"' <<<"$out" >/dev/null; echo $?)"
check "F-29: the raise is persisted as an auditable cap_overrides entry, after_pass recorded pre-increment" \
  "$(jq -e '.cap_overrides | length == 1 and .[0].field == "max_passes" and .[0].from == 1 and .[0].to == 5 and .[0].source == "env" and .[0].after_pass == 1' <<<"$out" >/dev/null; echo $?)"

# Same shape for diff_cap_lines, via the CLI flag instead of the env var (the other
# documented-precedence entry point — see commands/code-loop.md).
printf 'one\ntwo\nthree\n' > src/capfix.txt                # untracked, in-scope: +3 lines, under cap 4
out="$(node "$LOOP" check-diff --slug capfix --iteration 1.1)"
check "F-29: check-diff under the original cap needs no override" \
  "$(jq -e '.cap == 4 and .weighted_lines == 3' <<<"$out" >/dev/null; echo $?)"

printf 'four\nfive\n' >> src/capfix.txt                    # now +5 lines, weighted 5 > cap 4
expect_exit "F-29: check-diff over the original cap still gates before any override" 3 \
  node "$LOOP" check-diff --slug capfix --iteration 1.1

# Same `|| true` reasoning as the env-var re-run above — this bare substitution
# would exit 3 (diff-cap-exceeded) against the pre-fix script and abort the suite.
out="$(node "$LOOP" check-diff --slug capfix --iteration 1.1 --diff-cap 10)" || true
check "F-29: --diff-cap flag re-run of the SAME subcommand (no --force) honours the raised cap" \
  "$(jq -e '.cap == 10 and .weighted_lines == 5' <<<"$out" >/dev/null; echo $?)"

out="$(node "$LOOP" stats --slug capfix --iteration 1.1)"
check "F-29: pass/history/baseline still untouched after the diff-cap override too" \
  "$(jq -e '.pass == 2 and (.history | length) == 1' <<<"$out" >/dev/null; echo $?)"
check "F-29: baseline_sha still untouched after the diff-cap override" \
  "$([[ "$(jq -r .baseline_sha <<<"$out")" == "$baseline_before" ]]; echo $?)"
check "F-29: both overrides are recorded, in order, in cap_overrides, after_pass recorded correctly" \
  "$(jq -e '.cap_overrides | length == 2 and .[1].field == "diff_cap_lines" and .[1].from == 4 and .[1].to == 10 and .[1].source == "cli" and .[1].after_pass == 2' <<<"$out" >/dev/null; echo $?)"

# --- malformed cap values must be rejected, not silently coerced to NaN/null ----
# `Number()` on "1,000"/"unlimited"/"none" yields NaN, which is FALSE against BOTH
# gate comparisons (`cur + 1 > max`, `weighted > cap`) — the gate goes fail-open —
# and `JSON.stringify` then persists that NaN as `null`, which the next bare call
# falls through past (via firstDefined) to re-arm at the DEFAULT, with no
# cap_overrides entry recording the reversion. validateCap() rejects (exit 64)
# rather than coerces. Verified on both gates, both entry points (env AND flag).
before="$(node "$LOOP" stats --slug capfix --iteration 1.1)"

expect_exit "F-29: malformed SOMI_CODE_LOOP_MAX_PASSES env var is rejected (64), not silently disabled" 64 \
  env SOMI_CODE_LOOP_MAX_PASSES=unlimited node "$LOOP" pass --slug capfix --iteration 1.1
expect_exit "F-29: malformed --max-passes flag is rejected (64), not silently disabled" 64 \
  node "$LOOP" pass --slug capfix --iteration 1.1 --max-passes '1,000'
expect_exit "F-29: malformed SOMI_CODE_LOOP_DIFF_CAP env var is rejected (64), not silently disabled" 64 \
  env SOMI_CODE_LOOP_DIFF_CAP=unlimited node "$LOOP" check-diff --slug capfix --iteration 1.1
expect_exit "F-29: malformed --diff-cap flag is rejected (64), not silently disabled" 64 \
  node "$LOOP" check-diff --slug capfix --iteration 1.1 --diff-cap none

after="$(node "$LOOP" stats --slug capfix --iteration 1.1)"
check "F-29: every rejected malformed value left caps/cap_overrides/pass/history byte-identical" \
  "$([[ "$before" == "$after" ]]; echo $?)"

out="$(node "$LOOP" finish --slug capfix --iteration 1.1 --status stopped-max-passes-exceeded)"
check "F-29: finish's stdout surfaces cap_overrides too, not just the gitignored state file" \
  "$(jq -e '.cap_overrides | length == 2' <<<"$out" >/dev/null; echo $?)"
# Deliberately NOT "stopped-diff-cap" (the pre-existing spelling two blocks up, at
# line 116) — that bare reason matches neither CAP_BREACH_STATUSES
# (tests/evals/lib/convergence.mjs) nor commands/code-loop.md's documented status
# list; a separate open item, not to be copied here.

# --- somi-loop (plan): mirrors the code-loop F-29 block above for `--loop plan` -
# Plan loops have exactly one hard gate (`max_passes`); `diff_cap_lines` always
# short-circuits to 0 for the plan family in reresolveCap()/resolveInitCap(), so
# `--diff-cap` must be provably inert regardless of what's passed — asserted below
# rather than only "verified by hand" as pass 1's review left it.
PLAN29_REPO="$TMP/plan29-repo"
mkdir -p "$PLAN29_REPO/src" "$PLAN29_REPO/.somi"
(
  cd "$PLAN29_REPO"
  git init -q -b main
  git config user.email t@t && git config user.name t
  printf 'one\n' > src/a.txt
  git add -A && git commit -qm init
)
export CLAUDE_PROJECT_DIR="$PLAN29_REPO"
cd "$PLAN29_REPO"
unset SOMI_PLAN_LOOP_MAX_PASSES 2>/dev/null || true

node "$LOOP" init --slug planfix --loop plan --max-passes 1 >/dev/null
plan_baseline_before="$(node "$LOOP" stats --slug planfix | jq -r .baseline_sha)"

node "$LOOP" pass --slug planfix >/dev/null                       # pass 1 of 1 — ok
expect_exit "F-29 (plan): pass beyond max_passes still gates before any override" 2 \
  node "$LOOP" pass --slug planfix

out="$(SOMI_PLAN_LOOP_MAX_PASSES=5 node "$LOOP" pass --slug planfix)" || true
check "F-29 (plan): env var re-run of the SAME subcommand (no --force) honours the raised cap" \
  "$(jq -e '.max_passes == 5 and .pass == 2' <<<"$out" >/dev/null; echo $?)"
unset SOMI_PLAN_LOOP_MAX_PASSES 2>/dev/null || true

out="$(node "$LOOP" stats --slug planfix)"
check "F-29 (plan): baseline_sha untouched by the override" \
  "$([[ "$(jq -r .baseline_sha <<<"$out")" == "$plan_baseline_before" ]]; echo $?)"
check "F-29 (plan): the raise is persisted as an auditable cap_overrides entry" \
  "$(jq -e '.cap_overrides | length == 1 and .[0].field == "max_passes" and .[0].from == 1 and .[0].to == 5 and .[0].source == "env" and .[0].after_pass == 1' <<<"$out" >/dev/null; echo $?)"

out="$(node "$LOOP" check-diff --slug planfix --diff-cap 999999)"
check "F-29 (plan): --diff-cap is inert on a plan loop — cap stays 0 regardless" \
  "$(jq -e '.cap == 0' <<<"$out" >/dev/null; echo $?)"
out="$(node "$LOOP" stats --slug planfix)"
check "F-29 (plan): the inert --diff-cap flag records no cap_overrides entry" \
  "$(jq -e '.cap_overrides | length == 1' <<<"$out" >/dev/null; echo $?)"

out="$(node "$LOOP" finish --slug planfix --status stopped-max-passes-exceeded)"
check "F-29 (plan): finish's stdout surfaces cap_overrides too" \
  "$(jq -e '.cap_overrides | length == 1' <<<"$out" >/dev/null; echo $?)"

# Restore the shared $REPO context for every section below.
export CLAUDE_PROJECT_DIR="$REPO"
cd "$REPO"

# --- somi-findings: identity + breaker semantics --------------------------------
F1='[{"file":"src/a.txt","symbol":"HandleWebhook","title":"Missing rate limit on retry path","severity":"Major","confidence":"High"}]'

out="$(printf '%s' "$F1" | node "$FINDINGS" record --slug demo --review r1.md --run RUN1 --pass 1)"
check "record: first sighting is new" \
  "$(jq -e '.state == "new" and .id == "F-1"' <<<"$out" >/dev/null; echo $?)"

# Same locus, different line/wording case, next consecutive pass → breaker (exit 5).
F1b='[{"file":"src/a.txt","symbol":"handlewebhook","title":"missing rate limit on retry path","severity":"Major"}]'
got=0; out="$(printf '%s' "$F1b" | node "$FINDINGS" record --slug demo --review r2.md --run RUN1 --pass 2)" || got=$?
check "record: consecutive-pass recurrence exits 5" "$([[ "$got" == "5" ]]; echo $?)"
check "record: recurrence classified consecutive" \
  "$(jq -e '.state == "known" and .recurring_consecutive == true' <<<"$out" >/dev/null; echo $?)"

# A different run (e.g. a later /code-loop) seeing the same open finding → cross-run.
got=0; out="$(printf '%s' "$F1" | node "$FINDINGS" record --slug demo --review r3.md --run RUN2 --pass 1)" || got=$?
check "record: cross-run recurrence flagged, not consecutive" \
  "$(jq -e '.recurring_cross_run == true and .recurring_consecutive == false' <<<"$out" >/dev/null; echo $?)"
check "record: cross-run alone does not exit 5" "$([[ "$got" == "0" ]]; echo $?)"

# Resolve → open list empties → re-report of same locus becomes a NEW finding.
node "$FINDINGS" resolve --slug demo --id F-1 --status fixed --by r4.md >/dev/null
out="$(node "$FINDINGS" open --slug demo)"
check "resolve: open list is empty after fix" \
  "$(jq -e 'length == 0' <<<"$out" >/dev/null; echo $?)"
out="$(printf '%s' "$F1" | node "$FINDINGS" record --slug demo --review r5.md --run RUN3 --pass 1)"
check "record: resolved locus re-reported becomes a new finding (F-2)" \
  "$(jq -e '.state == "new" and .id == "F-2"' <<<"$out" >/dev/null; echo $?)"

# Ledger lives with the review artifacts.
check "ledger: stored under .somi/reviews/<slug>/findings.json" \
  "$([[ -f "$REPO/.somi/reviews/demo/findings.json" ]]; echo $?)"

# --- somi-findings: record surfaces a clean error, not a raw crash, when the stdin
# read itself fails (fix-stdin-read-crash: fs.readFileSync(0) threw uncaught on any OS
# error — e.g. Windows' EAGAIN for a TTY stdin — bypassing this script's own die()/exit-64
# convention). Mocked platform-independently via a --require preload; see the fixture's
# header comment. -----------------------------------------------------------------------
STDIN_THROW_MOCK="$ROOT/tests/scripts/fixtures/mock-stdin-read-throw.cjs"
got=0
err="$(node --require "$STDIN_THROW_MOCK" "$FINDINGS" record --slug demo --review r6.md --run RUN4 --pass 1 2>&1 >/dev/null)" || got=$?
check "record: stdin read failure exits via die() (64), not an uncaught crash" "$([[ "$got" == "64" ]]; echo $?)"
check "record: stdin read failure prints the die() message, not a raw stack trace" \
  "$([[ "$err" == "somi-findings: "* && "$err" != *"at Object."* ]]; echo $?)"

# --- somi-check: portable working-tree guard -------------------------------------
CHECK="$ROOT/scripts/somi-check.mjs"

printf 'KEY=1\n' > .env && git add .env
expect_exit "somi-check: staged .env fails" 1 node "$CHECK" --staged
git rm -q --cached .env && rm .env

printf 'KEY=\n' > .env.example && git add .env.example
expect_exit "somi-check: staged .env.example passes" 0 node "$CHECK" --staged
git rm -q --cached .env.example && rm .env.example

printf '{}\n' > package-lock.json && git add package-lock.json
expect_exit "somi-check: lockfile without manifest fails" 1 node "$CHECK" --staged
printf '{"name":"t"}\n' > package.json && git add package.json
expect_exit "somi-check: lockfile WITH manifest passes" 0 node "$CHECK" --staged
git rm -q --cached package.json && rm package.json
printf '{"lockfiles": {"allow_edit": true}}\n' > .somi/config.json
expect_exit "somi-check: config allow_edit passes bare lockfile" 0 node "$CHECK" --staged
got=0; SOMI_ALLOW_LOCKFILES=0 node "$CHECK" --staged >/dev/null 2>&1 || got=$?
check "somi-check: env=0 beats config allow_edit" "$([[ "$got" == "1" ]]; echo $?)"
git rm -q --cached package-lock.json && rm package-lock.json

printf 'x\n# TODO(claude): fix me\n' > src/todo.txt && git add src/todo.txt
expect_exit "somi-check: staged TODO(claude) marker fails" 1 node "$CHECK" --staged
git rm -q --cached src/todo.txt && rm src/todo.txt

expect_exit "somi-check: clean staged set passes" 0 node "$CHECK" --staged

# --- golden snapshots: byte-level diff target for the Node port (additive) ------
#
# Everything above asserts *behavioral properties* (cap precedence, weighting,
# recurrence semantics) — sufficient to gate this bash implementation, but it gives
# Phase 1's Node port no byte-level "does this match?" target. This section runs a
# second, independent, fully-scripted scenario against ITS OWN throwaway repo (kept
# separate from $REPO above, which by this point has accumulated a lot of
# scenario-specific mutations — reusing it would couple golden ordering to the
# inline assertions' ordering) and records each invocation's {argv, exit, stdout,
# stderr} — normalized — into a golden file. It never touches the checks above.
#
# Mode: `SOMI_GOLDEN_MODE=capture bash tests/scripts/run.sh` (re)writes the golden
# files under tests/scripts/goldens/; the default, `check` (every normal dev/CI
# run), replays the same scenario and fails loudly on any drift from what's
# committed. Once Phase 1 points $LOOP/$FINDINGS at the Node CLIs, `check` mode
# is exactly the parity gate: same scenario, same normalization, byte-for-byte
# comparison — a divergence here is a real behavior regression, not noise.
#
# Golden layout: one consolidated, pretty-printed JSON array per source script
# (tests/scripts/goldens/somi-loop.json, .../somi-findings.json) rather than one
# file per scenario — fewer files to keep in sync; each array element is still a
# self-contained {name, argv, exit, stdout, stderr} record, so a mismatch's `diff
# -u` output identifies the offending scenario by its "name" field without any
# extra tooling.
#
# Normalization masks ONLY values that legitimately vary run-to-run — never JSON
# key order, spacing, or field presence, since that IS the thing a Node port must
# reproduce exactly:
#   - full ISO-8601 instants (YYYY-MM-DDTHH:MM:SSZ) -> <TS>   (loop's started/at/finished)
#   - bare dates             (YYYY-MM-DD)           -> <DATE> (findings' seen[].date)
#   - 40-hex git SHAs                                -> <SHA>  (loop's baseline_sha)
#   - this golden run's own throwaway-repo path      -> <DIR>  (loop's state_file / jq input_filename)
# Order matters: instants are masked before bare dates, else the bare-date pattern
# would also eat the date portion of an instant, leaving a mangled "<DATE>T.....Z".
GOLDEN_DIR="$ROOT/tests/scripts/goldens"
GOLDEN_MODE="${SOMI_GOLDEN_MODE:-check}"
case "$GOLDEN_MODE" in
  capture|check) ;;
  *) echo "SOMI_GOLDEN_MODE must be 'capture' or 'check' (got: $GOLDEN_MODE)" >&2; exit 64 ;;
esac
mkdir -p "$GOLDEN_DIR"

GTMP="$TMP/goldens"
GREPO="$GTMP/repo"
mkdir -p "$GREPO/src" "$GREPO/.somi"
(
  cd "$GREPO"
  git init -q -b main
  git config user.email t@t && git config user.name t
  printf 'one\n' > src/a.txt
  printf 'one\n' > src/b.txt
  git add -A && git commit -qm init
)
export CLAUDE_PROJECT_DIR="$GREPO"
unset SOMI_CODE_LOOP_MAX_PASSES SOMI_CODE_LOOP_DIFF_CAP SOMI_CODE_LOOP_SEVERITY_FLOOR \
      SOMI_PLAN_LOOP_MAX_PASSES SOMI_PLAN_LOOP_DIFF_CAP SOMI_PLAN_LOOP_SEVERITY_FLOOR 2>/dev/null || true
cd "$GREPO"

GSTEP_EXIT=0 GSTEP_STDOUT="" GSTEP_STDERR=""
golden_step() { # $@ = command (no stdin)
  local out err rc=0
  out="$(mktemp)"; err="$(mktemp)"
  if "$@" >"$out" 2>"$err"; then rc=0; else rc=$?; fi
  GSTEP_EXIT=$rc; GSTEP_STDOUT="$(cat "$out")"; GSTEP_STDERR="$(cat "$err")"
  rm -f "$out" "$err"
}
golden_step_stdin() { # $1 = stdin payload, then command
  local payload="$1"; shift
  local out err rc=0
  out="$(mktemp)"; err="$(mktemp)"
  if printf '%s' "$payload" | "$@" >"$out" 2>"$err"; then rc=0; else rc=$?; fi
  GSTEP_EXIT=$rc; GSTEP_STDOUT="$(cat "$out")"; GSTEP_STDERR="$(cat "$err")"
  rm -f "$out" "$err"
}
golden_normalize() { # stdin -> normalized text on stdout
  local text
  text="$(cat)"
  text="$(printf '%s' "$text" | sed -E \
    -e 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z/<TS>/g' \
    -e 's/[0-9]{4}-[0-9]{2}-[0-9]{2}/<DATE>/g' \
    -e 's/[0-9a-f]{40}/<SHA>/g')"
  printf '%s' "${text//$GTMP/<DIR>}"
}
golden_case() { # $1=script $2=name, then argv... (uses GSTEP_* set by the caller)
  local script="$1" name="$2"; shift 2
  local argv_json norm_out norm_err
  argv_json="$(printf '%s\n' "$@" | jq -R . | jq -s .)"
  norm_out="$(printf '%s' "$GSTEP_STDOUT" | golden_normalize)"
  norm_err="$(printf '%s' "$GSTEP_STDERR" | golden_normalize)"
  jq -nc --arg script "$script" --arg name "$name" --argjson argv "$argv_json" \
     --argjson exit "$GSTEP_EXIT" --arg stdout "$norm_out" --arg stderr "$norm_err" \
     '{script:$script, name:$name, argv:$argv, exit:$exit, stdout:$stdout, stderr:$stderr}'
}
golden_case_stdin() { # $1=script $2=name $3=stdin, then argv...
  local script="$1" name="$2" stdin_payload="$3"; shift 3
  local argv_json norm_out norm_err
  argv_json="$(printf '%s\n' "$@" | jq -R . | jq -s .)"
  norm_out="$(printf '%s' "$GSTEP_STDOUT" | golden_normalize)"
  norm_err="$(printf '%s' "$GSTEP_STDERR" | golden_normalize)"
  jq -nc --arg script "$script" --arg name "$name" --argjson argv "$argv_json" --arg stdin "$stdin_payload" \
     --argjson exit "$GSTEP_EXIT" --arg stdout "$norm_out" --arg stderr "$norm_err" \
     '{script:$script, name:$name, argv:$argv, stdin:$stdin, exit:$exit, stdout:$stdout, stderr:$stderr}'
}

LOOP_GOLDEN_CASES=()
FINDINGS_GOLDEN_CASES=()

# --- somi-loop: init, pass, check-diff (in/out-of-scope, at/over cap), record-pass, resume, finish, stats
printf '{"code_loop": {"max_passes": 2, "diff_cap_lines": 10}}\n' > .somi/config.json

golden_step node "$LOOP" init --slug g --loop code --iteration 1.1 --files "src/a.txt"
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "init: config-resolved caps" init --slug g --loop code --iteration 1.1 --files "src/a.txt")")

golden_step node "$LOOP" pass --slug g --iteration 1.1
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "pass: 1st pass (1 of 2)" pass --slug g --iteration 1.1)")

golden_step node "$LOOP" pass --slug g --iteration 1.1
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "pass: 2nd pass (2 of 2, at cap, allowed)" pass --slug g --iteration 1.1)")

golden_step node "$LOOP" pass --slug g --iteration 1.1
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "pass: 3rd pass exceeds max_passes (exit 2)" pass --slug g --iteration 1.1)")

printf 'one\ntwo\nthree\n' > src/a.txt                         # in-scope: +2 lines
golden_step node "$LOOP" check-diff --slug g --iteration 1.1
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "check-diff: in-scope only, under cap" check-diff --slug g --iteration 1.1)")

printf 'one\ntwo\nthree\nfour\nfive\n' > src/b.txt              # out-of-scope: +4 lines -> weight 8; total 2+8=10 = cap
golden_step node "$LOOP" check-diff --slug g --iteration 1.1
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "check-diff: out-of-scope doubled, exactly at cap" check-diff --slug g --iteration 1.1)")

printf 'six\n' >> src/b.txt                                    # +1 more out-of-scope line -> weight 12 > cap 10
golden_step node "$LOOP" check-diff --slug g --iteration 1.1
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "check-diff: over weighted cap (exit 3)" check-diff --slug g --iteration 1.1)")

golden_step node "$LOOP" record-pass --slug g --iteration 1.1 --verdict request-changes --blockers 0 --majors 2
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "record-pass: appends history entry" record-pass --slug g --iteration 1.1 --verdict request-changes --blockers 0 --majors 2)")

golden_step node "$LOOP" resume --slug g --iteration 1.1
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "resume: state with pass count and history" resume --slug g --iteration 1.1)")

golden_step node "$LOOP" finish --slug g --iteration 1.1 --status stopped-diff-cap
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "finish: records terminal status" finish --slug g --iteration 1.1 --status stopped-diff-cap)")

golden_step node "$LOOP" stats --slug g --iteration 1.1
LOOP_GOLDEN_CASES+=("$(golden_case somi-loop.sh "stats: full state ledger" stats --slug g --iteration 1.1)")

# --- somi-findings: record (new/consecutive/cross-run), resolve, open, reopen, get
GF1='[{"file":"src/a.txt","symbol":"HandleWebhook","title":"Missing rate limit on retry path","severity":"Major","confidence":"High"}]'
GF1b='[{"file":"src/a.txt","symbol":"handlewebhook","title":"missing rate limit on retry path","severity":"Major"}]'

golden_step_stdin "$GF1" node "$FINDINGS" record --slug gf --review r1.md --run RUN1 --pass 1
FINDINGS_GOLDEN_CASES+=("$(golden_case_stdin somi-findings.sh "record: first sighting is new (F-1)" "$GF1" record --slug gf --review r1.md --run RUN1 --pass 1)")

golden_step_stdin "$GF1b" node "$FINDINGS" record --slug gf --review r2.md --run RUN1 --pass 2
FINDINGS_GOLDEN_CASES+=("$(golden_case_stdin somi-findings.sh "record: consecutive-pass recurrence (exit 5)" "$GF1b" record --slug gf --review r2.md --run RUN1 --pass 2)")

golden_step_stdin "$GF1" node "$FINDINGS" record --slug gf --review r3.md --run RUN2 --pass 1
FINDINGS_GOLDEN_CASES+=("$(golden_case_stdin somi-findings.sh "record: cross-run recurrence (exit 0, not consecutive)" "$GF1" record --slug gf --review r3.md --run RUN2 --pass 1)")

golden_step node "$FINDINGS" resolve --slug gf --id F-1 --status fixed --by r4.md
FINDINGS_GOLDEN_CASES+=("$(golden_case somi-findings.sh "resolve: F-1 fixed" resolve --slug gf --id F-1 --status fixed --by r4.md)")

golden_step node "$FINDINGS" open --slug gf
FINDINGS_GOLDEN_CASES+=("$(golden_case somi-findings.sh "open: empty after resolve" open --slug gf)")

golden_step_stdin "$GF1" node "$FINDINGS" record --slug gf --review r5.md --run RUN3 --pass 1
FINDINGS_GOLDEN_CASES+=("$(golden_case_stdin somi-findings.sh "record: resolved locus re-reported becomes new (F-2)" "$GF1" record --slug gf --review r5.md --run RUN3 --pass 1)")

golden_step node "$FINDINGS" reopen --slug gf --id F-1 --by r6.md
FINDINGS_GOLDEN_CASES+=("$(golden_case somi-findings.sh "reopen: F-1 back to open" reopen --slug gf --id F-1 --by r6.md)")

golden_step node "$FINDINGS" get --slug gf --id F-1
FINDINGS_GOLDEN_CASES+=("$(golden_case somi-findings.sh "get: F-1 (reopened)" get --slug gf --id F-1)")

golden_step node "$FINDINGS" get --slug gf --id F-2
FINDINGS_GOLDEN_CASES+=("$(golden_case somi-findings.sh "get: F-2" get --slug gf --id F-2)")

# --- normalize_title edge cases: each isolated on its own fresh slug, so the locus
# key it produces is directly comparable (only the title varies). The empty-title
# case is pinned to REALITY, not an invented pass: `record` requires both {file,
# title} and dies 64 before ever calling normalize_title, so its golden is the
# usage-error shape, not a fabricated success.
golden_edge_case() { # $1=slug $2=label $3=title
  local slug="$1" label="$2" title="$3" payload
  payload="$(jq -nc --arg f src/a.txt --arg t "$title" '[{file:$f, title:$t}]')"
  golden_step_stdin "$payload" node "$FINDINGS" record --slug "$slug" --review r.md --run R1 --pass 1
  FINDINGS_GOLDEN_CASES+=("$(golden_case_stdin somi-findings.sh "normalize_title: $label — record" "$payload" record --slug "$slug" --review r.md --run R1 --pass 1)")
  if [[ "$GSTEP_EXIT" == "0" ]]; then
    golden_step node "$FINDINGS" get --slug "$slug" --id F-1
    FINDINGS_GOLDEN_CASES+=("$(golden_case somi-findings.sh "normalize_title: $label — get (exposes key)" get --slug "$slug" --id F-1)")
  fi
}
golden_edge_case edge-empty      "empty title (dies 64, never reaches normalize_title)" ""
golden_edge_case edge-single     "single word"                "Bug"
golden_edge_case edge-many       ">8 words truncates"         "one two three four five six seven eight nine ten"
golden_edge_case edge-ws         "leading/trailing whitespace" "   Missing rate limit   "
golden_edge_case edge-multispace "multiple internal spaces"    "Missing   rate    limit"
golden_edge_case edge-punct      "punctuation stripped"        "Missing rate-limit! (on retry) path?"

# --- write (capture) or compare (check) ------------------------------------------
golden_compare() { # $1 = golden file path, $2 = freshly-captured JSON array content
  local file="$1" content="$2"
  total=$((total + 1))
  if [[ "$GOLDEN_MODE" == "capture" ]]; then
    printf '%s\n' "$content" > "$file"
    echo "captured golden: $file"
    return
  fi
  if [[ ! -f "$file" ]]; then
    echo "FAIL: golden missing — $file (run: SOMI_GOLDEN_MODE=capture bash tests/scripts/run.sh)" >&2
    failures=$((failures + 1))
    return
  fi
  if ! diff -u "$file" <(printf '%s\n' "$content") >&2; then
    echo "FAIL: golden mismatch — $file" >&2
    failures=$((failures + 1))
  fi
}
golden_compare "$GOLDEN_DIR/somi-loop.json" "$(printf '%s\n' "${LOOP_GOLDEN_CASES[@]}" | jq -s '.')"
golden_compare "$GOLDEN_DIR/somi-findings.json" "$(printf '%s\n' "${FINDINGS_GOLDEN_CASES[@]}" | jq -s '.')"

# --- summary --------------------------------------------------------------------
if (( failures > 0 )); then
  echo "script tests: $failures of $total checks FAILED" >&2
  exit 1
fi
echo "script tests: all $total checks passed."
