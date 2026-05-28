#!/usr/bin/env bash
# Shared helpers for somi-ai hooks.
#
# Hooks receive a JSON payload on stdin describing the tool invocation, and may
# emit a JSON response on stdout to control the harness. Output schema is
# event-specific (see https://code.claude.com/docs/en/hooks):
#
#   PreToolUse        — { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
#   PostToolUse       — { hookSpecificOutput: { hookEventName, additionalContext } }  or  { decision, reason }
#   UserPromptSubmit  — { hookSpecificOutput: { hookEventName, additionalContext } }  or  { decision, reason }
#   Stop              — { decision: "block", reason }   (no additionalContext channel)
#
# Helpers below emit the right shape per event. Use them — do not hand-emit
# legacy `{decision:"block"}` or bare `{additionalContext}` shapes; the harness
# silently drops the wrong shape for the wrong event.

set -euo pipefail

# Read the full JSON payload from stdin once. Subsequent jq calls use this.
somi::read_payload() {
  SOMI_PAYLOAD="$(cat)"
  export SOMI_PAYLOAD
}

# Extract a field from the payload using jq. Returns empty string if missing.
somi::field() {
  local path="$1"
  printf '%s' "${SOMI_PAYLOAD:-}" | jq -r "${path} // empty" 2>/dev/null || true
}

# Path to the audit log. Project-local by default. Configurable via SOMI_AUDIT_LOG.
somi::audit_log_path() {
  printf '%s' "${SOMI_AUDIT_LOG:-${CLAUDE_PROJECT_DIR:-$PWD}/.claude/audit.log}"
}

# Append a structured line to the audit log.
somi::audit() {
  local kind="$1"
  local detail="$2"
  local tool
  local log
  tool="$(somi::field '.tool_name')"
  log="$(somi::audit_log_path)"
  mkdir -p "$(dirname "$log")"
  printf '%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$kind" \
    "${tool:-unknown}" \
    "$detail" \
    >> "$log"
}

# Deny a PreToolUse tool call. Use this for block-* hooks.
# Emits the modern hookSpecificOutput.permissionDecision schema.
somi::deny_pretool() {
  local reason="$1"
  jq -nc --arg r "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  somi::audit "DENY" "$reason"
  exit 0
}

# Emit additionalContext for events that support it (PreToolUse, PostToolUse,
# UserPromptSubmit). The harness shows this to the model on its next turn.
# First arg is the event name; second is the context string.
# Stop does NOT support additionalContext — do not call this from a Stop hook.
somi::context() {
  local event="$1"
  local context="$2"
  jq -nc --arg e "$event" --arg c "$context" '{
    hookSpecificOutput: {
      hookEventName: $e,
      additionalContext: $c
    }
  }'
}

# Test whether a command string matches any extended-regex pattern.
# Usage: somi::matches_any "$cmd" "pattern1" "pattern2" ...
somi::matches_any() {
  local cmd="$1"; shift
  local pattern
  for pattern in "$@"; do
    if [[ "$cmd" =~ $pattern ]]; then
      return 0
    fi
  done
  return 1
}

# Case-insensitive variant. Uses nocasematch in a subshell to avoid leaking shell state.
somi::matches_any_nocase() {
  local cmd="$1"; shift
  local pattern
  (
    shopt -s nocasematch
    for pattern in "$@"; do
      if [[ "$cmd" =~ $pattern ]]; then
        exit 0
      fi
    done
    exit 1
  )
}
