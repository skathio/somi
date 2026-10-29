#!/usr/bin/env bash
# The loop engine's libraries (scripts/lib/loop-*.mjs), called in-process: cap resolution and every handler take
# their environment as a parameter and never read process.env (sentinels planted in it, global config included,
# are ignored), malformed caps are refused with exit 64, and the exit model is plain data (check-diff over the cap
# returns its JSON and code 3 in one result). scripts/lib/findings-ledger.mjs gets the same treatment: record's
# identity, breaker and no-write-on-bad-input behaviour, the resolve/reopen/open/get lifecycle, and no environment
# read. The composite steps (loop-step.mjs) and the notes writers have their own test files below. The CLI's bytes
# are pinned separately by tests/scripts/run.sh and its goldens.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Hermetic like scripts/validate.sh: the developer's global config must not reach the suite.
export SOMI_GLOBAL_CONFIG=""
node "$ROOT/tests/scripts/lib/loop-engine-tests.mjs"
node "$ROOT/tests/scripts/lib/findings-ledger-tests.mjs"
node "$ROOT/tests/scripts/lib/loop-notes-tests.mjs"
node "$ROOT/tests/scripts/lib/loop-step-tests.mjs"
