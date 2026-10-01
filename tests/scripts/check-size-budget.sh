#!/usr/bin/env bash
# Tests for scripts/check-size-budget.mjs. Each case builds a throwaway git repo (the checker
# enumerates tracked files) and asserts the exit code, never touching the real tree.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/check-size-budget.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
failures=0; total=0
expect_exit() { local name="$1" want="$2" got=0; shift 2; "$@" >/dev/null 2>&1 || got=$?
  [[ "$got" == "$want" ]] || { echo "FAIL: $name -- expected exit $want, got $got" >&2; failures=$((failures+1)); }
  total=$((total+1)); }

R="$TMP/r"
lines() { local n="$1" i; for ((i=0;i<n;i++)); do echo "line $i"; done; }
mktree() { rm -rf "$R"; mkdir -p "$R/agents" "$R/scripts" "$R/tests/evals/results"
  git -C "$R" init -q; lines 10 > "$R/agents/small.md"; lines 10 > "$R/scripts/s.mjs"; }
ledger() { printf '[{"file":"%s","budget":%s,"current_size":%s,"source":"abc1234","at":"2026-10-01","reason":"test"}]\n' "$1" "$2" "$3" > "$R/scripts/size-budget-overrides.json"; }
run() { git -C "$R" add -A; node "$CHECK" --root "$R"; }

mktree
expect_exit "within-budget tree passes" 0 run

mktree; lines 301 > "$R/agents/big.md"
expect_exit "un-ledgered prompt file over 300 fails" 1 run

mktree; lines 501 > "$R/scripts/big.mjs"
expect_exit "un-ledgered .mjs over 500 fails" 1 run

mktree; lines 801 > "$R/scripts/big.sh"
expect_exit "un-ledgered .sh over 800 fails" 1 run

mktree; lines 500 > "$R/scripts/edge.mjs"; lines 300 > "$R/agents/edge.md"; lines 800 > "$R/scripts/edge.sh"
expect_exit "files exactly at budget pass" 0 run

mktree; lines 5000 > "$R/tests/evals/results/r.mjs"; lines 5000 > "$R/notes.md"
expect_exit "eval results and docs are not gated" 0 run

mktree; lines 600 > "$R/scripts/big.mjs"; ledger scripts/big.mjs 500 600
expect_exit "ledgered file at its recorded size passes" 0 run

mktree; lines 599 > "$R/scripts/big.mjs"; ledger scripts/big.mjs 500 600
expect_exit "ledgered file that shrank passes" 0 run

mktree; lines 601 > "$R/scripts/big.mjs"; ledger scripts/big.mjs 500 600
expect_exit "ledgered file grown by one line fails" 1 run

mktree; lines 100 > "$R/scripts/big.mjs"; ledger scripts/big.mjs 500 600
expect_exit "ledgered file now within budget passes" 0 run
warned="$(node "$CHECK" --root "$R" 2>&1)"
total=$((total+1))
[[ "$warned" == *"remove its ledger entry"* ]] || { echo "FAIL: within-budget ledgered file did not warn" >&2; failures=$((failures+1)); }

mktree; lines 600 > "$R/untracked.mjs"
expect_exit "untracked oversized file is ignored" 0 bash -c "git -C '$R' add -A; mv '$R/untracked.mjs' '$R/u.tmp'; mv '$R/u.tmp' '$R/untracked.mjs'; git -C '$R' reset -q untracked.mjs; node '$CHECK' --root '$R'"

mktree; printf '{not json' > "$R/scripts/size-budget-overrides.json"
expect_exit "ledger that is not JSON fails loudly" 2 run

mktree; printf '{"file":"x"}' > "$R/scripts/size-budget-overrides.json"
expect_exit "ledger that is not an array fails loudly" 2 run

mktree; printf '[{"file":"scripts/s.mjs","budget":500}]' > "$R/scripts/size-budget-overrides.json"
expect_exit "ledger entry missing fields fails loudly" 2 run

mktree; lines 600 > "$R/scripts/big.mjs"; ledger scripts/big.mjs 500 600
cat "$R/scripts/size-budget-overrides.json" "$R/scripts/size-budget-overrides.json" | tr -d '\n' | sed 's/\]\[/,/' > "$R/scripts/dup.json"; mv "$R/scripts/dup.json" "$R/scripts/size-budget-overrides.json"
expect_exit "duplicate ledger entry fails loudly" 2 run

if (( failures > 0 )); then echo "check-size-budget: $failures of $total cases failed" >&2; exit 1; fi
echo "  ok: check-size-budget ($total cases)"
