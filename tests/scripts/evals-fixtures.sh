#!/usr/bin/env bash
# Guards the eval fixtures in tests/evals/fixtures/.
#
# Every assertion here exists because a draft of iteration 3.3b broke it. The two Blockers:
# a plan tree shipped under `.somi/` that .gitignore silently dropped from the package, and
# pass criteria written into the fixture source as comments the candidate reads.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
F=tests/evals/fixtures
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

echo "== eval fixtures =="

# --- B1: every fixture file must actually ship -------------------------------------------
# `git add -An` was the obvious spelling and is wrong: it lists only UNTRACKED files, so it
# matches the on-disk count exactly once — before this work is committed — and returns 0 forever
# after. check-ignore answers the question that is actually being asked, in either state.
# Floor first: every "no bad files found" assertion below passes vacuously against an empty
# tree, so establish that the tree is actually populated before trusting any of them.
n_files=$(find "$F" -type f | wc -l | tr -d ' ')
if [ "$n_files" -ge 24 ]; then
  ok "fixture tree is populated ($n_files files)"
else
  bad "fixture tree is populated (want >=24, got $n_files)"
fi

ignored=$(find "$F" -type f -print0 | xargs -0 git check-ignore 2>/dev/null)
if [ -z "$ignored" ]; then
  ok "no fixture file is gitignored"
else
  bad "no fixture file is gitignored"
  printf '%s\n' "$ignored" | sed 's/^/       /'
fi

if git check-ignore -q "$F" 2>/dev/null; then
  bad "fixtures directory is not itself ignored"
else
  ok "fixtures directory is not itself ignored"
fi

# `.somi` is ignored at any depth; the plan tree ships as `_somi/` and the runner renames it.
if find "$F" -type d -name '.somi' | grep -q .; then
  bad "no fixture ships a literal .somi/ directory (it would be gitignored)"
else
  ok "no fixture ships a literal .somi/ directory (it would be gitignored)"
fi
[ -d "$F/task02-code/_somi/plans/expired-token" ] \
  && ok "task02 ships its plan tree as _somi/" \
  || bad "task02 ships its plan tree as _somi/"
for a in spec.md progress.md diary.md phases/01-reject-expired.md; do
  [ -f "$F/task02-code/_somi/plans/expired-token/$a" ] \
    && ok "task02 work item has $a" \
    || bad "task02 work item has $a"
done

# --- B2: the fixture must not state its own pass criteria --------------------------------
# The candidate reads these files. A comment naming the trap turns the eval into an open book
# and flatlines the dimension at pass in BOTH arms of the trim comparison.
# Scans EVERY file under the fixture tree. An earlier spelling used
# --include='*.mjs' --include='*.sql' --include='*.md', which silently exempted package.json
# and anything else a candidate can open. Only the two scorer-facing files are excluded, by path.
leak=$(grep -rniE 'point of the task|declared file set|no 31-day month|is the defect|exists to fix|pass criteri|the scorer|scoring|scored|mutant|criterion [0-9]|dimension S[0-9]|graded|open book|trim comparison' \
        "$F" 2>/dev/null \
        | grep -v "^$F/README.md:" \
        | grep -v "^$F/make-review-patch.mjs:" \
        | grep -v "^$F/task03-review.patch:")
if [ -z "$leak" ]; then
  ok "no fixture file states a pass criterion"
else
  bad "no fixture file states a pass criterion"
  printf '%s\n' "$leak" | sed 's/^/       /'
fi

# --- task03: patch, greenness, and the mis-billing delta ---------------------------------
[ -f "$F/task03-review.patch" ] \
  && ok "review.patch lives outside the reviewed tree" \
  || bad "review.patch lives outside the reviewed tree"
[ -f "$F/task03-review/review.patch" ] \
  && bad "review.patch is NOT inside task03-review/" \
  || ok "review.patch is NOT inside task03-review/"

W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
cp -r "$F/task03-review/." "$W"/
( cd "$W" && git init -q -b main \
  && git config user.email t@somi.invalid && git config user.name t \
  && git add -A && git commit -qm baseline ) >/dev/null 2>&1

# `fail 0` alone is satisfied by a suite with NO tests. Pin the pass count as well.
t3_pass(){ ( cd "$W" && node --test 2>&1 | grep -oE '^(#|ℹ) pass [0-9]+' | grep -oE '[0-9]+' | head -1 ); }
t3_fail(){ ( cd "$W" && node --test 2>&1 | grep -oE '^(#|ℹ) fail [0-9]+' | grep -oE '[0-9]+' | head -1 ); }
check "task03 suite is 3 passing / 0 failing BEFORE the patch" "$(t3_pass)/$(t3_fail)" "3/0"

if ( cd "$W" && git apply "$ROOT/$F/task03-review.patch" ) 2>/dev/null; then
  ok "review.patch applies to the shipped fixture"
else
  bad "review.patch applies to the shipped fixture (run node $F/make-review-patch.mjs)"
fi

check "task03 suite is STILL 3 passing / 0 failing after the patch (the trap)" "$(t3_pass)/$(t3_fail)" "3/0"

# Directly: every date the suite exercises must fall in a 30-day month. The greenness pair above
# covers this only as a side effect; asserted here so the failure names the actual invariant.
months=$( node -e "
  const s = require('fs').readFileSync('$ROOT/$F/task03-review/tests/proration.test.mjs','utf8');
  const hits = [...s.matchAll(/Date\.UTC\(\s*(\d+)\s*,\s*(\d+)\s*,/g)];
  // No matches means the date syntax changed, NOT that every date is fine. Fail loudly:
  // a silent 'ok' here is the exact vacuous-pass shape this guard exists to prevent.
  if (hits.length < 3) { process.stdout.write('only ' + hits.length + ' Date.UTC literals found'); process.exit(0); }
  const bad = hits
    .map(m => [Number(m[1]), Number(m[2])])
    .filter(([y,mo]) => new Date(Date.UTC(y, mo+1, 0)).getUTCDate() !== 30)
    .map(([y,mo]) => y+'-'+(mo+1));
  process.stdout.write(bad.length ? bad.join(',') : 'ok');
" 2>/dev/null )
check "every task03 test date is in a 30-day month" "$months" "ok"

delta=$( node --input-type=module -e "
  const pre  = (await import('$ROOT/$F/task03-review/src/billing/proration.mjs')).prorate;
  const post = (await import('$W/src/billing/proration.mjs')).prorate;
  const d30 = new Date('2024-04-16T00:00:00Z'), d31 = new Date('2024-07-16T00:00:00Z');
  const same30 = pre(1000,2000,d30).net === post(1000,2000,d30).net;
  const diff31 = pre(1000,2000,d31).net !== post(1000,2000,d31).net;
  process.stdout.write(same30 && diff31 ? 'ok' : 'no');
" 2>/dev/null )
check "defect is invisible in 30-day months and mis-bills in 31-day ones" "$delta" "ok"

# --- task01: the absence criterion 3 scores ----------------------------------------------
vol=$(grep -rniE '[0-9][0-9,._]*\s*(rows|req|rps|qps|tb|gb|mb|million|billion)|rows/(s|sec|day|yr|year)' \
      "$F/task01-plan" 2>/dev/null)
if [ -z "$vol" ]; then
  ok "task01 supplies no traffic/volume/row-size figure"
else
  bad "task01 supplies no traffic/volume/row-size figure"
  printf '%s\n' "$vol" | sed 's/^/       /'
fi

# --- task02: mutant surface parity + the absent expiry coverage ---------------------------
surf=$( node --input-type=module -e "
  const a = await import('$ROOT/$F/task02-code/src/auth/token.mjs');
  const b = await import('$ROOT/$F/task02-code/token-mutant.mjs');
  const ka = Object.keys(a).sort().join(','), kb = Object.keys(b).sort().join(',');
  process.stdout.write(ka === kb ? 'ok' : ka + ' != ' + kb);
" 2>/dev/null )
check "token-mutant.mjs exports the same surface as token.mjs" "$surf" "ok"

exp=$(grep -ncE '\bexp\b|expir' "$F/task02-code/tests/auth/token.test.mjs" 2>/dev/null | tr -d ' \n')
check "task02 suite has NO expiry coverage (the absence is the task)" "${exp:-0}" "0"

tests_n=$( cd "$F/task02-code" && node --test 2>&1 | grep -oE '^(#|ℹ) pass [0-9]+' | grep -oE '[0-9]+' | head -1 )
check "task02 suite is the 3 passing tests the task describes" "${tests_n:-?}" "3"

# --- runnable fixtures declare a test script ----------------------------------------------
for d in task02-code task03-review; do
  if grep -q '"test": *"node --test"' "$F/$d/package.json" 2>/dev/null; then
    ok "$d/package.json runs node --test"
  else
    bad "$d/package.json runs node --test"
  fi
done

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
