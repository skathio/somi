#!/usr/bin/env bash
# Proves the lens membership validate.sh's write-discipline check DERIVES from
# commands/review-panel.md's table (same extraction regex) includes every seated review agent, and
# that the check goes RED in a `cp -a` copy when a seated agent loses its `## Write discipline`.
# Chained from dispatch-reference-gate.sh (validate.sh is at its size budget).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
derive() { grep -oE '^\| *`[a-z][a-z0-9-]*`' "$1/commands/review-panel.md" | tr -d '|` ' | sort -u; }

echo "== review-panel seated-lens derivation =="
seated="$(derive "$ROOT")"
for a in reviewer security-reviewer architecture-reviewer test-strategist plan-reviewer sdlc-reviewer; do
  if grep -qx "$a" <<<"$seated"; then ok "derived membership includes $a"; else bad "derived membership is missing $a"; fi
  grep -q '^## Write discipline' "$ROOT/agents/$a.md" && ok "agents/$a.md has Write discipline" || bad "agents/$a.md lacks Write discipline"
done
# Each seated lens is also named in the parallel-start block, so a seat cannot exist without a start.
for a in $seated; do
  grep -qE "^Task +$a " "$ROOT/commands/review-panel.md" && ok "parallel start Tasks $a" || bad "parallel start does not Task $a"
done

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp -a "$ROOT/commands" "$ROOT/agents" "$TMP/"
sed -i '/^## Write discipline/d' "$TMP/agents/plan-reviewer.md"
red=0
for a in $(derive "$TMP"); do grep -q '^## Write discipline' "$TMP/agents/$a.md" || red=$((red+1)); done
[ "$red" -eq 1 ] && ok "RED: removing plan-reviewer's Write discipline is caught via the derived table" || bad "RED fixture caught $red agents, expected 1"

echo "review-panel-seats tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
