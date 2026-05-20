#!/usr/bin/env bash
# PostToolUse hook (matcher: Write|Edit) — best-effort lint of just-changed files.
#
# Runs the project's configured linter on the touched file, if one is available.
# Result is informational — we never block from a post-tool hook (the file is
# already written). We surface lint failures back to the model so it can self-correct.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

PATH_INPUT="$(somi::field '.tool_input.file_path')"
[[ -z "$PATH_INPUT" ]] && exit 0
[[ ! -f "$PATH_INPUT" ]] && exit 0

# Skip oversized files (likely generated).
SIZE_BYTES=$(wc -c < "$PATH_INPUT" 2>/dev/null || echo 0)
if (( SIZE_BYTES > 500000 )); then
  exit 0
fi

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

run_if_present() {
  local cmd="$1"; shift
  if command -v "$cmd" >/dev/null 2>&1; then
    "$cmd" "$@" 2>&1 || true
  fi
}

LINT_OUTPUT=""

case "$PATH_INPUT" in
  *.py)
    if [[ -f "$PROJECT_ROOT/pyproject.toml" ]] || [[ -f "$PROJECT_ROOT/.ruff.toml" ]]; then
      LINT_OUTPUT="$(run_if_present ruff check --quiet "$PATH_INPUT")"
    fi
    ;;
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    has_eslint_config=false
    shopt -s nullglob
    for file in "$PROJECT_ROOT"/.eslintrc*; do
      if [[ -f "$file" ]]; then
        has_eslint_config=true
        break
      fi
    done
    shopt -u nullglob

    if [[ "$has_eslint_config" = true ]] || [[ -f "$PROJECT_ROOT/eslint.config.js" ]] || [[ -f "$PROJECT_ROOT/eslint.config.mjs" ]]; then
      LINT_OUTPUT="$(cd "$PROJECT_ROOT" && run_if_present npx --no-install eslint --no-color "$PATH_INPUT")"
    fi
    ;;
  *.go)
    if [[ -f "$PROJECT_ROOT/go.mod" ]]; then
      LINT_OUTPUT="$(cd "$PROJECT_ROOT" && run_if_present go vet "./$(dirname "${PATH_INPUT#$PROJECT_ROOT/}")/...")"
    fi
    ;;
  *.rs)
    if [[ -f "$PROJECT_ROOT/Cargo.toml" ]]; then
      LINT_OUTPUT="$(cd "$PROJECT_ROOT" && run_if_present cargo clippy --quiet --message-format=short 2>&1 | head -50)"
    fi
    ;;
  *.sh)
    LINT_OUTPUT="$(run_if_present shellcheck "$PATH_INPUT")"
    ;;
esac

if [[ -n "$LINT_OUTPUT" ]]; then
  # Emit as a stderr-style additional context message; harness shows it to the model.
  jq -nc --arg msg "$LINT_OUTPUT" '{additionalContext: ("Lint output for the file just changed:\n" + $msg)}'
fi

exit 0
