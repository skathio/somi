#!/usr/bin/env bash
# Regression test for scripts/validate.sh's never-degrade dispatch guard: resolveModel() called
# against a decision's `ceiling` field instead of its `selected` field would silently run a unit at
# whatever the session merely PERMITS, not the tier decideDispatch picked. That guard was
# hand-verified RED once, by eye, and its automated test then dropped to fit a diff cap -- exactly
# the failure this repo has already hit repeatedly (see
# tests/scripts/retirement-gate.sh's own header): a guard proven only by memory of once failing.
#
# Runs the REAL block, extracted verbatim from a throwaway COPY of scripts/validate.sh (never the
# real file, per this repo's cp -a scratch-copy convention) between two markers that are the
# block's own structure (`dispatch_guard_failed=0` .. its second closing `fi`) -- not a second,
# hand-typed copy of the grep pattern that could silently go stale.
#
# Residual, stated honestly: this proves the block's own logic still catches a violation, not that
# scripts/validate.sh hasn't disabled the whole block wholesale (e.g. wrapped in `if false`).
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALIDATE="$ROOT_REPO/scripts/validate.sh"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
assert_rc() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected exit $3, got $2)"; fi; }
assert_has() { if grep -qF "$2" "$3"; then ok "$1"; else bad "$1 (got: $(cat "$3"))"; fi; }

echo "== never-degrade dispatch guard (scripts/validate.sh) =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SCRATCH_VALIDATE="$TMP/validate.sh"
cp -a "$VALIDATE" "$SCRATCH_VALIDATE"

BLOCK="$(awk '
  /^dispatch_guard_failed=0$/ { capture=1 }
  capture { print; if ($0 == "fi") { n++; if (n == 2) exit } }
' "$SCRATCH_VALIDATE")"

if [ -z "$BLOCK" ]; then
  bad "could not extract the guard block from scripts/validate.sh -- its markers may have moved"
  echo "never-degrade dispatch guard tests: $pass ok, $fail failed"
  exit 1
fi

# Falling through with no violation ends on a false `[ ... -ne 0 ]` test (harmless mid-script under
# validate.sh's own flow, which just continues) -- an isolated `bash -c` would otherwise report
# THAT test's own status as its exit code. Appending `exit 0` makes "no violation" unambiguous.
SNIPPET="$BLOCK"$'\nexit 0'

run_guard() { ( cd "$1" && bash -c "$SNIPPET" ) >"$2" 2>"$3"; } # $1=root $2=stdout-file $3=stderr-file

# --- RED: a planted violation in a swept file must fail the guard, naming file and line -----------
RED="$TMP/red"; mkdir -p "$RED/agents"
cat > "$RED/agents/example.md" <<'EOF'
---
name: example
cost: high
---
Deliberately unsanctioned: resolveModel(decision.ceiling, host).
EOF
red_out="$TMP/red.out"; red_err="$TMP/red.err"
run_guard "$RED" "$red_out" "$red_err"; rc=$?
assert_rc "a planted resolveModel(x.ceiling) call makes the guard exit non-zero" "$rc" 1
assert_has "the guard's report names the violating file and line" \
  'agents/example.md:5:Deliberately unsanctioned: resolveModel(decision.ceiling, host).' "$red_out"
assert_has "the guard's diagnostic explains the violation" 'UNSANCTIONED DISPATCH' "$red_err"

# --- RED2: the planted violation at the REAL live call site's own path (scripts/somi-dispatch.mjs,
# outside scripts/lib/) must also fail -- the agents/ fixture above can't detect `scripts` dropped
# from the swept roots, or the scripts/lib/ exemption widened to all of scripts/.
RED2="$TMP/red2"; mkdir -p "$RED2/scripts"
cat > "$RED2/scripts/somi-dispatch.mjs" <<'EOF'
// Deliberately unsanctioned, planted at the one live call site's own path (outside scripts/lib/).
resolveModel(decision.ceiling, host);
EOF
red2_out="$TMP/red2.out"; red2_err="$TMP/red2.err"
run_guard "$RED2" "$red2_out" "$red2_err"; rc=$?
assert_rc "a planted violation at scripts/somi-dispatch.mjs (outside scripts/lib/) fails the guard" \
  "$rc" 1
assert_has "the guard's report names scripts/somi-dispatch.mjs and its line" \
  'scripts/somi-dispatch.mjs:2:resolveModel(decision.ceiling, host);' "$red2_out"

# --- CLEAN: no unsanctioned call anywhere in the swept roots must pass -----------------------------
CLEAN="$TMP/clean"; mkdir -p "$CLEAN/agents"
cat > "$CLEAN/agents/example.md" <<'EOF'
---
name: example
cost: high
---
Sanctioned: modelForDispatch(decideDispatch(declaredCost, ceiling), host).
EOF
clean_out="$TMP/clean.out"; clean_err="$TMP/clean.err"
run_guard "$CLEAN" "$clean_out" "$clean_err"; rc=$?
assert_rc "a clean tree (no unsanctioned call) passes the guard" "$rc" 0

# --- EXEMPT: the identical call inside scripts/lib/ is the sanctioned internal, not flagged --------
EXEMPT="$TMP/exempt"; mkdir -p "$EXEMPT/scripts/lib"
cat > "$EXEMPT/scripts/lib/cost-ceiling.mjs" <<'EOF'
// modelForDispatch()'s own sanctioned internal -- this file is the one exemption, by path.
resolveModel(decision.ceiling, host);
EOF
exempt_out="$TMP/exempt.out"; exempt_err="$TMP/exempt.err"
run_guard "$EXEMPT" "$exempt_out" "$exempt_err"; rc=$?
assert_rc "the identical call inside scripts/lib/ is exempt and does not fail the guard" "$rc" 0

echo "never-degrade dispatch guard tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
