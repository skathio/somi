#!/usr/bin/env bash
# Guards the shape of skills/flow-code-loop/SKILL.md's MCP path (four somi_loop calls, two somi_resolve calls, two Tasks per
# clean pass; no CLI step before the Host fallback; only the engine's next tokens and kinds; within the prompt size budget),
# proven red on mutated copies, and runs one real pass through the server using exactly the calls the text prescribes. The
# work is in tests/scripts/lib/loop-flow-gate.mjs; this is the thin wrapper scripts/validate.sh calls.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Hermetic like scripts/validate.sh: the developer's global config must not reach the suite.
export SOMI_GLOBAL_CONFIG=""
node "$ROOT/tests/scripts/lib/loop-flow-gate.mjs"
