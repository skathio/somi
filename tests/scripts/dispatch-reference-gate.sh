#!/usr/bin/env bash
# Unit + fixture guard for tests/scripts/lib/dispatch-reference-gate.mjs -- every command that
# Tasks an agent directly must reference skills/somi-dispatch/SKILL.md, the same as the front
# door. Proves the gate BOTH ways, the same discipline retirement-gate.sh and dispatch-guard.sh
# already apply to their own gates: green against the real tree, and red against a `cp -a` copy
# with one command's reference removed -- never trusted only because the real tree happens to pass
# today.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$ROOT/tests/scripts/lib/dispatch-reference-gate.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

echo "== command <-> somi-dispatch skill reference gate =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- unit-level: the derivation itself, against synthetic fixtures, independent of the real repo --
unit_out="$(node --input-type=module -e '
import { agentStartedBy, agentNamesFrom, DISPATCH_REFERENCE_RE } from "'"$GATE"'";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-gate-unit-"));
fs.mkdirSync(path.join(tmp, "agents"));
for (const n of ["coder", "reviewer", "architecture-reviewer"]) {
  fs.writeFileSync(path.join(tmp, "agents", n + ".md"), "---\nname: " + n + "\n---\n");
}
fs.writeFileSync(path.join(tmp, "agents", "somi.md"), "---\nname: somi\n---\n");
const names = agentNamesFrom(path.join(tmp, "agents"));

const cases = [
  ["Brief the `coder` agent via the Task tool with:", "coder"],
  ["Task coder ( = /code <slug> )", "coder"],
  ["Task the [`reviewer`](../agents/reviewer.md) on a fresh context", "reviewer"],
  ["Task [`architecture-reviewer`](../agents/architecture-reviewer.md) (and more)", "architecture-reviewer"],
  ["Brief [`agents/coder.md`](../agents/coder.md) via the Task tool with:", "coder"],
  // The newer call-site verbs, and case-insensitivity on all of them.
  ["Start the `coder` agent via the Task tool with:", "coder"],
  ["Spawn the `reviewer` agent for a fresh-context pass", "reviewer"],
  ["Dispatch the `coder` agent with the current findings", "coder"],
  ["Run the `reviewer` agent on the same diff", "reviewer"],
  ["run the `coder` agent (lowercase verb)", "coder"],
  ["brief the `reviewer` agent (lowercase verb)", "reviewer"],
  // A router Tasking another COMMAND, never an agent -- must NOT match.
  ["Task /code-loop \"<slug> phase <N>, iteration <M>\"", null],
  // Coincidental English-word / cross-reference prose -- must NOT match (no real call-site shape).
  ["what is the user-visible impact, since when", null],
  ["amortized across every later /design, cold /plan, and /impact", null],
  // somi.md is exempt -- agentNamesFrom already drops it, so even a literal call-site shape naming
  // it must not match (nothing here Tasks the front door).
  ["Brief the `somi` agent via the Task tool with:", null],
];

let ok = 0, bad = 0;
for (const [text, want] of cases) {
  const got = agentStartedBy(text, names);
  if (got === want) { ok++; }
  else { bad++; console.log("MISMATCH: " + JSON.stringify(text) + " -> got " + got + ", want " + want); }
}

// DISPATCH_REFERENCE_RE itself: a bare mention of the CLI fallback script must NOT satisfy the
// reference requirement (that was the pre-fix bug -- "somi-dispatch" as a bare substring matched
// scripts/somi-dispatch.mjs too), but either real reference shape must.
const refCases = [
  // A bare CLI-fallback-script mention alone is NOT a reference -- this is the exact bug the
  // literal-token fix closes (a "somi-dispatch" SUBSTRING match used to be satisfied by this).
  ["fall back to node scripts/somi-dispatch.mjs resolve --agent x", false],
  // A bare skill-name mention with neither the full "skills/somi-dispatch" path nor "somi_resolve"
  // is also NOT enough on its own -- proves the fix is not just "any somi-dispatch mention".
  ["full rules: the `somi-dispatch` skill (`somi_skill`, or `somi:somi-dispatch` on Claude Code) only, nothing else", false],
  // The real shape every rewritten command reference line now uses -- true because it names
  // `somi_resolve` literally, not because it mentions the skill by name.
  ["Before this `Task`, call `somi_resolve` for `coder` (with `project_dir`), pass its model, and put the cost line in the briefing (`dispatched at cost: <tier>` only when `enforced` is true, else `requested cost: <tier> (not enforced: no mapped model)`); full rules: the `somi-dispatch` skill (`somi_skill`, or `somi:somi-dispatch` on Claude Code).", true],
  // The older full-path markdown-link shape still satisfies it too.
  ["started per [`skills/somi-dispatch`](../skills/somi-dispatch/SKILL.md)", true],
  ["no dispatch reference here at all", false],
];
for (const [text, want] of refCases) {
  const got = DISPATCH_REFERENCE_RE.test(text);
  if (got === want) { ok++; }
  else { bad++; console.log("REF MISMATCH: " + JSON.stringify(text) + " -> got " + got + ", want " + want); }
}

console.log("UNIT " + ok + " " + bad);
fs.rmSync(tmp, { recursive: true, force: true });
' 2>&1)"
echo "$unit_out" | grep -v '^UNIT ' | sed 's/^/  /'
unit_line="$(echo "$unit_out" | grep '^UNIT ')"
unit_ok="$(echo "$unit_line" | awk '{print $2}')"
unit_bad="$(echo "$unit_line" | awk '{print $3}')"
if [ "$unit_bad" = "0" ] && [ -n "$unit_ok" ]; then
  ok "all $unit_ok synthetic call-site/exclusion cases matched the expected agent (or no-match)"
else
  bad "synthetic call-site cases: $unit_bad mismatch(es) -- see MISMATCH lines above"
fi

# --- fixture-level: a `cp -a` copy of the real commands/ + agents/ -------------------------------
cp -a "$ROOT/commands" "$TMP/commands"
cp -a "$ROOT/agents" "$TMP/agents"

# --- GREEN: the unmodified copy passes -----------------------------------------------------------
if out_green="$(node "$GATE" "$TMP/commands" "$TMP/agents" 2>&1)"; then
  ok "gate exits 0 against an unmodified cp -a copy of the real commands/ + agents/"
else
  bad "gate exited non-zero against an unmodified copy (got: $out_green)"
fi
case "$out_green" in
  ok*) ok "gate's report starts with 'ok' against the unmodified copy" ;;
  *) bad "gate's report does not start with 'ok' against the unmodified copy (got: $out_green)" ;;
esac

# A missing REFERENCE is already caught by the RED case below -- what a count alone catches is
# different: the call-site DETECTION itself regressing (a wording change the patterns in
# dispatch-reference-gate.mjs no longer match), which would silently shrink "checked" with no
# MISSING DISPATCH REFERENCE line to flag it, since a command that drops out of detection is never
# in "missing" either. A LOWER bound, not a pin: this repo only grows agent-starting commands over
# time, and a hand-maintained exact count is exactly the kind of pin that goes stale on a legitimate
# addition -- a real detection regression still fails loud (the count drops below the floor).
checked_count="$(echo "$out_green" | grep -oE 'ok \([0-9]+ command' | grep -oE '[0-9]+')"
if [ -n "$checked_count" ] && [ "$checked_count" -ge 21 ]; then
  ok "at least 21 commands are derived as starting an agent (got $checked_count; matches or exceeds the real repo today)"
else
  bad "expected at least 21 commands derived as starting an agent, got $checked_count -- the call-site pattern derivation may have regressed"
fi

# --- RED: removing commands/code.md's dispatch reference must fail ------------------------------
# Strips BOTH satisfying tokens, not just one -- the gate now accepts either "skills/somi-dispatch"
# or "somi_resolve" (DISPATCH_REFERENCE_RE), so a fixture that only strips lines mentioning
# "somi-dispatch" would leave a bare "somi_resolve" mention behind and this RED case would no
# longer actually go red.
sed -i -E '/somi-dispatch|somi_resolve/d' "$TMP/commands/code.md"
out_red="$(node "$GATE" "$TMP/commands" "$TMP/agents" 2>&1)"; rc_red=$?
if [ "$rc_red" -eq 1 ]; then
  ok "gate exits 1 once commands/code.md's dispatch reference is removed"
else
  bad "gate did not exit 1 after removing commands/code.md's reference (rc=$rc_red, out=$out_red)"
fi
case "$out_red" in
  *"MISSING DISPATCH REFERENCE: code.md"*) ok "gate names code.md as missing the dispatch reference" ;;
  *) bad "gate's output does not name code.md as missing the reference (got: $out_red)" ;;
esac

# --- RED fixture does not spuriously flag OTHER commands (only code.md was touched) --------------
case "$out_red" in
  *"MISSING DISPATCH REFERENCE"*"MISSING DISPATCH REFERENCE"*)
    bad "more than one command flagged missing -- only commands/code.md was modified (got: $out_red)" ;;
  *)
    ok "exactly one command (code.md) is flagged, not a spurious wider failure" ;;
esac

# --- a router command (no agents/ reference at all) is correctly excluded, both green and red ----
router_out="$(node --input-type=module -e '
import { agentStartedBy, agentNamesFrom } from "'"$GATE"'";
const names = agentNamesFrom("'"$TMP"'/agents");
import fs from "node:fs";
const text = fs.readFileSync("'"$TMP"'/commands/ship.md", "utf8");
console.log(agentStartedBy(text, names) === null ? "EXCLUDED" : "FALSE POSITIVE");
' 2>&1)"
case "$router_out" in
  EXCLUDED) ok "commands/ship.md (a router -- Tasks other commands, never an agent) is correctly excluded" ;;
  *) bad "commands/ship.md was NOT excluded (got: $router_out) -- a router must never be misdiagnosed as starting an agent" ;;
esac

bash "$ROOT/tests/scripts/review-panel-seats.sh" || fail=$((fail+1))

echo "dispatch-reference-gate tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
