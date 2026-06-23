#!/usr/bin/env bash
# Validation script run as `npm test`. Checks JSON, shell scripts, and frontmatter.
# Also emits a minimal coverage/lcov.info stub so the hashira-ops CI coverage-report
# action has a file to parse (no unit test suite; coverage is N/A for this plugin).
set -euo pipefail

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
  echo "  jq: $f"
  jq empty "$f"
done

echo "==> ShellCheck hook scripts..."
find hooks -name '*.sh' -type f -print0 \
  | xargs -0 shellcheck --severity=warning

echo "==> Bash syntax check..."
find hooks -name '*.sh' -type f -print0 \
  | xargs -0 -I{} bash -n {}

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
# MAX tier (opus): front-load reasoning + fresh-eyes review.
for a in discovery-analyst designer refactorer reviewer security-reviewer architecture-reviewer test-strategist; do
  assert_model "agents/$a.md" opus
done
# MAX front-load commands run opus end-to-end (their orchestration is judgment-heavy).
assert_model commands/discover.md opus
assert_model commands/design.md opus
if [ "$tier_failed" -ne 0 ]; then
  exit 1
fi

echo "==> Validating new MAX/ECO artifacts..."
for f in \
  templates/BRIEF.md.tmpl \
  templates/DESIGN.md.tmpl \
  agents/designer.md \
  commands/design.md; do
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

echo "==> Creating coverage stub..."
mkdir -p coverage
printf 'TN:\nend_of_record\n' > coverage/lcov.info

echo "==> All checks passed."
