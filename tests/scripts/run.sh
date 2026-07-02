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
LOOP="$ROOT/scripts/somi-loop.sh"
FINDINGS="$ROOT/scripts/somi-findings.sh"

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
out="$(bash "$LOOP" init --slug demo --loop code --iteration 1.1 --files "src/a.txt")"
check "init: config max_passes=2 wins over default" \
  "$(jq -e '.caps.max_passes == 2 and .caps.diff_cap_lines == 10' <<<"$out" >/dev/null; echo $?)"

out="$(SOMI_CODE_LOOP_MAX_PASSES=5 bash "$LOOP" init --force --slug demo --loop code --iteration 1.1 --files "src/a.txt")"
check "init: env beats config" \
  "$(jq -e '.caps.max_passes == 5' <<<"$out" >/dev/null; echo $?)"

out="$(bash "$LOOP" init --force --slug demo --loop code --iteration 1.1 --max-passes 1 --diff-cap 6 --files "src/a.txt")"
check "init: CLI flag beats env and config" \
  "$(jq -e '.caps.max_passes == 1 and .caps.diff_cap_lines == 6' <<<"$out" >/dev/null; echo $?)"

expect_exit "init: refuses to clobber a running loop without --force" 64 \
  bash "$LOOP" init --slug demo --loop code --iteration 1.1 --files "src/a.txt"

# --- somi-loop: pass counting ---------------------------------------------------
bash "$LOOP" pass --slug demo --iteration 1.1 >/dev/null
expect_exit "pass: exceeding max_passes exits 2" 2 \
  bash "$LOOP" pass --slug demo --iteration 1.1

# --- somi-loop: weighted diff + exclusions --------------------------------------
printf 'one\ntwo\nthree\n' > src/a.txt          # in-scope: 2 added lines → weight 2
printf 'artifact churn\n' >> .somi/notes.md      # excluded entirely
out="$(bash "$LOOP" check-diff --slug demo --iteration 1.1)"
check "check-diff: in-scope lines counted, .somi excluded" \
  "$(jq -e '.diff_lines == 2 and .weighted_lines == 2 and (.out_of_scope | length) == 0' <<<"$out" >/dev/null; echo $?)"

printf 'one\ntwo\nthree\n' > src/b.txt           # out-of-scope: 2 added lines → weight 4; total weighted 6 = cap
out="$(bash "$LOOP" check-diff --slug demo --iteration 1.1)"
check "check-diff: out-of-scope counts double, at cap is ok" \
  "$(jq -e '.weighted_lines == 6 and .out_of_scope == ["src/b.txt"]' <<<"$out" >/dev/null; echo $?)"

printf 'four\n' >> src/b.txt                     # weighted 8 > cap 6
expect_exit "check-diff: over weighted cap exits 3" 3 \
  bash "$LOOP" check-diff --slug demo --iteration 1.1

# --- somi-loop: record/finish/resume (session-death recovery) -------------------
bash "$LOOP" record-pass --slug demo --iteration 1.1 --verdict request-changes --blockers 0 --majors 2 >/dev/null
out="$(bash "$LOOP" resume --slug demo --iteration 1.1)"
check "resume: state survives with pass count and history" \
  "$(jq -e '.pass == 1 and (.history | length) == 1 and .status == "running"' <<<"$out" >/dev/null; echo $?)"
bash "$LOOP" finish --slug demo --iteration 1.1 --status stopped-diff-cap >/dev/null
out="$(bash "$LOOP" stats --slug demo --iteration 1.1)"
check "finish: status recorded for the run ledger" \
  "$(jq -e '.status == "stopped-diff-cap"' <<<"$out" >/dev/null; echo $?)"

# --- somi-findings: identity + breaker semantics --------------------------------
F1='[{"file":"src/a.txt","symbol":"HandleWebhook","title":"Missing rate limit on retry path","severity":"Major","confidence":"High"}]'

out="$(printf '%s' "$F1" | bash "$FINDINGS" record --slug demo --review r1.md --run RUN1 --pass 1)"
check "record: first sighting is new" \
  "$(jq -e '.state == "new" and .id == "F-1"' <<<"$out" >/dev/null; echo $?)"

# Same locus, different line/wording case, next consecutive pass → breaker (exit 5).
F1b='[{"file":"src/a.txt","symbol":"handlewebhook","title":"missing rate limit on retry path","severity":"Major"}]'
got=0; out="$(printf '%s' "$F1b" | bash "$FINDINGS" record --slug demo --review r2.md --run RUN1 --pass 2)" || got=$?
check "record: consecutive-pass recurrence exits 5" "$([[ "$got" == "5" ]]; echo $?)"
check "record: recurrence classified consecutive" \
  "$(jq -e '.state == "known" and .recurring_consecutive == true' <<<"$out" >/dev/null; echo $?)"

# A different run (e.g. a later /code-loop) seeing the same open finding → cross-run.
got=0; out="$(printf '%s' "$F1" | bash "$FINDINGS" record --slug demo --review r3.md --run RUN2 --pass 1)" || got=$?
check "record: cross-run recurrence flagged, not consecutive" \
  "$(jq -e '.recurring_cross_run == true and .recurring_consecutive == false' <<<"$out" >/dev/null; echo $?)"
check "record: cross-run alone does not exit 5" "$([[ "$got" == "0" ]]; echo $?)"

# Resolve → open list empties → re-report of same locus becomes a NEW finding.
bash "$FINDINGS" resolve --slug demo --id F-1 --status fixed --by r4.md >/dev/null
out="$(bash "$FINDINGS" open --slug demo)"
check "resolve: open list is empty after fix" \
  "$(jq -e 'length == 0' <<<"$out" >/dev/null; echo $?)"
out="$(printf '%s' "$F1" | bash "$FINDINGS" record --slug demo --review r5.md --run RUN3 --pass 1)"
check "record: resolved locus re-reported becomes a new finding (F-2)" \
  "$(jq -e '.state == "new" and .id == "F-2"' <<<"$out" >/dev/null; echo $?)"

# Ledger lives with the review artifacts.
check "ledger: stored under .somi/reviews/<slug>/findings.json" \
  "$([[ -f "$REPO/.somi/reviews/demo/findings.json" ]]; echo $?)"

# --- somi-check: portable working-tree guard -------------------------------------
CHECK="$ROOT/scripts/somi-check.sh"

printf 'KEY=1\n' > .env && git add .env
expect_exit "somi-check: staged .env fails" 1 bash "$CHECK" --staged
git rm -q --cached .env && rm .env

printf 'KEY=\n' > .env.example && git add .env.example
expect_exit "somi-check: staged .env.example passes" 0 bash "$CHECK" --staged
git rm -q --cached .env.example && rm .env.example

printf '{}\n' > package-lock.json && git add package-lock.json
expect_exit "somi-check: lockfile without manifest fails" 1 bash "$CHECK" --staged
printf '{"name":"t"}\n' > package.json && git add package.json
expect_exit "somi-check: lockfile WITH manifest passes" 0 bash "$CHECK" --staged
git rm -q --cached package.json && rm package.json
printf '{"lockfiles": {"allow_edit": true}}\n' > .somi/config.json
expect_exit "somi-check: config allow_edit passes bare lockfile" 0 bash "$CHECK" --staged
got=0; SOMI_ALLOW_LOCKFILES=0 bash "$CHECK" --staged >/dev/null 2>&1 || got=$?
check "somi-check: env=0 beats config allow_edit" "$([[ "$got" == "1" ]]; echo $?)"
git rm -q --cached package-lock.json && rm package-lock.json

printf 'x\n# TODO(claude): fix me\n' > src/todo.txt && git add src/todo.txt
expect_exit "somi-check: staged TODO(claude) marker fails" 1 bash "$CHECK" --staged
git rm -q --cached src/todo.txt && rm src/todo.txt

expect_exit "somi-check: clean staged set passes" 0 bash "$CHECK" --staged

# --- summary --------------------------------------------------------------------
if (( failures > 0 )); then
  echo "script tests: $failures of $total checks FAILED" >&2
  exit 1
fi
echo "script tests: all $total checks passed."
