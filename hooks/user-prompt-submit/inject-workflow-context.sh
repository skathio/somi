#!/usr/bin/env bash
# UserPromptSubmit hook — inject a brief SOMI context reminder on every user turn.
#
# Keeps the agent grounded in the ruleset without bloating the system prompt.
# Output is appended as additional context to the model's next turn.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

# Detect whether the project has an active PLAN.md (and a stale one is a hint
# the model should reference it). Otherwise no plan-related nudge.
PLAN_HINT=""
if [[ -f "$PROJECT_ROOT/PLAN.md" ]]; then
  PLAN_HINT=$'\n- An active `PLAN.md` exists in the project root. If the user is asking for non-trivial code, the coder should follow the relevant phase/iteration.'
fi

REVIEW_HINT=""
if [[ -f "$PROJECT_ROOT/REVIEW.md" ]]; then
  REVIEW_HINT=$'\n- A `REVIEW.md` exists with findings to address. Blocker/Major findings gate merge.'
fi

CONTEXT="somi-ai is active. Reminders:
- Follow rules/CLAUDE.md priorities: security > correctness > maintainability > performance > convenience.
- Plan before coding non-trivial work. Code from the plan, not around it.
- Surface tradeoffs and shortcuts in plain text; never silently compromise.
- Hooks may block dangerous bash, secret writes, and protected paths — do not work around them.${PLAN_HINT}${REVIEW_HINT}"

jq -nc --arg c "$CONTEXT" '{additionalContext: $c}'
exit 0
