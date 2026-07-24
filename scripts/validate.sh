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

echo "==> Creating coverage stub..."
mkdir -p coverage
printf 'TN:\nend_of_record\n' > coverage/lcov.info

echo "==> All checks passed."
