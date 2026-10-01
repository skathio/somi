#!/usr/bin/env bash
# Unit guard for tests/scripts/lib/checkpoint-gate.mjs -- ship-loop's non-overridable checkpoint.
#
# commands/ship-loop.md's single mandatory human checkpoint moved from a cost-tier
# boundary (which stopped existing) to the brief handoff. Nothing else fails the build if a later
# edit quietly drops "non-overridable" or either of the two anchors it fires at (the brief handoff,
# and -- on a cold start -- after /plan-loop). Proves the gate both ways, the same discipline
# retirement-gate.sh and dispatch-reference-gate.sh already apply to their own gates: green against
# the real file, red against a `cp -a` copy with the wording deliberately weakened.
#
# Fixture mutations run through node, not sed -- this repo hard-wraps prose at ~100 chars, so at
# least one real anchor phrase ("brief\nhandoff") is split across a line break, and sed's per-line
# substitution silently leaves a split occurrence untouched while node's whole-file regex (the same
# shape the gate itself uses) does not.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$ROOT/tests/scripts/lib/checkpoint-gate.mjs"
SHIP_LOOP="$ROOT/commands/ship-loop.md"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

echo "== ship-loop checkpoint gate =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

strip() { # $1 = source file, $2 = dest file, $3 = whole-file regex (JS, case-insensitive), $4 = replacement
  node -e '
    const fs = require("fs");
    const [, src, dest, pattern, replacement] = process.argv;
    const re = new RegExp(pattern, "gi");
    fs.writeFileSync(dest, fs.readFileSync(src, "utf8").replace(re, replacement));
  ' "$1" "$2" "$3" "$4"
}

# --- GREEN: the real, unmodified file must pass ---------------------------------------------
if out_green="$(node "$GATE" "$SHIP_LOOP" 2>&1)"; then
  ok "gate exits 0 against the real commands/ship-loop.md"
else
  bad "gate exited non-zero against the real file (got: $out_green)"
fi
case "$out_green" in
  ok*) ok "gate's report starts with 'ok' against the real file" ;;
  *) bad "gate's report does not start with 'ok' against the real file (got: $out_green)" ;;
esac

# --- RED: drop "non-overridable" ---------------------------------------------------------------
strip "$SHIP_LOOP" "$TMP/ship-loop.md" 'non-overridable' ''
out_red1="$(node "$GATE" "$TMP/ship-loop.md" 2>&1)"; rc1=$?
if [ "$rc1" -eq 1 ]; then
  ok "gate exits 1 once 'non-overridable' is stripped from the file"
else
  bad "gate did not exit 1 after stripping 'non-overridable' (rc=$rc1, out=$out_red1)"
fi
case "$out_red1" in
  *"non-overridable"*) ok "gate names the missing non-overridable language" ;;
  *) bad "gate's output does not name the missing non-overridable language (got: $out_red1)" ;;
esac

# --- RED: drop the brief-handoff anchor ---------------------------------------------------------
strip "$SHIP_LOOP" "$TMP/ship-loop.md" 'brief[\s-]?hand[\s-]?off' 'the review point'
out_red2="$(node "$GATE" "$TMP/ship-loop.md" 2>&1)"; rc2=$?
if [ "$rc2" -eq 1 ]; then
  ok "gate exits 1 once the brief-handoff anchor is renamed away"
else
  bad "gate did not exit 1 after renaming the brief-handoff anchor (rc=$rc2, out=$out_red2)"
fi
case "$out_red2" in
  *"brief-handoff anchor"*) ok "gate names the missing brief-handoff anchor" ;;
  *) bad "gate's output does not name the missing brief-handoff anchor (got: $out_red2)" ;;
esac

# --- RED: drop the cold-start (after /plan-loop) anchor -----------------------------------------
strip "$SHIP_LOOP" "$TMP/ship-loop.md" 'after\s+`?/plan-loop`?' 'later'
out_red3="$(node "$GATE" "$TMP/ship-loop.md" 2>&1)"; rc3=$?
if [ "$rc3" -eq 1 ]; then
  ok "gate exits 1 once every 'after /plan-loop' mention is reworded away"
else
  bad "gate did not exit 1 after rewording every 'after /plan-loop' mention (rc=$rc3, out=$out_red3)"
fi
case "$out_red3" in
  *"cold-start anchor"*) ok "gate names the missing cold-start anchor" ;;
  *) bad "gate's output does not name the missing cold-start anchor (got: $out_red3)" ;;
esac

echo "checkpoint gate tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
