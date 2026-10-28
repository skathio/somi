#!/usr/bin/env bash
# The loop engine's libraries (scripts/lib/loop-*.mjs), called in-process: cap resolution and every handler take
# their environment as a parameter and never read process.env (sentinels planted in it, global config included,
# are ignored), malformed caps are refused with exit 64, and the exit model is plain data (check-diff over the cap
# returns its JSON and code 3 in one result). The CLI's bytes are pinned separately by tests/scripts/run.sh and its goldens.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Hermetic like scripts/validate.sh: the developer's global config must not reach the suite.
export SOMI_GLOBAL_CONFIG=""
exec node "$ROOT/tests/scripts/lib/loop-engine-tests.mjs"
