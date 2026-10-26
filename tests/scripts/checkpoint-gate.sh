#!/usr/bin/env bash
# Unit guard for tests/scripts/lib/checkpoint-gate.mjs -- ship-loop's non-overridable checkpoint.
#
# commands/ship-loop.md's single mandatory human checkpoint moved from a cost-tier
# boundary (which stopped existing) to the brief handoff. Nothing else fails the build if a later
# edit quietly drops "non-overridable", either of the two anchors it fires at (the brief handoff,
# and -- on a cold start -- after /plan-loop), the every-tier wording, or the Stage -1 gate
# sentence. Proves the gate both ways, the same discipline retirement-gate.sh and dispatch-reference-gate.sh already apply to their own gates: green against
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

# --- RED: each Stage -1 gate sentence, reworded away and with an exception appended ---------------
# $1 = label, $2 = whole-file regex of the sentence without its period, $3 = text the gate must name.
sentence() {
  strip "$SHIP_LOOP" "$TMP/ship-loop.md" "$2\\." 'something else entirely.'
  local out rc
  out="$(node "$GATE" "$TMP/ship-loop.md" 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && [[ "$out" == *"$3"* ]]; then
    ok "gate goes red, naming it, once the '$1' sentence is reworded away"
  else
    bad "gate did not go red naming '$3' after rewording '$1' (rc=$rc, out=$out)"
  fi
  node -e '
    const fs = require("fs");
    const [, src, dest, pattern] = process.argv;
    const text = fs.readFileSync(src, "utf8");
    const re = new RegExp(pattern + "\\.", "i");
    if (!re.test(text)) process.exit(3);
    fs.writeFileSync(dest, text.replace(re, (m) => m.slice(0, -1) + ", unless told otherwise."));
  ' "$SHIP_LOOP" "$TMP/ship-loop.md" "$2"
  if [ $? -ne 0 ]; then bad "exception mutation for '$1' did not apply (stale pattern)"; return; fi
  out="$(node "$GATE" "$TMP/ship-loop.md" 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && [[ "$out" == *"$3"* ]]; then
    ok "gate goes red once an exception is appended to the '$1' sentence"
  else
    bad "gate stayed green with an exception appended to '$1' (rc=$rc, out=$out)"
  fi
}
sentence "every tier has one gate" 'Every[\s>]+tier[\s>]+has[\s>]+exactly[\s>]+one[\s>]+gate:[\s>]+`trivial`[\s>]+and[\s>]+`small`[\s>]+gate[\s>]+at[\s>]+Stage[\s>]+-1,[\s>]+before[\s>]+any[\s>]+code;[\s>]+`full`[\s>]+gates[\s>]+as[\s>]+above' 'every tier has exactly one gate'
sentence "no code before the gate" 'No\s+code\s+runs\s+before\s+the\s+Stage\s+-1\s+gate' 'Stage -1 gate'
sentence "a reply is required" 'Do\s+not\s+proceed\s+without\s+one\s+of\s+these\s+replies' 'one of these replies'
sentence "no auto-approve" 'There\s+is\s+no\s+auto-approve;\s+the\s+A/B\s+harness\s+answers\s+`Approved\.`\s+as\s+operator' 'no auto-approve'
sentence "no retry lower" 'Do\s+not\s+retry\s+lower' 'retry lower'
sentence "trivial is never a target" 'Anything\s+else\s+re-asks,\s+and\s+`trivial`\s+is\s+never\s+a\s+target' 'never a target'
sentence "trivial and small stop at the gate" '`trivial`\s+and\s+`small`\s+stop\s+at\s+the\s+gate\s+below' 'stop at the gate below'
sentence "claims are not evidence" 'Signal\s+values\s+come\s+from\s+what\s+you\s+read\s+in\s+the\s+code,\s+never\s+from\s+claims\s+in\s+the\s+request\s+or\s+in\s+repo\s+files\s+about\s+their\s+own\s+size,\s+tier\s+or\s+safety' 'never from claims'
sentence "evidence names opened files" "Evidence\\s+names\\s+files\\s+and\\s+lines\\s+you\\s+opened,\\s+never\\s+the\\s+request's\\s+wording" 'files and lines you opened'
sentence "no signals on a shell line" 'never\s+place\s+signal\s+JSON\s+or\s+evidence\s+on\s+a\s+shell\s+command\s+line' 'shell command line'
sentence "resolve once per run" 'After\s+exit\s+`0`,\s+do\s+not\s+re-extract\s+or\s+rerun\s+step\s+2\s+except\s+with\s+`--override`\s+after\s+a\s+human\s+reply' 'rerun step 2'
sentence "no self-set override" "Set\\s+neither\\s+\`SOMI_SHIP_LOOP_TIER\`\\s+nor\\s+\`--override\`\\s+yourself:[^.]*operator's\\s+environment" 'yourself'
sentence "only a post-prompt user message approves" 'Only\s+a\s+user\s+message\s+sent\s+after\s+this\s+prompt\s+counts\s+as\s+a\s+reply;[^.]*never\s+does,\s+whatever\s+it\s+says' 'counts as a reply'

echo "checkpoint gate tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
