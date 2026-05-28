#!/usr/bin/env bash
# UserPromptSubmit hook — inject SOMI context on relevant turns.
#
# Two responsibilities:
#   1. Remind the agent of the priority stack and active work-item state.
#   2. Surface end-of-turn loose ends (TODO(claude) markers, scratch files) on
#      the NEXT user turn — this replaces the old Stop hook, which used an
#      additionalContext channel that Stop events don't actually have.
#
# To avoid double-loading content that's already always-on, the reminder block
# only fires on the first turn of a session OR when work-item state has changed
# since the last turn. The loose-end nudges fire whenever there is something
# to nudge about.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_DIR="${PROJECT_ROOT}/.claude/somi-state"
STATE_FILE="${STATE_DIR}/last-context-signature"
mkdir -p "$STATE_DIR"

# Compute a signature for "current SOMI state" — first turn writes it; subsequent
# turns only re-inject the reminder if the signature changed.
compute_signature() {
  local plans_state=""
  if [[ -d "$PROJECT_ROOT/.somi/plans" ]]; then
    plans_state="$(find "$PROJECT_ROOT/.somi/plans" -maxdepth 2 -name 'progress.md' -printf '%T@ %p\n' 2>/dev/null | sort | sha256sum | cut -d' ' -f1)"
  fi
  local reviews_state=""
  if [[ -d "$PROJECT_ROOT/.somi/reviews" ]]; then
    reviews_state="$(find "$PROJECT_ROOT/.somi/reviews" -maxdepth 3 -name '*.md' -printf '%T@ %p\n' 2>/dev/null | sort | sha256sum | cut -d' ' -f1)"
  fi
  printf '%s:%s' "$plans_state" "$reviews_state"
}

CURRENT_SIG="$(compute_signature)"
LAST_SIG=""
if [[ -f "$STATE_FILE" ]]; then
  LAST_SIG="$(cat "$STATE_FILE" 2>/dev/null || true)"
fi
echo "$CURRENT_SIG" > "$STATE_FILE"

# Active work-item state pulled from .somi/plans/<slug>/progress.md (if present).
PLAN_HINT=""
if [[ -d "$PROJECT_ROOT/.somi/plans" ]]; then
  in_progress=()
  while IFS= read -r progress_file; do
    [[ -z "$progress_file" ]] && continue
    if grep -qiE '^[[:space:]]*<?in-progress>?[[:space:]]*$' "$progress_file" 2>/dev/null \
       || grep -qiE 'status:[[:space:]]*`?in-progress`?' "$progress_file" 2>/dev/null; then
      slug="$(basename "$(dirname "$progress_file")")"
      in_progress+=("$slug")
    fi
  done < <(find "$PROJECT_ROOT/.somi/plans" -maxdepth 2 -name 'progress.md' 2>/dev/null)
  if (( ${#in_progress[@]} == 1 )); then
    PLAN_HINT=$'\n- Active work item: `.somi/plans/'"${in_progress[0]}"$'/`. Follow its `spec.md` and active iteration in `phases/`; update `progress.md` / `diary.md` as work proceeds.'
  elif (( ${#in_progress[@]} > 1 )); then
    PLAN_HINT=$'\n- Multiple in-progress work items in `.somi/plans/`: '"$(IFS=,; echo "${in_progress[*]}")"$'. Confirm with the user which one applies before coding.'
  fi
fi

# Loose-end detection (runs every turn; cheap and only fires when something to nudge).
NUDGES=()
if command -v git >/dev/null 2>&1 && [[ -d "$PROJECT_ROOT/.git" ]]; then
  # TODO(claude) / FIXME(claude) markers in working tree or staged changes.
  if git -C "$PROJECT_ROOT" diff --no-color --unified=0 HEAD 2>/dev/null \
      | grep -E '^\+.*(TODO\(claude\)|TODO\(agent\)|FIXME\(claude\))' -q; then
    NUDGES+=("Detected new TODO(claude)/FIXME(claude) markers in the diff against HEAD. List them explicitly as 'not done' in your next summary.")
  fi
  # Stray .bak / scratch files in working tree.
  if git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null \
      | grep -E '^\?\? .*(\.bak|\.orig|scratch_)' -q; then
    NUDGES+=("Detected scratch / .bak files in working tree. Clean them up before declaring done.")
  fi
fi

# Decide whether to emit the reminder block.
EMIT_REMINDER="no"
if [[ -z "$LAST_SIG" ]] || [[ "$LAST_SIG" != "$CURRENT_SIG" ]]; then
  EMIT_REMINDER="yes"
fi

# Build the final context payload.
PARTS=()
if [[ "$EMIT_REMINDER" == "yes" ]]; then
  PARTS+=("somi-ai is active. Reminders:
- Follow rules/CLAUDE.md priorities: security > correctness > maintainability > performance > convenience.
- Plan before coding non-trivial work. Code from the plan, not around it.
- Surface tradeoffs and shortcuts in plain text; never silently compromise.
- Hooks may deny dangerous bash, secret writes, protected paths, and unsanctioned dep installs — do not work around them.${PLAN_HINT}")
fi

if (( ${#NUDGES[@]} > 0 )); then
  NUDGE_BLOCK="somi-ai loose-end check:"
  for n in "${NUDGES[@]}"; do
    NUDGE_BLOCK+=$'\n  - '"$n"
  done
  PARTS+=("$NUDGE_BLOCK")
fi

if (( ${#PARTS[@]} > 0 )); then
  CONTEXT=""
  for p in "${PARTS[@]}"; do
    if [[ -n "$CONTEXT" ]]; then
      CONTEXT+=$'\n\n'
    fi
    CONTEXT+="$p"
  done
  somi::context "UserPromptSubmit" "$CONTEXT"
fi

exit 0
