#!/usr/bin/env bash
# The loop engine's libraries (scripts/lib/loop-*.mjs), called in-process: cap resolution takes its environment
# as a parameter and never reads process.env, malformed caps are refused with exit 64, and the exit model is
# plain data. The CLI's bytes are pinned separately by tests/scripts/run.sh and its goldens.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$ROOT/tests/scripts/lib/loop-engine-tests.mjs"
