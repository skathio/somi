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

echo "==> Creating coverage stub..."
mkdir -p coverage
printf 'TN:\nend_of_record\n' > coverage/lcov.info

echo "==> All checks passed."
