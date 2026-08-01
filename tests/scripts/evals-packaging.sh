#!/usr/bin/env bash
# Guards phase 3's stated invariant risk: `npm test` stays hermetic, and the eval corpus never
# ships to consumers. Iteration 3.4c owns this alone, deliberately separated from 3.4a/b so the
# invariant is not spread through a large diff.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

echo "== eval packaging & hermeticity =="

# --- the corpus must not ship ------------------------------------------------------------------
# `tests/` is in package.json's `files`, so exclusion needs tests/.npmignore -- a ROOT .npmignore
# does not override `files`. That mechanism was verified when the plan was written; this asserts
# the outcome rather than trusting it.
pack=$(npm pack --dry-run --json 2>/dev/null)
if [ -z "$pack" ]; then
  bad "npm pack --dry-run produced output"
else
  ok "npm pack --dry-run produced output"
  n_total=$(printf '%s' "$pack" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s)[0].files.length)))")
  for pat in 'tests/evals/' 'evals/fixtures' 'evals/tasks' 'evals/run.mjs' 'rubric.md' 'evals-fixtures.sh'; do
    n=$(printf '%s' "$pack" | node -e "
      let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        const f=JSON.parse(s)[0].files.filter(x=>x.path.includes(process.argv[1]));
        process.stdout.write(String(f.length));});" "$pat")
    check "npm tarball contains no '$pat'" "$n" "0"
  done
  # Floor: a tarball that is empty would pass every check above vacuously.
  if [ "${n_total:-0}" -ge 50 ]; then
    ok "npm tarball is non-empty ($n_total paths)"
  else
    bad "npm tarball is non-empty (want >=50, got ${n_total:-0})"
  fi
fi

# --- npm test must not EXECUTE the runner -------------------------------------------------------
# Structural and invocation-level, per the phase's exit criteria: a `node --check` glob merely
# NAMING tests/evals is explicitly permitted; executing the runner is not. A bare "no mention"
# grep would be self-contradicting, since validate.sh must name the directory to syntax-check it.
test_script=$(node -e "process.stdout.write(require('./package.json').scripts.test)")
check "npm test runs validate.sh, not the eval runner" "$test_script" "bash scripts/validate.sh"

# Scoped to what `npm test` actually reaches: the `test` script string, and validate.sh (which it
# runs). package.json's OTHER scripts may reference the runner -- eval:behavioral exists precisely
# to. Checking the whole file would flag the deliberate escape hatch as the leak.
reach=$( { printf '%s\n' "$test_script"; cat scripts/validate.sh; } \
  | grep -nE '(^|[^-])\b(node|bash|sh)[[:space:]]+[^|;&]*tests/evals/run\.mjs' | grep -v -- '--check')
if [ -z "$reach" ]; then
  ok "nothing reachable from npm test executes tests/evals/run.mjs"
else
  bad "nothing reachable from npm test executes tests/evals/run.mjs"
  printf '%s\n' "$reach" | sed 's/^/       /'
fi

# The runner is reachable on purpose through its own script, which is NOT `test`.
have=$(node -e "const s=require('./package.json').scripts; process.stdout.write(s['eval:behavioral'] ?? 'MISSING')")
check "an explicit eval:behavioral script exists" "$have" "node tests/evals/run.mjs"

# --- npm test itself must not reach the network -------------------------------------------------
# Tests INVOCATION, not substrings. A URL inside a string literal is not a network call:
# check-links.sh builds `[a](https://e.com/x.md)` as a fixture, and eval-runner.sh's own
# hermeticity assertion contains the pattern `https?://` as a grep argument. A substring scan
# flags both, which trains the reader to ignore it -- the failure mode of a noisy guard.
net_failed=0
for f in scripts/validate.sh $(git ls-files 'tests/scripts/*.sh'); do
  hits=$(grep -nE '(^|[;&|(]|[[:space:]])(curl|wget|nc|ssh|scp)[[:space:]]|\$\{?ANTHROPIC_API_KEY|\$\{?OPENAI_API_KEY|process\.env\.(ANTHROPIC|OPENAI)' "$f" 2>/dev/null \
    | grep -vE "^[0-9]+:[[:space:]]*#" | grep -vE "grep -[a-zA-Z]*E?[[:space:]]+'")
  if [ -n "$hits" ]; then
    bad "$f makes no network call or credential read"
    printf '%s\n' "$hits" | sed 's/^/       /'
    net_failed=1
  fi
done
[ "$net_failed" -eq 0 ] && ok "no script reachable from npm test invokes a network client or reads a credential"

# --- node --check must cover the eval tree ------------------------------------------------------
if grep -qE 'EVAL_TREE="tests/evals"' scripts/validate.sh \
   && grep -qE "find hooks scripts \\\$EVAL_TREE -name '\\*\\.mjs'" scripts/validate.sh; then
  ok "validate.sh syntax-checks tests/evals/**/*.mjs"
else
  bad "validate.sh syntax-checks tests/evals/**/*.mjs"
fi
# Skipped in a published tarball, where the tree is absent BY DESIGN -- the exclusion asserted
# above. Failing here would make the guard contradict its own passing assertion.
if [ -d tests/evals ]; then
  n_mjs=$(find tests/evals -name '*.mjs' -type f | wc -l | tr -d ' ')
  if [ "$n_mjs" -ge 10 ]; then
    ok "there are .mjs files under tests/evals to check ($n_mjs)"
  else
    bad "there are .mjs files under tests/evals to check (want >=10, got $n_mjs)"
  fi
else
  ok "tests/evals absent (published tarball) - syntax-check scope assertion skipped"
fi

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
