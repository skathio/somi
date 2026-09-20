#!/usr/bin/env bash
# Unit guard for scripts/lib/cost-model.mjs: the cost -> model resolver.
#
# Exercises the three required behaviors: a known (cost, host) pair resolves to its mapped model,
# an unmapped host falls back to no override (its own default) without erroring, and an
# unrecognized cost value — or a mapped host missing that tier — throws rather than silently
# defaulting.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/cost-model.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# Runs a snippet with the resolver imported as `M`. A function so no case can forget the import
# path and silently test nothing.
run() { node --input-type=module -e "const M = await import('$LIB'); $1"; }
expect_exit() { # $1 = name, $2 = expected exit code, $3 = snippet run via run()
  local name="$1" want="$2" snippet="$3" got=0
  run "$snippet" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then ok "$name"; else bad "$name (expected exit $want, got $got)"; fi
}

echo "== cost model resolver =="

# --- a known (cost, host) pair resolves to its mapped model ----------------------
check "low/claude-code resolves to haiku" \
  "$(run 'process.stdout.write(M.resolveModel("low", "claude-code"))')" "haiku"
check "medium/claude-code resolves to sonnet" \
  "$(run 'process.stdout.write(M.resolveModel("medium", "claude-code"))')" "sonnet"
check "high/claude-code resolves to opus" \
  "$(run 'process.stdout.write(M.resolveModel("high", "claude-code"))')" "opus"
expect_exit "a known pair resolves without throwing" 0 \
  'M.resolveModel("medium", "claude-code")'

# --- an unmapped host falls back to its own default, without erroring ------------
check "unmapped host returns null (no override), not a guessed model" \
  "$(run 'process.stdout.write(String(M.resolveModel("medium", "some-future-host")))')" "null"
expect_exit "an unmapped host does not error" 0 \
  'M.resolveModel("medium", "some-future-host")'
check "a prototype-chain host name is treated as unmapped, not inherited" \
  "$(run 'process.stdout.write(String(M.resolveModel("medium", "constructor")))')" "null"

# --- an unrecognized cost value fails loudly, never silently ---------------------
expect_exit "an invalid cost value throws (uncaught, not swallowed)" 1 \
  'M.resolveModel("critical", "claude-code")'
check "the thrown error names the bad value, not a generic message" \
  "$(run 'try { M.resolveModel("critical", "claude-code"); } catch (e) { process.stdout.write(e.message); }')" \
  'cost-model: unrecognized cost "critical" (expected one of low|medium|high)'

# --- a mapped host missing that specific tier is malformed data, not a silent default --
expect_exit "a mapped host missing the requested tier throws, not undefined" 1 \
  'M.resolveModel("high", "partial-host", { "partial-host": { "medium": "x" } })'
check "the thrown error for a missing tier names the host and tier, not a generic message" \
  "$(run 'try { M.resolveModel("high", "partial-host", { "partial-host": { "medium": "x" } }); } catch (e) { process.stdout.write(e.message); }')" \
  'cost-model: host "partial-host" has no "high" entry in its mapping'

echo "cost model tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
