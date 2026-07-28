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
  package.json \
  hooks/hooks.json \
  examples/sample-consumer/.claude/settings.json; do
  echo "  node JSON.parse: $f"
  json_valid "$f"
done

echo "==> Node syntax check (node --check over the ported .mjs)..."
find hooks scripts -name '*.mjs' -type f -print0 \
  | xargs -0 -I{} node --check {}

echo "==> Hook behavior fixtures..."
for f in tests/hooks/cases/*.json; do
  echo "  node JSON.parse: $f"
  json_valid "$f"
done
bash tests/hooks/run.sh

echo "==> Loop-state & findings-ledger tests..."
bash tests/scripts/run.sh

echo "==> Digest-generator tests..."
# Guards scripts/generate-digest.mjs: per-target prefix transform, drift detection in EITHER
# copy alone, clean errors on malformed input, and splice anchoring. Wiring `--check` itself
# into this script (so CI fails on committed drift) is phase 3, iteration 3.1 — this is the
# unit guard for the generator, not the drift gate.
bash tests/scripts/generate-digest.sh

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

echo "==> Validating MAX/ECO model tiering..."
# Extract the first `model:` value from a file's frontmatter (the block between the
# first two `---` lines).
model_of() {
  awk '/^---$/{c++} c==1 && /^model:[[:space:]]*/{sub(/^model:[[:space:]]*/,""); print; exit}' "$1"
}
tier_failed=0
assert_model() {
  local f="$1" want="$2" got
  got="$(model_of "$f")"
  if [ "$got" != "$want" ]; then
    echo "MODEL TIER MISMATCH: $f model is '$got', expected '$want'" >&2
    tier_failed=1
  fi
}
# ECO tier (sonnet): planning + coding execute against the MAX brief.
assert_model agents/planner.md sonnet
assert_model agents/coder.md sonnet
assert_model agents/somi.md sonnet
# MAX tier (opus): front-load reasoning + fresh-eyes review.
for a in discovery-analyst designer refactorer reviewer security-reviewer architecture-reviewer test-strategist; do
  assert_model "agents/$a.md" opus
done
# MAX front-load commands run opus end-to-end (their orchestration is judgment-heavy).
assert_model commands/discover.md opus
assert_model commands/design.md opus
assert_model commands/atlas.md opus
if [ "$tier_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating new MAX/ECO artifacts..."
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
# The execution brief is the load-bearing MAX→ECO handoff — it must be referenced by
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

echo "==> Validating command/skill namespace collisions..."
# (a) commands/ and skills/ share ONE namespace on Claude Code — a command and a skill with the
# same name collide, and the skill silently loses. That is the defect this whole work item started
# from: commands/test-strategy.md shadowed skills/test-strategy/SKILL.md, the skill never loaded,
# and nothing errored.
#
# Keyed on DIRECTORY name. That is sufficient under EITHER registration mechanism — not because
# the mechanism is settled (it is not; F-28's probe is still open) but by composition: check (c)
# below forces declared-name == directory for every skill, so no command basename can equal any
# skill's declared name either. Unstated premise, verified today and unchecked: zero of 24
# commands/*.md declare a frontmatter `name:`. If one ever does, this composition breaks silently.
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

echo "==> Creating coverage stub..."
mkdir -p coverage
printf 'TN:\nend_of_record\n' > coverage/lcov.info

echo "==> All checks passed."
