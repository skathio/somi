#!/usr/bin/env bash
# Regression test for scripts/validate.sh check (c): an agent that declares `model:` fails the build.
# Runs the REAL block (and the model_of helper it calls), extracted from a scratch COPY of validate.sh, over
# fixture agent directories -- not a second hand-typed copy of the check. Also asserts the shipped agents/
# declare none. Residual: this proves the block's own logic, not that validate.sh still runs it.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

echo "== agent model frontmatter (scripts/validate.sh) =="
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp -a "$ROOT_REPO/scripts/validate.sh" "$TMP/validate.sh"

HELPER="$(awk '/^model_of\(\) \{/{c=1} c{print} c&&/^\}$/{exit}' "$TMP/validate.sh")"
BLOCK="$(awk '/^# \(c\) /{c=1} c{print} c&&/^done$/{exit}' "$TMP/validate.sh")"
if [ -z "$HELPER" ] || [ -z "$BLOCK" ]; then bad "could not extract the check from scripts/validate.sh -- its markers may have moved"; echo "agent model tests: $pass ok, $fail failed"; exit 1; fi
SNIPPET="$HELPER"$'\ncost_failed=0\n'"$BLOCK"$'\nexit $cost_failed'

run() { (cd "$1" && bash -c "$SNIPPET" 2>"$1/err"); echo $?; }
mkdir -p "$TMP/good/agents" "$TMP/bad/agents" "$TMP/crlf/agents"
printf -- '---\nname: x\ndescription: d\ncost: low\n---\nbody mentions model: here\n' > "$TMP/good/agents/x.md"
printf -- '---\nname: x\ndescription: d\nmodel: some-model\ncost: low\n---\nbody\n' > "$TMP/bad/agents/x.md"
cp "$TMP/good/agents/x.md" "$TMP/bad/agents/y.md"
printf -- '---\r\nname: x\r\nmodel: m\r\ncost: low\r\n---\r\n' > "$TMP/crlf/agents/x.md"

[ "$(run "$TMP/good")" = 0 ] && ok "an agent without model: passes (a body line that mentions model: is not frontmatter)" || bad "clean agent rejected"
[ "$(run "$TMP/bad")" = 1 ] && ok "an agent declaring model: fails the check" || bad "model: agent accepted"
grep -q "MODEL ON AGENT: agents/x.md" "$TMP/bad/err" && ! grep -q "agents/y.md" "$TMP/bad/err" && ok "the message names the offending file only, and says why" || bad "message wrong: $(cat "$TMP/bad/err")"
grep -q "inherit the session tier" "$TMP/bad/err" && ok "the message states the reason (an unresolved launch must inherit the session tier)" || bad "reason missing"
[ "$(run "$TMP/crlf")" = 1 ] && ok "a CRLF file declaring model: fails too" || bad "CRLF agent accepted"
n="$(grep -l '^model:' "$ROOT_REPO"/agents/*.md | wc -l)"
[ "$n" = 0 ] && ok "no shipped agent declares model:" || bad "$n shipped agent(s) declare model:"

echo "agent model tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ]
