#!/usr/bin/env bash
# Shared helpers for somi-ai hooks.
#
# Hooks receive a JSON payload on stdin describing the tool invocation, and may
# emit a JSON response on stdout to control the harness:
#
#   {"decision": "block", "reason": "..."}   - deny the tool call
#   {"decision": "allow"}                    - explicitly allow (rare)
#   <empty stdout>                           - pass-through (default)
#
# Exit code 0 = pass-through (unless stdout contains a decision).
# Exit code non-zero = treated as a runtime error (will surface to the user).
#
# These helpers rely on jq. The validate.sh script confirms jq is installed.

set -euo pipefail

# SOMI_ROOT is the install root. The settings.json wires it via ${CLAUDE_PROJECT_DIR}
# or an explicit env. Fall back to the directory containing this file's parent.
SOMI_ROOT="${SOMI_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Path to the audit log. Project-local by default. Configurable via SOMI_AUDIT_LOG.
SOMI_AUDIT_LOG="${SOMI_AUDIT_LOG:-${CLAUDE_PROJECT_DIR:-$PWD}/.claude/audit.log}"

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

# Emit a "block" decision and exit cleanly. Hook framework treats stdout as the
# control channel; the reason is shown to the model.
somi::block() {
  local reason="$1"
  jq -nc --arg r "$reason" '{decision:"block", reason:$r}'
  somi::audit "BLOCK" "$reason"
  exit 0
}

# Emit an "allow" decision (rare — used only when a hook needs to short-circuit
# a chain in favor of a tool call).
somi::allow() {
  jq -nc '{decision:"allow"}'
  exit 0
}

# Append a structured line to the audit log.
somi::audit() {
  local kind="$1"
  local detail="$2"
  local tool
  tool="$(somi::field '.tool_name')"
  mkdir -p "$(dirname "$SOMI_AUDIT_LOG")"
  printf '%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$kind" \
    "${tool:-unknown}" \
    "$detail" \
    >> "$SOMI_AUDIT_LOG"
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
