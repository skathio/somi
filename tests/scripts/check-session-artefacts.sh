#!/usr/bin/env bash
# Tests for scripts/check-session-artefacts.mjs. Fixtures are plain directories (the checker walks
# the filesystem, not git). Each case plants one line in an otherwise clean tree and asserts the
# exit code.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/check-session-artefacts.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
failures=0; total=0
expect_exit() { local name="$1" want="$2" got=0; shift 2; "$@" >/dev/null 2>&1 || got=$?
  [[ "$got" == "$want" ]] || { echo "FAIL: $name -- expected exit $want, got $got" >&2; failures=$((failures+1)); }
  total=$((total+1)); }

mktree() { rm -rf "$TMP/r"; mkdir -p "$TMP/r/hooks" "$TMP/r/scripts" "$TMP/r/agents" "$TMP/r/commands" "$TMP/r/skills/s" "$TMP/r/tests"
  printf '// A clean comment explaining why.\nconst x = 1;\n' > "$TMP/r/hooks/h.mjs"
  printf '# A clean comment.\necho ok\n' > "$TMP/r/scripts/s.sh"
  printf -- '---\nname: a\n---\nPlan with `D1:` sample, phase 1, iteration 1, and F-3.\n' > "$TMP/r/agents/a.md"; }
run() { node "$CHECK" --root "$TMP/r"; }

mktree
expect_exit "clean tree passes" 0 run

mktree; printf '// guards F-29 from the plan\n' >> "$TMP/r/hooks/h.mjs"
expect_exit "finding id in a hook comment fails" 1 run

mktree; printf '# see decisions.md#d5\n' >> "$TMP/r/scripts/s.sh"
expect_exit "decision anchor in a shell comment fails" 1 run

mktree; printf 'const y = 2; // phase 2 iteration 2.1 port\n' >> "$TMP/r/hooks/h.mjs"
expect_exit "trailing comment with iteration number fails" 1 run

mktree; printf 'const msg = "D5 is a string, not a comment";\n' >> "$TMP/r/hooks/h.mjs"
expect_exit "tag inside a string literal (not a comment) passes" 0 run

mktree; printf 'Decided in (D3).\n' >> "$TMP/r/commands/c.md"
expect_exit "decision tag in command markdown fails" 1 run

mktree; printf 'Same fix as F-29.\n' >> "$TMP/r/skills/s/SKILL.md"
expect_exit "finding id in skill markdown fails" 1 run

mktree; printf 'The product has a work item and phases; see D1: sample.\n' >> "$TMP/r/commands/c.md"
expect_exit "product vocabulary and sample ids in markdown pass" 0 run

# --- exclusions hold -----------------------------------------------------------------
mktree; printf '// F-29 D5 iteration 2.1\n' >> "$TMP/r/tests/t.sh"; printf 'F-29\n' > "$TMP/r/CHANGELOG.md"
mkdir -p "$TMP/r/tests/evals/results"; printf '// F-29\n' > "$TMP/r/tests/evals/results/x.mjs"
expect_exit "tests/, CHANGELOG.md and eval results are not scanned" 0 run

mktree; cp "$CHECK" "$TMP/r/scripts/check-session-artefacts.mjs"
expect_exit "the checker's own pattern definition is excluded" 0 run

if (( failures > 0 )); then echo "$failures of $total check-session-artefacts case(s) FAILED" >&2; exit 1; fi
echo "  ok: $total check-session-artefacts cases"
