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
# LOAD-BEARING CHECK: a content-hash manifest over every candidate-visible file. The keyword
# grep below is kept as a cheap first pass, but it cannot carry this claim -- it is a denylist,
# so it only catches phrasings someone already thought of. Proven: a paraphrase of the exact
# comment it was written for ("This suite never exercises a 31-day month; that gap is
# intentional") passed it, as did a leak stated purely in domain language. The manifest fails on
# ANY edit, which is the only form that survives the next fixture change.
if [ "${1:-}" = "--update-manifest" ]; then
  {
    echo "# Content hashes of every CANDIDATE-VISIBLE fixture file."
    echo "# Regenerate with: bash tests/scripts/evals-fixtures.sh --update-manifest"
    echo "# An edit failing here is not a bug: re-read fixtures/README.md's invariant list, confirm"
    echo "# the change states no pass criterion, then regenerate. A keyword denylist cannot make"
    echo "# this promise -- it only catches phrasings someone already thought of."
    find "$F/task01-plan" "$F/task02-code" "$F/task03-review" -type f | LC_ALL=C sort | xargs sha256sum
  } > "$F/MANIFEST.sha256"
  echo "manifest regenerated: $(grep -c '^[0-9a-f]' "$F/MANIFEST.sha256") files"
  exit 0
fi

if [ -f "$F/MANIFEST.sha256" ]; then
  man_out=$(grep '^[0-9a-f]' "$F/MANIFEST.sha256" | sha256sum -c --quiet 2>&1)
  if [ -z "$man_out" ]; then
    ok "every candidate-visible file matches the content manifest"
  else
    bad "every candidate-visible file matches the content manifest"
    printf '%s\n' "$man_out" | sed 's/^/       /'
    printf '       (if the change is intended: bash tests/scripts/evals-fixtures.sh --update-manifest)\n'
  fi
  # The manifest must also cover the tree exactly -- a NEW file is invisible to sha256sum -c.
  man_n=$(grep -c '^[0-9a-f]' "$F/MANIFEST.sha256")
  live_n=$(find "$F/task01-plan" "$F/task02-code" "$F/task03-review" -type f | wc -l | tr -d ' ')
  check "manifest covers every candidate-visible file (no untracked additions)" "$live_n" "$man_n"
else
  bad "MANIFEST.sha256 exists"
fi

# Cheap first pass. Scans EVERY file under the fixture tree -- an earlier spelling used
# --include='*.mjs' --include='*.sql' --include='*.md', silently exempting package.json.
leak=$(grep -rniE 'point of the task|declared file set|no 31-day month|is the defect|exists to fix|pass criteri|the scorer|scoring|scored|mutant|control|criterion [0-9]|dimension S[0-9]|graded|open book|trim comparison|you are measured|do not invent' \
        "$F/task01-plan" "$F/task02-code" "$F/task03-review" 2>/dev/null)
if [ -z "$leak" ]; then
  ok "no candidate-visible file trips the leak keyword list"
else
  bad "no candidate-visible file trips the leak keyword list"
  printf '%s\n' "$leak" | sed 's/^/       /'
fi

# The reference implementations must not live inside the copied tree.
if find "$F/task02-code" -name '*mutant*' -o -name '*control*' | grep -q .; then
  bad "no reference implementation inside task02-code/ (it lands in the candidate's repo)"
else
  ok "no reference implementation inside task02-code/ (it lands in the candidate's repo)"
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

# --- B1, one layer down: the RECONSTRUCTED repo, not just the shipped tree ----------------
# Everything above checks what ships. B1 can reappear at reconstruction time: if SoMi's install
# step (or a future runner) drops a .gitignore containing `.somi` into $WORK before the baseline
# commit, `git add -A` silently skips the renamed plan tree and the candidate meets a work item
# with no phase file. Nothing in SoMi writes a .gitignore today — this asserts it stays that way.
R=$(mktemp -d)
trap 'rm -rf "$W" "$R"' EXIT
cp -r "$F/task02-code/." "$R"/
[ -d "$R/_somi" ] && mv "$R/_somi" "$R/.somi"
( cd "$R" && git init -q -b main && git config user.email t@somi.invalid && git config user.name t \
  && git add -A && git commit -qm baseline ) >/dev/null 2>&1
tracked=$( cd "$R" && git ls-files | grep -c '^\.somi/plans/expired-token/' )
check "reconstructed task02 tracks its plan tree in the baseline commit" "$tracked" "4"

# --- task01: the absence criterion 3 scores ----------------------------------------------
# `kb` was missing and row size is one of the three things criterion 3 forbids; spelled-out
# magnitudes ("half a billion") slipped because the alternation required an adjacent digit.
vol=$(grep -rniE '[0-9][0-9,._]*[[:space:]]*(rows|req|rps|qps|[kmgt]b|k\b|million|billion|thousand)|(rows|req)/(s|sec|second|min|hour|day|yr|year)|(half|quarter|couple)[[:space:]]+(a[[:space:]]+)?(million|billion|thousand)|(million|billion|thousand)[[:space:]]+(rows|records|requests|events)' \
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
  const b = await import('$ROOT/$F/task02-code-mutant.mjs');
  const c = await import('$ROOT/$F/task02-code-control.mjs');
  const k = (m) => Object.keys(m).sort().join(',');
  process.stdout.write(k(a) === k(b) && k(b) === k(c) ? 'ok' : k(a)+' | '+k(b)+' | '+k(c));
" 2>/dev/null )
check "mutant and control export the same surface as token.mjs" "$surf" "ok"

# The control exists so criterion 1(b) can attribute a red to the expiry axis. That only holds
# if the two differ on expiry and NOTHING else: a candidate test red against both is failing for
# a reason it pinned, not for the defect. Verified behaviourally, not by diffing source.
pair=$( node --input-type=module -e "
  const mut = await import('$ROOT/$F/task02-code-mutant.mjs');
  const ctl = await import('$ROOT/$F/task02-code-control.mjs');
  const past = Math.floor(Date.now()/1000) - 60, future = Math.floor(Date.now()/1000) + 3600;
  const acc = (m, e) => { try { m.verifyToken(m.mintToken('u', e)); return true; } catch { return false; } };
  // CROSS-verify. Checking each file against its own minted token proves nothing: both are
  // internally consistent under any shared change (a signature encoding, a payload layout), so
  // an edit that moves them apart on a non-expiry axis stays invisible. Crossing them is what
  // actually asserts \"identical except for expiry\".
  const cross = (a, b, e) => { try { return JSON.stringify(b.verifyToken(a.mintToken('u', e))); } catch (err) { return 'THREW:' + err.message; } };
  const expiryOnly = acc(mut,past) && !acc(ctl,past)          // they DO differ on expiry
    && acc(mut,future) && acc(ctl,future)
    && cross(mut, ctl, future) === cross(ctl, mut, future)    // ...and on nothing else
    && cross(mut, ctl, future) === cross(mut, mut, future)
    && cross(ctl, mut, future) === cross(ctl, ctl, future);
  process.stdout.write(expiryOnly ? 'ok' : 'mutant/control differ on more than expiry, or not on expiry');
" 2>/dev/null )
check "mutant accepts an expired token, control rejects it, agree otherwise" "$pair" "ok"

if node "$F/make-review-patch.mjs" --check >/dev/null 2>&1; then
  ok "committed patch matches its generator (--check)"
else
  bad "committed patch matches its generator (run: node $F/make-review-patch.mjs)"
fi

exp=$(grep -ncE '\bexp\b|expir' "$F/task02-code/tests/auth/token.test.mjs" 2>/dev/null | tr -d ' \n')
check "task02 suite has NO expiry coverage (the absence is the task)" "${exp:-0}" "0"

# Pass count alone is satisfied by a suite with a red test appended: `pass 3` stays true while
# `fail 1` goes unexamined -- and a red task02 baseline makes criterion 1(a) ("green first")
# unmeetable for every run.
t2p=$( cd "$F/task02-code" && node --test 2>&1 | grep -oE '^(#|ℹ) pass [0-9]+' | grep -oE '[0-9]+' | head -1 )
t2f=$( cd "$F/task02-code" && node --test 2>&1 | grep -oE '^(#|ℹ) fail [0-9]+' | grep -oE '[0-9]+' | head -1 )
check "task02 suite is exactly 3 passing / 0 failing" "${t2p:-?}/${t2f:-?}" "3/0"

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
