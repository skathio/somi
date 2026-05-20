#!/usr/bin/env bash
# Stop hook — encourage proper handoff at the end of an agent turn.
#
# Runs when the agent is about to declare itself done. We check for common
# "left the project in a half-state" signals and nudge a closing summary.
#
# We never *block* a stop from this hook — that would trap the user. We only
# surface a reminder if there's an obvious loose end.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

NUDGES=()

# Detect tracked files containing TODO(claude) / TODO(agent) markers added in this session.
if command -v git >/dev/null 2>&1 && [[ -d "$PROJECT_ROOT/.git" ]]; then
  if git -C "$PROJECT_ROOT" diff --no-color --unified=0 2>/dev/null \
      | grep -E '^\+.*(TODO\(claude\)|TODO\(agent\)|FIXME\(claude\))' -q; then
    NUDGES+=("Detected new TODO(claude)/FIXME(claude) markers in this diff — make sure the final summary explicitly lists them as 'not done'.")
  fi

  # Untracked .md.bak or scratch files
  if git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null \
      | grep -E '^\?\? .*(\.bak|\.orig|scratch_)' -q; then
    NUDGES+=("Detected scratch / .bak files left behind. Clean them up before declaring done.")
  fi
fi

# Plan exists but no commit on the current iteration? (Heuristic — best-effort.)
# Skipped here to avoid false positives; the audit log + reviewer agent catch this case.

if (( ${#NUDGES[@]} > 0 )); then
  MSG="somi-ai end-of-turn check:"$'\n'
  for n in "${NUDGES[@]}"; do
    MSG+="  - $n"$'\n'
  done
  jq -nc --arg c "$MSG" '{additionalContext: $c}'
fi

exit 0
