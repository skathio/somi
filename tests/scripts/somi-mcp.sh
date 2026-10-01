#!/usr/bin/env bash
# Guards scripts/somi-mcp.mjs: the bundled, zero-dependency stdio MCP server wrapping the same
# scripts/lib/dispatch-resolver.mjs the CLI (scripts/somi-dispatch.mjs) uses. A JSON-RPC stdio
# conversation needs request/response correlation and (for the roots/list rung) a SERVER-initiated
# request answered by the test acting as the client -- awkward in bash alone, so the actual
# protocol driving lives in tests/scripts/lib/somi-mcp-tests.mjs; this file is the thin wrapper
# scripts/validate.sh calls, matching how other heavier checks in this suite pair a .sh entry
# point with a .mjs implementation (e.g. tests/scripts/lib/digest-marker-coupling.mjs).
set -euo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node "$ROOT_REPO/tests/scripts/lib/somi-mcp-tests.mjs"
