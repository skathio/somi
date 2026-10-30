#!/usr/bin/env bash
# Guards scripts/somi-card.mjs and scripts/lib/run-card.mjs, the run card every agent of a code iteration is briefed
# with: it carries the facts it names and nothing from the loop's history (no verdicts, no findings: a reviewer must
# not learn what the coder thought), it is byte-identical across runs so repeated briefings share a prompt prefix,
# it stays small, its values are printable, and a missing loop state or a bad argument is a usage error.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CARD="$ROOT/scripts/somi-card.mjs"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want $3, got $2)"; fi; }
has() { if grep -qF -- "$2" <<<"$3"; then ok "$1"; else bad "$1 (no '$2' in the card)"; fi; }
echo "== run card =="

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
P="$TMP/proj"; mkdir -p "$P/.somi/somi-state/loop" "$P/.somi/plans/rate-limit/phases"
printf '# spec\n' > "$P/.somi/plans/rate-limit/spec.md"
printf '# phase\n' > "$P/.somi/plans/rate-limit/phases/01-limiter.md"
printf '{"name":"p","scripts":{"test":"node --test"}}\n' > "$P/package.json"
state() { printf '{"slug":"rate-limit","loop":"code","iteration":"1.1","baseline_sha":"40186ed1cd531e5f7cb991aec8d939e475ee3a53","iteration_files":%s,"history":[{"pass":1,"verdict":"request-changes","note":"SECRET-REASONING"}],"status":"running"}\n' "$1" > "$P/.somi/somi-state/loop/rate-limit.1.1.json"; }
state '["src/limiter.mjs","test/limiter.test.mjs"]'
run() { (cd "$P" && CLAUDE_PROJECT_DIR="$P" node "$CARD" "$@"); }

out="$(run --slug rate-limit --iteration 1.1 --host copilot)"; check "a card prints for a loop that was initialised" "$?" "0"
has "it names the scripts directory" "scripts: $ROOT/scripts" "$out"
has "it names the project" "project_dir: $P" "$out"
has "it carries the host" "host: copilot" "$out"
has "it names the plan files to read, the phase file found by number" "read for the task: spec.md, phases/01-limiter.md" "$out"
has "it names the orchestrator-owned files" "written only by the orchestrator (agents never write them): progress.md, diary.md" "$out"
has "it lists the files in scope" "files in scope: src/limiter.mjs test/limiter.test.mjs" "$out"
has "it carries the baseline" "baseline: 40186ed1cd531e5f7cb991aec8d939e475ee3a53" "$out"
has "it names the test command from package.json" "tests: npm test" "$out"
check "it is fenced as data" "$(head -1 <<<"$out")" '```somi-card'
check "nothing from the loop history reaches it" "$(grep -c 'SECRET-REASONING\|request-changes' <<<"$out")" "0"
check "two runs print the same bytes" "$(run --slug rate-limit --iteration 1.1 --host copilot | sha256sum)" "$(sha256sum <<<"$out")"
check "it stays under 2 KiB" "$([ "$(printf '%s' "$out" | wc -c)" -le 2048 ] && echo yes)" "yes"

touch "$P/.somi/plans/rate-limit/brief.md"
has "a brief, when present, is in the read list" "read for the task: spec.md, phases/01-limiter.md, brief.md" "$(run --slug rate-limit --iteration 1.1 --host claude-code)"
state "$(node -e 'console.log(JSON.stringify(Array.from({length:25},(_, i)=>"src/f"+i+".mjs")))')"
has "more than 20 files are cut, with the rest counted" "(and 5 more in the phase file)" "$(run --slug rate-limit --iteration 1.1 --host claude-code)"
state '["src/a\u001b[31m.mjs","src/b‮.mjs"]'
check "control and bidi characters are removed from paths" "$(run --slug rate-limit --iteration 1.1 --host claude-code | grep '^files in scope' | LC_ALL=C grep -c $'[\x01-\x1f]\|\xe2\x80\xae')" "0"
state '["src/a```b.mjs","```"]'
check "a backtick in a file name cannot close the card's fence: the only fence lines are its own two" "$(run --slug rate-limit --iteration 1.1 --host claude-code | grep -c '```')" "2"
rm "$P/package.json"
has "no package.json test script: the card says so" "tests: not declared" "$(run --slug rate-limit --iteration 1.1 --host claude-code)"

run --slug rate-limit --iteration 2.1 --host claude-code >/dev/null 2>&1; check "no loop state is a usage error" "$?" "64"
run --slug ../x --iteration 1.1 --host claude-code >/dev/null 2>&1; check "a traversal slug is a usage error" "$?" "64"
run --slug rate-limit --iteration 1.1 --host vscode >/dev/null 2>&1; check "an unknown host is a usage error" "$?" "64"
run --slug rate-limit --iteration 1.1 >/dev/null 2>&1; check "a missing host is a usage error" "$?" "64"
run --slug rate-limit --iteration 1.1 --host claude-code --extra x >/dev/null 2>&1; check "an unknown argument is a usage error" "$?" "64"

echo "run card tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ]
