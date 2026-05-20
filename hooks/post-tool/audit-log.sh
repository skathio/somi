#!/usr/bin/env bash
# PostToolUse hook (matcher: *) — record every tool call to the SOMI audit log.
#
# Pairs with the BLOCK entries written from pre-tool hooks: gives you a single
# log to grep for "what did the agent actually do during this session?"
#
# Sensitive arguments are trimmed; we record tool name, status, and a short summary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

TOOL="$(somi::field '.tool_name')"
[[ -z "$TOOL" ]] && exit 0

SUMMARY=""
case "$TOOL" in
  Bash)
    CMD="$(somi::field '.tool_input.command' | head -c 240)"
    SUMMARY="cmd=\"${CMD}\""
    ;;
  Write|Edit)
    P="$(somi::field '.tool_input.file_path')"
    SUMMARY="path=\"${P}\""
    ;;
  Read)
    P="$(somi::field '.tool_input.file_path')"
    SUMMARY="path=\"${P}\""
    ;;
  *)
    SUMMARY="$(printf '%s' "$SOMI_PAYLOAD" | jq -c '.tool_input // {}' 2>/dev/null | head -c 240 || true)"
    ;;
esac

somi::audit "CALL" "$SUMMARY"
exit 0
