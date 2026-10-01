#!/usr/bin/env bash
# Validation script run as `npm test`. Checks JSON validity, Node source syntax, and frontmatter.
# The runtime it validates is zero-dependency Node (D1/D5): JSON validity uses `node -e JSON.parse`
# (not `jq`), and source syntax uses `node --check` over the ported `.mjs` files (not `shellcheck`/
# `bash -n` over `.sh`, which no longer exist under scripts/ or hooks/ — see work item
# node-runtime-port). This file itself stays bash (dev/CI tooling, per context.md §6), invoked from
# `npm test`; it needs neither jq nor shellcheck installed. Also emits a minimal coverage/lcov.info
# stub so the hashira-ops CI coverage-report action has a file to parse (no unit test suite).
set -euo pipefail

# JSON validity via Node's own parser (D5: no jq). Fails loudly on the first invalid file.
json_valid() { node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$1"; }

echo "==> Validating JSON files..."
for f in \
  .claude-plugin/plugin.json \
  .claude-plugin/marketplace.json \
  .copilot-extension/extension.json \
  .copilot-extension/marketplace.json \
  .claude/settings.json \
  mcp.json \
  package.json \
  hooks/hooks.json \
  examples/sample-consumer/.claude/settings.json; do
  echo "  node JSON.parse: $f"
  json_valid "$f"
done

echo "==> Node syntax check (node --check over the ported .mjs)..."
# tests/evals is excluded from the published package (tests/.npmignore), so this path does not
# exist in an unpacked tarball -- where `npm test` is exactly what a release smoke check runs.
# Naming a missing directory makes find exit 1 and the whole script die under `set -e`.
EVAL_TREE=""; [ -d tests/evals ] && EVAL_TREE="tests/evals"
find hooks scripts $EVAL_TREE -name '*.mjs' -type f -print0 \
  | xargs -0 -I{} node --check {}

echo "==> Hook behavior fixtures..."
for f in tests/hooks/cases/*.json; do
  echo "  node JSON.parse: $f"
  json_valid "$f"
done
bash tests/hooks/run.sh

echo "==> Loop-state & findings-ledger tests..."
bash tests/scripts/run.sh

echo "==> Link-checker tests..."
bash tests/scripts/check-links.sh

echo "==> Digest-generator tests..."
# Guards scripts/generate-digest.mjs: per-target prefix transform, drift detection in EITHER
# copy alone, clean errors on malformed input, and splice anchoring. Wiring `--check` itself
# into this script (so CI fails on committed drift) is phase 3, iteration 3.1 — this is the
# unit guard for the generator, not the drift gate.
bash tests/scripts/generate-digest.sh

echo "==> Cost model resolver tests..."
bash tests/scripts/cost-model.sh

echo "==> Cost ceiling tests..."
bash tests/scripts/cost-ceiling.sh

echo "==> Dispatch resolver tests..."
bash tests/scripts/somi-dispatch.sh

echo "==> Front-door agent <-> dispatch resolver contract tests..."
# agents/somi.md is a prompt and can't be exercised without a model, but what its Step 4 tells the
# model to RUN can be checked deterministically: the resolve --agent/--host invocation shape it
# instructs, and the exit codes it maps, must both be real and current against the actual CLI.
bash tests/scripts/somi-agent-dispatch-contract.sh

echo "==> Bundled MCP server tests (somi_resolve / somi_command)..."
# scripts/somi-mcp.mjs is the MCP-native equivalent of the CLI above, launched from
# ${CLAUDE_PLUGIN_ROOT}/${PLUGIN_ROOT} so a prompt never needs an install path. Both wrap the
# identical scripts/lib/dispatch-resolver.mjs, so this drives the real JSON-RPC stdio protocol
# rather than re-testing the resolver's arithmetic a third time.
bash tests/scripts/somi-mcp.sh

echo "==> Validating the never-degrade dispatch guard..."
# scripts/lib/cost-ceiling.mjs's modelForDispatch() is the ONLY sanctioned way to turn a dispatch
# decision into a model: it resolves the SELECTED tier and refuses anything shaped as other than an
# "allow" decision. Calling the underlying model resolver directly against a decision's ceiling
# field instead of its selected field reads fine in English but is a different, unsanctioned
# composition -- it would run a unit at whatever tier the session merely PERMITS rather than the
# tier decideDispatch actually picked for it, silently running above what the unit declared. This
# gate closes that path structurally rather than by convention: nothing outside the library itself
# may compose the two functions that way. scripts/somi-dispatch.mjs is the first real dispatch call
# site this machinery ever had (before it, decideDispatch/modelForDispatch had zero live callers),
# so the gate had to land no later than this change, not after.
#
# EXEMPT: scripts/lib/ -- cost-ceiling.mjs's own modelForDispatch() resolves against a decision's
# SELECTED tier, never its ceiling, but the exemption is by path, not by re-deriving that fact here
# on every run. Also EXEMPT: tests/scripts/dispatch-guard.sh -- this guard's own regression test,
# which plants the violating call ON PURPOSE inside a synthetic fixture to prove the guard catches
# it; the same self-exemption tests/scripts/retirement-gate.sh needs from the gate it tests.
dispatch_guard_failed=0
if grep -rnE 'resolveModel\([A-Za-z_$][A-Za-z0-9_$]*\.ceiling' \
    agents commands docs scripts hooks tests README.md AGENTS.md 2>/dev/null \
    | grep -v '^scripts/lib/' | grep -v '^tests/scripts/dispatch-guard\.sh:'; then
  echo "UNSANCTIONED DISPATCH: resolveModel() called against a ceiling value directly above -- use modelForDispatch(decideDispatch(...), host) instead, which resolves the SELECTED tier" >&2
  dispatch_guard_failed=1
fi
if [ "$dispatch_guard_failed" -ne 0 ]; then
  exit 1
fi
bash tests/scripts/dispatch-guard.sh

echo "==> Eval fixture guards..."
# Guards tests/evals/fixtures/. Two Blockers from iteration 3.3b live here: a plan tree shipped
# under `.somi/` that .gitignore silently dropped from the package, and pass criteria
# written into fixture source as comments the candidate reads — which would have flatlined two
# load-bearing rubric dimensions at pass in BOTH arms of the trim comparison, reporting no
# regression on exactly what the corpus exists to protect.
if [ -d tests/evals ]; then bash tests/scripts/evals-fixtures.sh; else echo "  (skipped: tests/evals not packaged)"; fi

echo "==> Eval runner unit tests..."
# Guards tests/evals/run.mjs: the N-of-M grading bands, the phase-4 comparison rule, the result
# schema, and --source worktree cleanup. Hermetic -- every case is --dry-run or a direct call.
# This runs the runner's UNIT tests; it never invokes the runner against a model. The structural
# assertion that npm test cannot execute the runner lives inside eval-runner.sh itself.
if [ -d tests/evals ]; then bash tests/scripts/eval-runner.sh; else echo "  (skipped: tests/evals not packaged)"; fi

echo "==> Convergence gate CLI unit tests..."
# Guards tests/evals/convergence.mjs's CLI section (phase 3, iteration 3.4): argument parsing,
# --dry-run's shape/zero-model-call contract, --merge/--certify's shard-fold report, and F-251's
# sha boundary check. Mirrors eval-runner.sh's own pattern -- unit-tests the gate logic, never a
# live run. The module's non-CLI logic (3.1-3.3) is already covered by eval-runner.sh; this file
# is scoped to what 3.4 alone adds, so the two stay disjoint rather than duplicating each other.
if [ -d tests/evals ]; then bash tests/scripts/convergence-runner.sh; else echo "  (skipped: tests/evals not packaged)"; fi

echo "==> Eval packaging & hermeticity..."
# Phase 3's stated invariant risk lives here, and iteration 3.4c owns it alone: `npm test` never
# invokes a model, reaches the network, or reads a credential -- and the eval corpus never ships
# to consumers. Asserted at the INVOCATION level, because validate.sh must NAME tests/evals to
# syntax-check it, so a "no mention" rule would be self-contradicting.
bash tests/scripts/evals-packaging.sh

echo "==> Digest-marker / hook-fixture coupling..."
# Phase 4 exit criterion. A `rules/` trim that removes or rewords a digest bullet must update
# tests/hooks/cases/inject-workflow-context.json's Tier-2 marker in the SAME attempt. Phase 1
# added a fixture PAIR on that bullet (positive + negative); trim the bullet and the cases that
# carry it as incidental context go quietly vacuous while the suite stays green.
#
# `rules/` is one of phase 4's four trim candidates, so this is the coupling most likely to break.
coupling=$(node tests/scripts/lib/digest-marker-coupling.mjs \
  tests/hooks/cases/inject-workflow-context.json \
  hooks/user-prompt-submit/inject-workflow-context.mjs \
  rules/CLAUDE.md .github/copilot-instructions.md)
case "$coupling" in
  ok*) echo "  $coupling" ;;
  *)   echo "DIGEST-MARKER COUPLING BROKEN:" >&2; echo "$coupling" >&2; exit 1 ;;
esac

echo "==> Validating agent/command/skill frontmatter..."
failed=0
while IFS= read -r f; do
  if ! grep -q '^---' "$f"; then
    echo "MISSING FRONTMATTER: $f" >&2
    failed=1
  fi
done < <(
  for dir in agents commands skills/*/; do
    [ -d "$dir" ] && find "$dir" -name '*.md' -type f
  done
)
if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating cost-tier declarations..."
# Extract the first `cost:` (or `model:`) value(s) from a file's frontmatter (the block between
# the first two `---` lines). A declared `cost:` is a CAPABILITY SET -- every tier that unit can
# usefully run at, comma-separated in strictly ascending order -- and a dispatcher selects the
# highest member its ceiling permits; that selection is capability, never a downgrade to a tier
# the unit didn't declare. agents/reviewer.md's shipped `cost: medium, high` is a real example: a
# lighter pass is honestly useful at `medium`, adversarial fresh-eyes review needs `high`. What a
# file Tasks never contributes a value here, and a spawned unit never inherits its caller's tier
# either direction: a cost: medium orchestrator Tasking a cost: high agent stays declared medium --
# the agent's own frontmatter is where high is truthfully declared, once -- and a cost: high agent
# Tasking a cost: low, medium helper does not pull that helper up to high either.
cost_of() {
  awk '/^---$/{c++} c==1 && /^cost:[[:space:]]*/{sub(/^cost:[[:space:]]*/,""); print; exit}' "$1"
}
model_of() {
  awk '/^---$/{c++} c==1 && /^model:[[:space:]]*/{sub(/^model:[[:space:]]*/,""); print; exit}' "$1"
}
cost_failed=0

# Both the valid-cost enum and each tier's expected model are DERIVED from
# scripts/lib/cost-model.mjs in one node call, not hardcoded a second time here -- a repricing or
# a new tier is then a one-file edit instead of two files drifting apart.
#
# CAPTURE, CHECK, THEN EVAL -- deliberately not a bare `eval "$(node -e …)"`. A PARTIAL failure
# (resolveModel throws for one tier mid-forEach, after valid_costs and earlier ranks already
# printed) exits node non-zero, but that status is invisible to `eval`: the failing command
# substitution is only an argument being built for eval, not the exit status of a simple command,
# so `set -e` cannot see it and the script would report the cost block PASSED with that tier's
# model_for_* silently missing. Assigning to a plain variable first makes the substitution's exit
# status the ASSIGNMENT's status, which the explicit `||` below then catches -- and it must be
# explicit, not a bare `cost_env=$(node …)`: under `set -e` a bare assignment dies silently at the
# assignment, with no diagnostic reaching the user about which check was skipped.
cost_env="$(node -e '
import("./scripts/lib/cost-model.mjs").then((m) => {
  console.log("valid_costs=" + JSON.stringify(m.VALID_COSTS.join("|")));
  m.VALID_COSTS.forEach((c, idx) => {
    console.log("rank_" + c + "=" + idx);
    console.log("model_for_" + c + "=" + JSON.stringify(m.resolveModel(c, "claude-code")));
  });
});
')" || { echo "cost-model derivation failed; cannot validate cost tiers" >&2; exit 1; }
eval "$cost_env"

# (a) `cost:` lives on agents only -- `cost:` sizes an agent instance being spawned, and a
# command isn't one, so `cost:` on a command binds to nothing. Every agents/*.md file must declare
# a `cost:` field (EXEMPTION:
# agents/somi.md, see below) and every value in it (split on comma, for graded units) must be one
# of scripts/lib/cost-model.mjs's VALID_COSTS. Every commands/*.md file must NOT declare one -- the
# front door spawns that command's paired agent at the agent's own declared tier instead.
#
# EXEMPTION: agents/somi.md. `cost:` on this one file was always decorative -- the host binds the
# model when the user picks this agent in its own UI, so nothing in this repo could ever act on
# the declaration. A field nothing can read is worse than no field: a future dispatcher would have
# to treat a decorative declaration as a trap. Named here, not silently skipped, so a later reader
# does not "fix" it back in.
#
# Commands must not declare `model:` either, for the same reason: Claude Code honoured a
# command's own `model:` for that command's own turn, which taught the repo that a command has a
# cost while every dispatch target's actual cost lives on the agent it Tasks. Agents keep
# `model:` -- it is still the mechanism Claude Code reads to pick a Tasked subagent's model, and
# the retirement gate's frontmatter exemption (tests/scripts/lib/retirement-gate.mjs) still applies
# to it.
for f in agents/*.md commands/*.md; do
  [ -f "$f" ] || continue
  got="$(cost_of "$f")"
  case "$f" in
    commands/*.md)
      if [ -n "$got" ]; then
        echo "COST TIER ON COMMAND: $f declares cost: '$got' -- commands declare no cost: of their own; declare cost: on the agent this command Tasks instead" >&2
        cost_failed=1
      fi
      declared_model="$(model_of "$f" | tr -d '[:space:]')"
      if [ -n "$declared_model" ]; then
        echo "MODEL ON COMMAND: $f declares model: '$declared_model' -- commands no longer declare a model of their own; the front door dispatches this command's paired agent at the agent's own declared cost/model instead" >&2
        cost_failed=1
      fi
      continue
      ;;
    agents/somi.md)
      if [ -n "$got" ]; then
        echo "COST TIER ON EXEMPT AGENT: $f declares cost: '$got' -- this file is exempt from cost: entirely (see the EXEMPTION comment above); remove the declaration" >&2
        cost_failed=1
      fi
      continue
      ;;
  esac
  if [ -z "$got" ]; then
    echo "COST TIER MISSING: $f has no 'cost:' field in frontmatter" >&2
    cost_failed=1
    continue
  fi
  # Reject an empty element (leading/trailing/double comma, e.g. "medium," or ",high") before
  # splitting -- `IFS=',' read -ra` silently drops a trailing empty field, so a malformed list
  # would otherwise split clean and pass.
  stripped="$(echo "$got" | tr -d '[:space:]')"
  case "$stripped" in
    ,*|*,|*,,*)
      echo "COST TIER MALFORMED: $f has an empty cost value (leading/trailing/double comma) in '$got'" >&2
      cost_failed=1
      continue
      ;;
  esac
  IFS=',' read -ra cost_values <<< "$got"
  prev_rank=-1
  for v in "${cost_values[@]}"; do
    v="$(echo "$v" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "|$valid_costs|" in
      *"|$v|"*)
        rank_var="rank_$v"
        rank="${!rank_var}"
        ;;
      *)
        echo "COST TIER INVALID: $f declares cost value '$v' (expected one of $valid_costs)" >&2
        cost_failed=1
        rank=-1
        ;;
    esac
    # Multi-value cost must be strictly ascending with no duplicates (low < medium < high) -- a
    # second value that repeats or precedes the first is a hand-edit slip a reader will not
    # notice, and the field is about to become a dispatch input.
    if [ "$rank" -ge 0 ] && [ "$rank" -le "$prev_rank" ]; then
      echo "COST TIER UNORDERED: $f declares '$got' -- multi-value cost must be strictly ascending ($valid_costs), no duplicates" >&2
      cost_failed=1
    fi
    [ "$rank" -ge 0 ] && prev_rank="$rank"
  done
done

# (b) Pin the exact declared cost for the files where the value is load-bearing beyond "some
# valid tier" -- mirrors the thirteen model-value assertions this block replaces.
assert_cost() {
  local f="$1" want="$2" got
  got="$(cost_of "$f" | tr -d '[:space:]')"
  if [ "$got" != "$want" ]; then
    echo "COST TIER MISMATCH: $f cost is '$got', expected '$want'" >&2
    cost_failed=1
  fi
}
# low, medium: these three widen downward under the opt-in bar for `low` -- a builder-tier agent
# may declare `low` once it can still do a reduced-depth version of its job and its own output says
# so when it ran that way, even though the reduced depth would not hold up as the only tier it ever
# ran at. `low` only ever runs when the session ceiling resolves to `low` -- an explicit CLI flag or
# SOMI_COST_CEILING for this session, or inherited from a committed .somi/config.json or a saved
# state file that persists across sessions -- and the front door announces that ceiling and its
# source before work starts, so the quality drop is a trade the user can see, not one sprung on
# them. Each agent's own frontmatter and "Running at `low`" section name what that agent's
# reduced-depth pass keeps and what it trims -- read those, not this comment, for the specifics.
# refactorer still has no `high` member: a refactor too big for one diff is a different job, split
# out to the refactor-designer sibling below, not a third tier declared here. agents/somi.md is
# EXEMPT from this whole block (see the comment above the loop) -- it declares no cost: at all.
for a in planner coder refactorer; do
  assert_cost "agents/$a.md" low,medium
done
# high-only: a wrong call here is paid for through everything downstream that builds on it, so a
# cheaper pass would be cheaper-and-wrong, not genuinely useful -- these never gain a lower member.
# atlas joins this set: its whole value is one high-quality read of the repository, paid once.
for a in discovery-analyst designer security-reviewer refactor-designer atlas; do
  assert_cost "agents/$a.md" high
done
# medium, high: a lighter pass is genuinely useful under a capped ceiling, but the deepest work
# needs the strong model -- these grade ONE job over two depths, not two different jobs, so a
# blind ceiling pick is safe at either member. These are judges, not builders: a weaker judge
# doesn't produce weaker output, it produces a false pass with nothing downstream to catch what it
# missed, so the opt-in bar for `low` above does not extend to this set.
for a in reviewer architecture-reviewer test-strategist; do
  assert_cost "agents/$a.md" medium,high
done
# medium-only, judge not builder: impact's deliverable is a proceed / design-first / reconsider
# verdict and, in diff mode, the review-lens selection -- a reduced-depth pass would undercount the
# blast radius and can return a false "proceed, small" with nothing downstream to re-check it, or
# drop a lens (security-reviewer, worst case) that then never runs elsewhere. Same false-pass
# failure that keeps the medium,high judges above off `low`, so impact stays off it too despite
# tracing an already-written call graph -- still no `high` member, since even its full-depth pass is
# mechanical tracing, not open-ended research.
assert_cost agents/impact.md medium
# medium-only: incident's mitigation-stage judgment (flag flip vs. revert vs. scoped patch, verified
# against the live symptom) and its debt-capture accounting both need full reasoning on every run --
# every job this agent accepts is, by construction, a live outage handed off after framing, so there
# is no lighter version of the call to make honestly.
assert_cost agents/incident.md medium
# graded over one job at two depths: mechanical aggregation of existing artifacts is already a
# correct, usable PR description at low; a fuller pass adds house-style matching, never required.
assert_cost agents/pr.md low,medium

# (c) `model:` and `cost:` state one fact twice -- assert `model:` resolves from the declared
# `cost:` set's TOP (highest, rightmost) member, deriving the expected model from resolveModel()
# rather than a second hardcoded table. Top-ness, not mere membership: a `model:` naming a lower
# declared member would silently run the agent at that lower tier regardless of ceiling -- the
# muted-reviewer failure `cost:` exists to prevent, re-opened by hand. `agents/` only -- commands
# declare neither `cost:` nor `model:` any more (asserted above), so there is nothing here to check
# them against.
for f in agents/*.md; do
  [ -f "$f" ] || continue
  got="$(cost_of "$f" | tr -d '[:space:]')"
  [ -z "$got" ] && continue  # already reported as COST TIER MISSING above
  declared_model="$(model_of "$f" | tr -d '[:space:]')"
  IFS=',' read -ra mv_values <<< "$got"
  top="${mv_values[${#mv_values[@]}-1]}"
  mv="model_for_$top"
  expected="${!mv:-}"
  # An unrecognized top value was already reported as COST TIER INVALID above -- nothing further
  # to check here (no expected model to compare against).
  if [ -n "$expected" ] && [ "$expected" != "$declared_model" ]; then
    echo "MODEL/COST MISMATCH: $f declares cost: $got (top tier: $top) with model: $declared_model, expected '$expected' per scripts/lib/cost-model.mjs" >&2
    cost_failed=1
  fi
done

if [ "$cost_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating cost-tier prose against coder/planner/refactorer's declared set..."
# coder, planner, and refactorer all declare the widened `low, medium` set above; a stale "declares
# cost: medium" claim about any of the three -- in a command's own explanatory prose, or in another
# agent's cross-reference -- understates what they can run at and drifts back to exactly the
# muted-capability bug this rework exists to close, silently and outside the frontmatter checks
# above (which only ever see the agent's OWN file, never a claim made about it elsewhere). Matched
# on the literal three-agent list, never a fourth: impact and incident are legitimately medium-only
# today, so a plain `cost: medium` claim about either is correct, not stale, and must not fire here.
stale_cost_claim_failed=0
if grep -rnE '(coder|planner|refactorer)[^\n]{0,80}cost: medium`' commands/ agents/ docs/ 2>/dev/null; then
  echo "STALE COST CLAIM: coder/planner/refactorer all declare the widened 'cost: low, medium' -- the line(s) above still claim a plain 'cost: medium'" >&2
  stale_cost_claim_failed=1
fi
if [ "$stale_cost_claim_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating command <-> somi-dispatch skill reference..."
# Every command that Tasks an agent directly resolves it through the same dispatch procedure the
# front door uses, not just when a request is routed through agents/somi.md. "Starts an agent"
# is DERIVED from the real agent basenames under agents/ against this repo's own call-site idioms
# (see tests/scripts/lib/dispatch-reference-gate.mjs) -- never a hand-typed command list, which
# would silently miss a new command that Tasks an agent without also adding it here.
# tests/scripts/dispatch-reference-gate.sh proves this gate RED (a `cp -a` copy with one command's
# reference removed) and GREEN, the same two-sided proof retirement-gate.sh and dispatch-guard.sh
# already give their own gates.
if ! node tests/scripts/lib/dispatch-reference-gate.mjs commands agents; then
  exit 1
fi
bash tests/scripts/dispatch-reference-gate.sh

echo "==> Validating the stale-vocabulary retirement gate..."
# scripts/validate.sh only ever asserted frontmatter VALUES above, never prose -- so a
# half-converted ruleset (frontmatter switched to the new cost field, prose still naming the
# retired tiers) would otherwise pass silently. tests/scripts/lib/retirement-gate.mjs sweeps the
# roots below for the retired two-valued tier vocabulary and for hardcoded Claude model-name
# mentions outside frontmatter, exemptions named in its own header.
# tests/scripts/retirement-gate.sh proves this gate fails against a synthetic fixture still
# carrying the old vocabulary and passes against a clean one, per the trap the tools-doctrine
# sweep below documents (a check that can fire on its own fix needs to be proven against both
# states, not just trusted against the final one).
retirement_gate=$(node tests/scripts/lib/retirement-gate.mjs \
  agents commands docs rules skills templates README.md CHANGELOG.md AGENTS.md .github \
  .copilot-extension .claude-plugin examples hooks scripts tests)
case "$retirement_gate" in
  ok*) echo "  $retirement_gate" ;;
  *)
    echo "STALE VOCABULARY RETIREMENT GATE FAILED:" >&2
    echo "$retirement_gate" >&2
    exit 1
    ;;
esac
bash tests/scripts/retirement-gate.sh

echo "==> Validating /ship-loop's non-overridable checkpoint..."
# /ship-loop's single mandatory human checkpoint moved from a cost-tier boundary (which
# stopped existing once commands declared no tier) to the brief handoff. Nothing else here fails
# the build if a later edit to commands/ship-loop.md quietly drops "non-overridable" or either of
# the two anchors the checkpoint fires at -- the brief handoff, and (on a cold start with no design
# action) after /plan-loop. tests/scripts/checkpoint-gate.sh proves this gate both ways, against
# the real file and against a `cp`'d copy with the wording deliberately weakened.
if ! node tests/scripts/lib/checkpoint-gate.mjs commands/ship-loop.md; then
  exit 1
fi
bash tests/scripts/checkpoint-gate.sh

echo "==> Validating new cost-tier artifacts..."
for f in \
  templates/BRIEF.md.tmpl \
  templates/DESIGN.md.tmpl \
  templates/ATLAS.md.tmpl \
  templates/RCA.md.tmpl \
  agents/designer.md \
  commands/design.md \
  commands/atlas.md \
  commands/debug.md \
  commands/somi.md \
  commands/pr.md \
  scripts/somi-loop.mjs \
  scripts/somi-findings.mjs \
  scripts/somi-check.mjs \
  hooks/lib/common.mjs; do
  if [ ! -f "$f" ]; then
    echo "MISSING ARTIFACT: $f" >&2
    exit 1
  fi
done
# The execution brief is the load-bearing design→execution handoff — it must be referenced by
# the agents/commands that produce and consume it, not orphaned.
if ! grep -rIlq 'BRIEF\.md\.tmpl' agents commands; then
  echo "templates/BRIEF.md.tmpl is not referenced by any agent or command" >&2
  exit 1
fi

echo "==> Validating skill <-> docs/SKILLS.md index completeness..."
# Every skills/<name>/SKILL.md must have a matching markdown link in docs/SKILLS.md's
# "What SoMi ships" table — that table is the real, human-facing registration surface
# (there is no manifest that enumerates skills individually to sync against instead).
index_failed=0
for f in skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  name="$(basename "$(dirname "$f")")"
  if ! grep -qF "../skills/$name/SKILL.md" docs/SKILLS.md; then
    echo "SKILL NOT INDEXED: $name (docs/SKILLS.md has no link to ../skills/$name/SKILL.md)" >&2
    index_failed=1
  fi
done
if [ "$index_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating agent <-> docs/AGENTS.md index completeness..."
# Every agents/<name>.md must have a matching '### <name>' section in docs/AGENTS.md, and every
# such section must have a matching agents/<name>.md file -- mirrors the skills <-> docs/SKILLS.md
# check above. Without this, a new agent file ships undocumented and stays green forever, which is
# exactly how refactor-designer shipped with no docs/AGENTS.md section for two review passes.
# Reserved heading level: '### ' in docs/AGENTS.md is read ENTIRELY as agent-section markers by
# this loop -- any other H3 (e.g. "### Cost tiering details") is misdiagnosed as an orphaned agent
# section. A non-agent subsection belongs at a different heading level (## or ####), not H3.
agent_index_failed=0
for f in agents/*.md; do
  [ -f "$f" ] || continue
  name="$(basename "$f" .md)"
  if ! grep -qE "^### ${name}\$" docs/AGENTS.md; then
    echo "AGENT NOT INDEXED: $name (docs/AGENTS.md has no '### $name' section)" >&2
    agent_index_failed=1
  fi
done
while IFS= read -r name; do
  [ -z "$name" ] && continue
  if [ ! -f "agents/$name.md" ]; then
    echo "AGENT SECTION ORPHANED: docs/AGENTS.md has '### $name' but agents/$name.md does not exist -- if this is not an agent section, use ## or #### instead of ###" >&2
    agent_index_failed=1
  fi
done < <(grep -E '^### ' docs/AGENTS.md | sed 's/^### //')
if [ "$agent_index_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating command <-> docs/COMMANDS.md index completeness..."
# Every commands/<name>.md must appear as a linked row in docs/COMMANDS.md's catalogue table, and
# every linked row must correspond to a real commands/<name>.md file -- mirrors the agent <->
# docs/AGENTS.md check above. docs/COMMANDS.md has no '### <name>' sections, so this gate matches
# on the link form: only a catalogue-table row (a line starting with "| [") counts as an index
# entry -- prose mentioning ../commands/<name>.md elsewhere must not. Both directions read from
# the SAME indexed set below, so the table is checked against commands/ exactly, both ways.
command_index_failed=0
indexed_commands="$(grep -E '^\| \[' docs/COMMANDS.md | grep -oE '\.\./commands/[A-Za-z0-9_-]+\.md' | sed -E 's#^\.\./commands/##; s#\.md$##')"
for f in commands/*.md; do
  [ -f "$f" ] || continue
  name="$(basename "$f" .md)"
  if ! grep -qxF "$name" <<< "$indexed_commands"; then
    echo "COMMAND NOT INDEXED: $name (docs/COMMANDS.md's catalogue table has no link to ../commands/$name.md)" >&2
    command_index_failed=1
  fi
done
while IFS= read -r name; do
  [ -z "$name" ] && continue
  if [ ! -f "commands/$name.md" ]; then
    echo "COMMAND LINK ORPHANED: docs/COMMANDS.md's catalogue table links to ../commands/$name.md but commands/$name.md does not exist -- if this is not a catalogue-table row, use a different link form outside the table" >&2
    command_index_failed=1
  fi
done <<< "$indexed_commands"
if [ "$command_index_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating command/skill namespace collisions..."
# (a) commands/ and skills/ share ONE namespace on Claude Code — a command and a skill with the
# same name collide, and the skill silently loses. That is the defect this whole work item started
# from: commands/test-strategy.md shadowed skills/test-strategy/SKILL.md, the skill never loaded,
# and nothing errored.
#
# Keyed on DIRECTORY name. That is sufficient under EITHER registration mechanism — not because
# the mechanism is settled (it is not; F-28's probe is still open) but by composition: check (c)
# below forces declared-name == directory for every skill, so no command basename can equal any
# skill's declared name either. Unstated premise, verified today and unchecked: zero of the
# commands/*.md files declare a frontmatter `name:`. If one ever does, this composition breaks
# silently.
collision_failed=0
for f in commands/*.md; do
  [ -f "$f" ] || continue
  name="$(basename "$f" .md)"
  if [ -f "skills/$name/SKILL.md" ]; then
    echo "NAMESPACE COLLISION: commands/$name.md and skills/$name/SKILL.md — the skill will be shadowed" >&2
    collision_failed=1
  fi
done
if [ "$collision_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating skill frontmatter name <-> directory parity..."
# (c) A skill's declared `name:` and its directory must agree. A mismatch is invisible to every
# other gate here: iteration 1.1's review reverted a renamed skill's `name:` and BOTH acceptance
# greps plus the whole suite stayed green. Whether the host registers on directory or on `name:`
# is not settled (evidence points at directory — Anthropic's hookify ships a mismatch and its own
# commands invoke the directory name), so this ships as a parity/hygiene assertion: an
# undetectable inconsistency between the two is worth failing on either way. Do NOT reword this
# as "prevents a collision" until the mechanism probe in phase 1 iteration 1.1 has returned.
parity_failed=0
for f in skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  dir="$(basename "$(dirname "$f")")"
  declared="$(awk '/^---$/{c++; next} c==1 && /^name:[[:space:]]*/{sub(/^name:[[:space:]]*/,""); gsub(/^["'"'"']|["'"'"']$/,""); sub(/[[:space:]]+$/,""); print; exit}' "$f")"
  if [ "$dir" != "$declared" ]; then
    echo "SKILL NAME PARITY: skills/$dir/SKILL.md declares name: '$declared' (expected '$dir')" >&2
    parity_failed=1
  fi
done
if [ "$parity_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating review-agent write-discipline contracts..."
# (d) Five documents assert that every review-type agent carries a `## Write discipline` section,
# and /review-panel's argument for running four lenses concurrently DEPENDS on it. A fifth review
# agent added without one falsifies all five at once and silently holes that rationale. The
# two-part sweep below finds false statements; only this finds a MISSING one.
contract_failed=0
# DERIVED, not hardcoded: the seated lenses are read out of commands/review-panel.md's own table —
# the document whose concurrency rationale depends on the claim. A hardcoded list cannot detect the
# threat this check exists for (a FIFTH review agent seated without a contract); it would only
# catch removal from the four already known.
# Extraction is deliberately NAME-AGNOSTIC: any backticked cell leading a table row. An earlier
# form matched `*-reviewer`/`*-strategist`, which caught a seated `perf-reviewer` but would have
# let `accessibility-auditor` or `perf-lens` through silently — and because the other four still
# derived, the vacuity guard below would not have fired either. Trade accepted deliberately: a
# future table in this file leading with a backticked non-agent cell now produces a LOUD, named
# MISSING AGENT error rather than a silent miss. Loud-and-wrong is diagnosable; silent-and-missing
# is the defect class this whole work item exists to remove.
seated="$(grep -oE '^\| *`[a-z][a-z0-9-]*`' commands/review-panel.md | tr -d '|` ' | sort -u)"
if [ -z "$seated" ]; then
  echo "WRITE CONTRACT CHECK: found no seated lenses in commands/review-panel.md — table shape changed?" >&2
  contract_failed=1
fi
for a in $seated; do
  if [ ! -f "agents/$a.md" ]; then
    echo "MISSING AGENT: commands/review-panel.md seats '$a' but agents/$a.md does not exist" >&2
    contract_failed=1
  elif ! grep -q '^## Write discipline' "agents/$a.md"; then
    echo "MISSING WRITE CONTRACT: agents/$a.md has no '## Write discipline' section" >&2
    contract_failed=1
  fi
done
if [ "$contract_failed" -ne 0 ]; then
  exit 1
fi
# pr is never seated in commands/review-panel.md (it is not a review lens), so the derived sweep
# above cannot cover it -- but its own contract is load-bearing (agents/pr.md's Write discipline
# section is the only thing gating an ungated `gh pr create`), so assert it directly.
if ! grep -q '^## Write discipline' agents/pr.md; then
  echo "MISSING WRITE CONTRACT: agents/pr.md has no '## Write discipline' section" >&2
  exit 1
fi

echo "==> Validating the tools-doctrine two-part sweep..."
# The `read-only` grep STRUCTURALLY cannot find false-rationale locations that omit the phrase —
# which is why docs/AGENTS.md and docs/COMMANDS.md had to be hand-added to iteration 2.1's list,
# and why docs/EXTENDING.md was missed entirely until code review. Both patterns must stay clean.
# Pattern 2 targets the false RATIONALE, not the token `tools:` — a broader pattern matches the
# corrected text too, and a check that fires on its own fix is a check nobody keeps.
sweep_failed=0
# SWEEP ROOTS: the plan's full eight. An earlier draft ran three and silently dropped rules/ —
# the digest SOURCE injected into every gated turn of every consuming project, and one the
# parity-only drift gate below cannot cover (it verifies the copies match the canonical, never
# that the canonical is true).
SWEEP_ROOTS="agents/ commands/ docs/ rules/ skills/ templates/ AGENTS.md .github/"
# Pattern 1 must cover BOTH grammatical shapes the false claim takes. An earlier draft matched
# only "does not have Write/Edit" and "agent is read-only (Read" — 4 of the 12 known instances,
# missing every commands/review-panel.md case and docs/WORKFLOWS.md:290, which are the two the
# plan singles out as worst because /review-panel's concurrency argument rests on them. The
# `by contract` filter is what lets the CORRECTED text through: it says read-only and means it.
if grep -rnE 'do(es)? not have (Write|Edit)|agent is read-only \(Read|(lens|lenses|[Rr]eviewer|review agents?) (is|are) \*{0,2}read-only|read-only review (lens|lenses|agents?)' $SWEEP_ROOTS 2>/dev/null | grep -vE 'read-only \*{0,2}(by contract|\*{0,2} ?by contract)'; then
  echo "FALSE CAPABILITY CLAIM: an agent/lens is described as lacking Write/Edit; no SoMi agent declares tools: — restate as a contract" >&2
  sweep_failed=1
fi
# Pattern 2 targets the false RATIONALE, never the token `tools:` — a broader pattern matches the
# corrected text too, and a check that fires on its own fix is a check nobody keeps. `cross-runtime
# compat` rather than bare `cross-runtime`: this repo legitimately discusses cross-host runtime
# portability in docs/HOOKS.md, INSTALL.md, PLUGIN.md and architecture.md, and firing there would
# report "FALSE TOOLS RATIONALE" about a sentence with nothing to do with tools.
if grep -rniE 'cross-runtime compat|leave it unrestricted|works across Claude Code and GitHub Copilot|declares its own tools' $SWEEP_ROOTS 2>/dev/null; then
  echo "FALSE TOOLS RATIONALE: both hosts support tools:; omission is a simplicity choice, not compatibility" >&2
  sweep_failed=1
fi
if [ "$sweep_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating digest parity across the three copies..."
# (b) The canonical rules/CLAUDE.md is the only editable copy; AGENTS.md and
# .github/copilot-instructions.md are generated. Hand-syncing three copies is what let the Copilot
# copy silently lose the `Reasoning craft` bullet. This is the DRIFT GATE — tests/scripts/
# generate-digest.sh is the generator's unit guard, which is a different thing.
if ! node scripts/generate-digest.mjs --check; then
  echo "DIGEST DRIFT: regenerate with \`node scripts/generate-digest.mjs\`" >&2
  exit 1
fi

echo "==> Validating version consistency across the six stamped locations..."
# (e) VERSION, package.json, both plugin manifests and both marketplace manifests must agree.
#
# CORRECTED at code review: an earlier comment here claimed "release stamps them at publish time,
# so drift is latent rather than active." That is false, and the false premise is what made this
# check look sufficient. `.github/workflows/publish.yml` runs `npm pkg set version=…` against an
# rsync'd copy — it stamps **package.json alone**, then asserts the checked-out tree is unchanged.
# The other five ship in the tarball at whatever value is committed. So every release publishes
# package.json at N+1 beside five files at N, and this check runs PRE-stamp and structurally
# cannot see that. It is still worth having — it catches a hand-bump that updates some but not
# all six — but do not extend it to the packed output on the strength of the old rationale.
#
# Parsed with node, not grep: two of the six carry the version at a nested array path
# (.plugins[0].version, .extensions[0].version), which a line-oriented grep cannot address.
# NOTE package-lock.json is deliberately NOT in the set — it carries the version at two paths and
# is regenerated by `npm install`, not hand-bumped; adding it would fail on a legitimate workflow.
version_report="$(node -e '
const fs = require("fs");
const read = (label, fn) => { try { return { label, value: fn() }; } catch (e) { return { label, value: undefined, err: e.message }; } };
const j = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
// Each read is individually guarded. An earlier form evaluated the two nested accesses OUTSIDE the
// guard, so a manifest whose plugins/extensions array was empty — still valid JSON, so the earlier
// json_valid loop passes it — died on a TypeError stack instead of reaching the diagnostic below.
const found = [
  read("VERSION", () => fs.readFileSync("VERSION", "utf8").trim()),
  read("package.json", () => j("package.json").version),
  read(".claude-plugin/plugin.json", () => j(".claude-plugin/plugin.json").version),
  read(".claude-plugin/marketplace.json", () => j(".claude-plugin/marketplace.json").plugins[0].version),
  read(".copilot-extension/extension.json", () => j(".copilot-extension/extension.json").version),
  read(".copilot-extension/marketplace.json", () => j(".copilot-extension/marketplace.json").extensions[0].version),
];
const missing = found.filter((f) => !f.value);
if (missing.length) {
  console.error("VERSION UNREADABLE:");
  for (const m of missing) console.error("  " + m.label + (m.err ? "  (" + m.err + ")" : ""));
  process.exit(1);
}
const distinct = [...new Set(found.map((f) => f.value))];
if (distinct.length !== 1) {
  console.error("VERSION MISMATCH across the six stamped locations:");
  for (const f of found) console.error("  " + f.value + "  " + f.label);
  process.exit(1);
}
' 2>&1)" || { echo "$version_report" >&2; exit 1; }

echo "==> Validating relative markdown links..."
# (f) Every git-tracked *.md except CHANGELOG.md (generated release history). `.somi/` needs no
# filter — it is gitignored, so `git ls-files` cannot produce a path inside it.
#
# FENCED AND INLINE CODE ARE SKIPPED, and that is the correctness story: a fence-blind first draft
# flagged four *displayed sample links* in examples/feature-plan-example.md as dead, and "fixing"
# them wrote a CI token into the rendered body of the example that ships to npm. Scans whole-file
# content, so a link whose text wraps across lines is seen (this repo hard-wraps at ~100 chars);
# reference-style links are resolved.
#
# A link that must stay live but whose target lives outside this repo carries an inline same-line
# `<!-- illustrative-path -->` marker — scoped to examples/, so a marker anywhere else FAILS rather
# than exempts. A marker on a link that DOES resolve fails too, so the hatch cannot outlive its
# reason. Prefer a code span or a fence over a marker; see check-links.mjs's header.
if ! node scripts/check-links.mjs; then
  exit 1
fi

echo "==> Creating coverage stub..."
mkdir -p coverage
printf 'TN:\nend_of_record\n' > coverage/lcov.info

echo "==> All checks passed."
