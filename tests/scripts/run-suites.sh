#!/usr/bin/env bash
# Guards tests/scripts/lib/run-suites.mjs, the parallel runner validate.sh starts its test scripts with: a failing
# script fails the run and is named; output is printed whole and in the order given, whatever the finish order;
# --jobs N really runs N at once and --jobs 1 runs one at a time (proved by start/end markers, not by timing); and
# bad arguments are a usage error.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN="$ROOT/tests/scripts/lib/run-suites.mjs"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want $3, got $2)"; fi; }
echo "== run-suites (parallel test runner) =="

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
# a finishes last, b first; each logs its start and end to a shared marker file.
mk() { printf '#!/usr/bin/env bash\necho "start %s" >> marks\n%s\necho "end %s" >> marks\necho "out of %s"\nexit %s\n' "$1" "$2" "$1" "$1" "$3" > "$1.sh"; }
mk a 'sleep 0.6' 0
mk b ':' 0
mk c 'sleep 0.3; echo "to stderr" >&2' 3

: > marks; out="$(node "$RUN" --jobs 3 a.sh b.sh c.sh)"; rc=$?
check "a failing script fails the run" "$rc" "1"
check "the failure is named in the summary" "$(grep -c '^    FAILED: c.sh (exit 3)$' <<<"$out")" "1"
check "blocks print in the order given, not the finish order" "$(grep -oE '^==> [abc]\.sh$' <<<"$out" | tr '\n' ' ')" "==> a.sh ==> b.sh ==> c.sh "
check "each block carries its script's own output, stderr included" "$(sed -n '/^==> c.sh$/,/^    (/p' <<<"$out" | grep -cE '^(to stderr|out of c)$')" "2"

: > marks; out="$(node "$RUN" --jobs 1 a.sh b.sh)"; rc=$?
check "every script passing is exit 0" "$rc" "0"
check "--jobs 1 runs one at a time" "$(tr '\n' ' ' < marks)" "start a end a start b end b "

: > marks; out="$(SOMI_TEST_JOBS=1 node "$RUN" b.sh a.sh)"
check "SOMI_TEST_JOBS sets the default" "$(tr '\n' ' ' < marks)" "start b end b start a end a "

# Concurrency without timing: each barrier script waits (up to 10s) until all three have started.
for n in x y z; do mk "$n" 'for _ in $(seq 100); do [ "$(grep -c "^start" marks)" -ge 3 ] && break; sleep 0.1; done' 0; done
: > marks; node "$RUN" --jobs 3 x.sh y.sh z.sh >/dev/null
check "--jobs 3 runs three at once: all three start before any ends" "$(head -3 marks | grep -c '^start ')" "3"

node "$RUN" --jobs 0 a.sh >/dev/null 2>&1; check "--jobs 0 is a usage error" "$?" "64"
node "$RUN" --jobs x a.sh >/dev/null 2>&1; check "a non-numeric --jobs is a usage error" "$?" "64"
node "$RUN" >/dev/null 2>&1; check "no scripts is a usage error" "$?" "64"
node "$RUN" --bogus a.sh >/dev/null 2>&1; check "an unknown option is a usage error" "$?" "64"
node "$RUN" --jobs 2 missing.sh >/dev/null 2>&1; check "a missing script fails the run" "$?" "1"

echo "run-suites tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ]
