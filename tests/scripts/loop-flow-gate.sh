#!/usr/bin/env bash
# Guards the shape of both loop flows' MCP path (calls per clean pass, no CLI step before the Host fallback, the engine's
# tokens, the safety rules, the size budget), proven red on mutated copies, with one real pass per flow through the
# server (tests/scripts/lib/loop-flow-gate.mjs). It fails unless the summary line printed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Hermetic like scripts/validate.sh: the developer's global config must not reach the suite.
export SOMI_GLOBAL_CONFIG=""
out="$(node "$ROOT/tests/scripts/lib/loop-flow-gate.mjs")" || { printf '%s\n' "$out"; exit 1; }
printf '%s\n' "$out"
printf '%s\n' "$out" | grep -Eq '^loop flow shape: [1-9][0-9]* ok, 0 failed$'
