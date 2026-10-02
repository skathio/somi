#!/usr/bin/env bash
# Tests for scripts/check-frontmatter.mjs. Each case writes one agent file into a throwaway tree
# and asserts the exit code, never touching the real tree.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/check-frontmatter.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
failures=0; total=0
R="$TMP/r"
# $1 = case name, $2 = expected exit, $3 = the agent file's frontmatter body (between the ---).
case_fm() { local name="$1" want="$2" got=0
  rm -rf "$R"; mkdir -p "$R/agents" "$R/commands" "$R/skills"
  printf -- '---\n%s\n---\n\nBody.\n' "$3" > "$R/agents/a.md"
  node "$CHECK" "$R" >/dev/null 2>&1 || got=$?
  [[ "$got" == "$want" ]] || { echo "FAIL: $name -- expected exit $want, got $got" >&2; failures=$((failures+1)); }
  total=$((total+1)); }

case_fm "plain values pass" 0 $'name: a\ndescription: Reviews plans, code and designs.\ncost: medium, high'
case_fm "double-quoted value with ': ' passes" 0 $'name: a\ndescription: "checks divergence: did it follow"'
case_fm "single-quoted value with ': ' passes" 0 $'name: a\ndescription: \'it\'\'s a: test\''
case_fm "plain value containing ': ' fails (#30, reviewer)" 1 $'name: a\ndescription: checks divergence: did it follow'
case_fm "plain value with backticked 'cost: high' fails (#30, designer)" 1 $'name: a\ndescription: Design agent (`cost: high`). Use first.'
case_fm "plain value starting with a backtick fails" 1 $'name: a\ndescription: `x` does y'
case_fm "plain value starting with [ fails" 1 $'name: a\nargument-hint: [nothing] | refresh'
case_fm "plain value containing ' #' fails" 1 $'name: a\ndescription: step #1 and more # here'
case_fm "unterminated double quote fails" 1 $'name: a\ndescription: "open'
case_fm "a non key-value line fails" 1 $'name: a\njust some prose'
rm -rf "$R"; mkdir -p "$R/agents" "$R/commands" "$R/skills"; printf 'no frontmatter\n' > "$R/agents/a.md"
got=0; node "$CHECK" "$R" >/dev/null 2>&1 || got=$?; total=$((total+1))
[[ "$got" == 1 ]] || { echo "FAIL: missing frontmatter -- expected exit 1, got $got" >&2; failures=$((failures+1)); }
rm -rf "$R"; mkdir -p "$R/agents" "$R/commands" "$R/skills"; printf -- '---\r\nname: a\r\ndescription: ok\r\n---\r\n' > "$R/agents/a.md"
got=0; node "$CHECK" "$R" >/dev/null 2>&1 || got=$?; total=$((total+1))
[[ "$got" == 0 ]] || { echo "FAIL: CRLF frontmatter -- expected exit 0, got $got" >&2; failures=$((failures+1)); }

if (( failures )); then echo "check-frontmatter tests: $failures of $total failed" >&2; exit 1; fi
echo "check-frontmatter tests: $total of $total checks passed."
