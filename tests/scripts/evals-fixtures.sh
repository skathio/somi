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

# Pre-declared and trapped once, so a temp dir created after the trap is still cleaned up
# on an early exit. Previously $R leaked on one path and $RB was never trapped at all.
W=""; R=""; RB=""
trap 'rm -rf "$W" "$R" "$RB"' EXIT

echo "== eval fixtures =="

# --- B1: every fixture file must actually ship -------------------------------------------
# Two wrong spellings preceded this one. `git add -An` lists only UNTRACKED files, so it matched
# the on-disk count exactly once -- before this work was committed -- and returned 0 forever after.
# Then plain `git check-ignore`, which consults the INDEX and reports nothing for a tracked file:
# every fixture file is tracked, so it could not fire on any of them. Measured: a rule matching
# task02's plan tree gave `default: 0 reported, --no-index: 4 reported` while npm pack dropped all
# four. `--no-index` asks the question the assertion's name claims to ask.
# Floor first: every "no bad files found" assertion below passes vacuously against an empty
# tree, so establish that the tree is actually populated before trusting any of them.
n_files=$(find "$F" -type f | wc -l | tr -d ' ')
if [ "$n_files" -ge 24 ]; then
  ok "fixture tree is populated ($n_files files)"
else
  bad "fixture tree is populated (want >=24, got $n_files)"
fi

ignored=$(find "$F" -type f -print0 | xargs -0 git check-ignore --no-index 2>/dev/null)
if [ -z "$ignored" ]; then
  ok "no fixture file is gitignored"
else
  bad "no fixture file is gitignored"
  printf '%s\n' "$ignored" | sed 's/^/       /'
fi

if git check-ignore -q --no-index "$F" 2>/dev/null; then
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

# Scorer-side files that belong in the manifest even though they sit outside the three fixture
# directories. Declared ONCE: the generator, the count assertion, and the presence loop all read
# this array, so adding a file here cannot leave the arithmetic 40 lines away out of step.
EXTRA_MANIFEST=("$F/task03-review.patch" "$F/make-review-patch.mjs")
SCORER_SIDE=(README.md MANIFEST.sha256 make-review-patch.mjs task03-review.patch \
             task02-code-mutant.mjs task02-code-control.mjs)

# --- D1: the scorer-side files exist. None is imported by anything here, so deletion is silent,
# and fixtures/README.md is the reconstruction contract 3.4b is built from.
# _candidates/ holds hand-written /code outputs used by tests/scripts/eval-runner.sh. Scorer-side:
# never copied into a candidate's repo, never in the candidate manifest.
[ -d "$F/_candidates" ] \
  && ok "scorer-side candidates present (_candidates/)" \
  || bad "scorer-side candidates present (_candidates/)"
for f in "${SCORER_SIDE[@]}"; do
  [ -f "$F/$f" ] && ok "scorer-side file present: $f" || bad "scorer-side file present: $f"
done

# --- B2: the fixture must not state its own pass criteria --------------------------------
# A content-hash manifest over every candidate-visible file. It fails on ANY edit -- addition,
# modification, deletion -- which a keyword denylist cannot do: the grep below only catches
# phrasings someone already thought of (proven: a paraphrase of the exact comment it was written
# for passed it, as did a leak in plain domain language).
#
# BE CLEAR ABOUT WHAT THIS IS. It is a tripwire, not a gate. It cannot judge whether an edit
# leaks a criterion -- it forces a human to. Once cleared via --update-manifest, the only
# remaining semantic defences are the same denylists it was adopted to supplement. Two things
# limit the damage: --update-manifest REFUSES to regenerate while any other assertion is failing
# (so it cannot be used to paper over a detectable leak), and the failure message leads with the
# invariant checklist rather than the regenerate command.
if [ "${1:-}" = "--update-manifest" ]; then
  # Refuse while anything else is red. --update-manifest exists to record a reviewed change, not
  # to clear a failing guard; without this it is a one-command bypass of every check below it.
  PRE=$(mktemp) || { echo "mktemp failed" >&2; exit 1; }
  if ! bash "$ROOT/tests/scripts/evals-fixtures.sh" --no-manifest >"$PRE" 2>&1; then
    echo "refusing to regenerate: other assertions are failing. Fix them first." >&2
    grep -E '^  FAIL' "$PRE" >&2 || true
    rm -f "$PRE"
    exit 1
  fi
  rm -f "$PRE"
  {
    echo "# Content hashes of every CANDIDATE-VISIBLE fixture file."
    echo "# Regenerate with: bash tests/scripts/evals-fixtures.sh --update-manifest"
    echo "# An edit failing here is not a bug: re-read fixtures/README.md's invariant list, confirm"
    echo "# the change states no pass criterion, then regenerate. A keyword denylist cannot make"
    echo "# this promise -- it only catches phrasings someone already thought of."
    { find "$F/task01-plan" "$F/task02-code" "$F/task03-review" -type f
      printf '%s\n' "${EXTRA_MANIFEST[@]}"; } \
      | LC_ALL=C sort | xargs sha256sum
  } > "$F/MANIFEST.sha256"
  echo "manifest regenerated: $(grep -c '^[0-9a-f]' "$F/MANIFEST.sha256") files"
  exit 0
fi

if [ "${1:-}" = "--no-manifest" ]; then
  : # the manifest check is skipped; every other assertion still runs
elif [ -f "$F/MANIFEST.sha256" ]; then
  man_out=$(grep '^[0-9a-f]' "$F/MANIFEST.sha256" | sha256sum -c --quiet 2>&1)
  if [ -z "$man_out" ]; then
    ok "every candidate-visible file matches the content manifest"
  else
    bad "every candidate-visible file matches the content manifest"
    printf '%s\n' "$man_out" | sed 's/^/       /'
    printf '\n       A candidate-visible file changed. The manifest cannot judge whether the change\n'
    printf '       leaks a pass criterion -- only a human can. Confirm ALL of these first:\n'
    printf '         [ ] states no pass criterion, and hints at none (fixtures/README.md invariants)\n'
    printf '         [ ] task01 supplies no traffic, volume, or row-size figure\n'
    printf '         [ ] task02 keeps 3 passing tests, none touching expiry\n'
    printf '         [ ] task03 exercises only 30-day months\n'
    printf '         [ ] no file names a mutant, a control, scoring, or an eval\n'
    printf '       Only then:  bash tests/scripts/evals-fixtures.sh --update-manifest\n'
  fi
  # The manifest must also cover the tree exactly -- a NEW file is invisible to sha256sum -c.
  man_n=$(grep -c '^[0-9a-f]' "$F/MANIFEST.sha256")
  live_n=$(( $(find "$F/task01-plan" "$F/task02-code" "$F/task03-review" -type f | wc -l) + ${#EXTRA_MANIFEST[@]} ))
  # Argument order matters here: the MANIFEST is the stale value when these disagree, so it goes
  # in the "got" slot. The previous order framed the live tree as wrong.
  if [ "$man_n" = "$live_n" ]; then
    ok "manifest covers every candidate-visible file (no untracked additions)"
  else
    bad "manifest covers every candidate-visible file (want $live_n live files, manifest has $man_n) — run: bash tests/scripts/evals-fixtures.sh --update-manifest"
  fi
else
  bad "MANIFEST.sha256 exists"
fi

# Cheap first pass. Scans EVERY file under the fixture tree -- an earlier spelling used
# --include='*.mjs' --include='*.sql' --include='*.md', silently exempting package.json.
leak=$(grep -rniE 'point of the task|declared file set|no 31-day month|is the defect|exists to fix|pass criteri|the scorer|scoring|scored|mutant|token-control|code-control|criterion [0-9]|dimension S[0-9]|graded|open book|trim comparison|you are measured|do not invent' \
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

W=$(mktemp -d) || { bad "mktemp -d failed"; exit 1; }
: "${W:?mktemp -d returned empty}"
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

# task03's candidate reviews the PATCHED tree, so that is the tree the leak check must scan. A
# comment injected via make-review-patch.mjs lands in proration.mjs as candidate-visible source
# and is invisible to a scan of the shipped directory.
leak3=$(grep -rniE 'point of the task|no 31-day month|is the defect|exists to fix|pass criteri|the scorer|scoring|scored|mutant|criterion [0-9]|dimension S[0-9]|graded|no test covers|under-credits|silently (under|over)' "$W" 2>/dev/null)
if [ -z "$leak3" ]; then
  ok "post-patch task03 tree states no pass criterion"
else
  bad "post-patch task03 tree states no pass criterion"
  printf '%s\n' "$leak3" | sed 's/^/       /'
fi

# Directly: every date the suite exercises must fall in a 30-day month. The greenness pair above
# covers this only as a side effect; asserted here so the failure names the actual invariant.
months=$( cd "$F/task03-review" && node --input-type=module -e "
  import { register } from 'node:module';
  // Stub prorate() and record every changeDate the suite passes it. Assertions inside the tests
  // will fail against the stub -- irrelevant: we are collecting call arguments, not running them.
  const seen = [];
  globalThis.__seen = seen;
  const real = await import('./src/billing/proration.mjs');
  const mod = await import('node:test');
  const tests = [];
  const t = (name, fn) => tests.push(fn);
  const src = (await import('node:fs')).readFileSync('tests/proration.test.mjs','utf8');
  const body = src
    .replace(/^import .*$/gm, '')
    .replace(/\\btest\\(/g, '__t(');
  let fn;
  try { fn = new Function('__t','assert','prorate', body); }
  catch (e) { process.stdout.write('cannot parse proration.test.mjs: ' + e.message); process.exit(0); }
  // Invoke any function-valued argument. A bare no-op Proxy never runs the callbacks passed to
  // assert.throws / assert.doesNotThrow / assert.rejects, so a 31-day date written inside one was
  // invisible here while node --test executed it -- the same measured-the-wrong-thing shape as
  // the Date.UTC syntax count this check replaced.
  const assert = new Proxy({}, { get: () => (...a) => { for (const x of a) if (typeof x === 'function') { try { x(); } catch {} } } });
  fn(t, assert, (o,n,d) => { seen.push(d); return { credit:0, charge:0, net:0, display:'' }; });
  for (const f of tests) { try { f(); } catch {} }
  if (seen.length < 3) { process.stdout.write('only ' + seen.length + ' prorate() calls observed'); process.exit(0); }
  const bad = seen
    .filter(d => !(d instanceof Date) || new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate() !== 30)
    .map(d => (d instanceof Date ? d.toISOString().slice(0,10) : String(d)));
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
R=$(mktemp -d) || { bad "mktemp -d failed"; exit 1; }
: "${R:?mktemp -d returned empty}"
cp -r "$F/task02-code/." "$R"/
[ -d "$R/_somi" ] && mv "$R/_somi" "$R/.somi"
( cd "$R" && git init -q -b main && git config user.email t@somi.invalid && git config user.name t \
  && git add -A && git commit -qm baseline ) >/dev/null 2>&1
tracked=$( cd "$R" && git ls-files | grep -c '^\.somi/plans/expired-token/' )
check "reconstructed task02 tracks its plan tree in the baseline commit" "$tracked" "4"

# --- class 3, one layer down: run.mjs's copy SOURCE, not just the shipped tree's placement -----
# The reference-implementation and review.patch checks above guard class 3 (a fixture-readable
# file stating an invariant it shouldn't see) at the file-PLACEMENT level. This file's own
# "Invariants worth not breaking" section has a second exposure: it lives one level above the
# copied tree and reaches $WORK only if the LIVE copy step (tests/evals/run.mjs, not the shell
# contract above) is ever broadened from the resolved per-task directory to the fixtures root --
# the same shape as the $WORK-must-be-outside-the-checkout leak fixtures/README.md:47-51 already
# names ("the bug and the leak were the same character").
# Nothing above inspects run.mjs. This narrows that gap with two greps -- existential facts about
# the source text, not a parse of it -- plus a pinned occurrence count. Two greps alone would pass
# an ADDED, broader copy sitting right next to an untouched anchor line (both greps still match),
# which is the silent case: the per-task copy still lands correctly, the run behaves normally, and
# the candidate additionally gets the fixtures root -- including this section's own trap table --
# at a path the leak keyword denylist above never scans. run.mjs has exactly four `cpSync(`
# occurrences today; pinning the occurrence count (not a line count -- `grep -c` would miss a
# second occurrence appended to an already-matching line) turns an added `cpSync(` call red,
# same line or a new one, without needing an AST. This is a tripwire on a known substring, not a
# closed enumeration over copy operations -- a call reached via `copyFileSync`, `execFileSync('cp',
# ...)`, or an alias would not move this count.
# NOT covered: a change to what the `fixtureDir` argument resolves to BEFORE it reaches this
# function (run.mjs's CLI driver, ~line 820, calls `fixtureFor(id, source.dir)` once) -- the count
# below stays 4 either way. That variant nests every task file one level deep and never renames
# `_somi` to `.somi`. The fixtures root still leaks into $WORK either way (the copy call itself is
# untouched); what's inferred, not confirmed, is that the accompanying tree-shape mismatch breaks
# the run visibly enough downstream that a corrupted measurement would be noticed rather than
# scored (not confirmed by an actual live run: that needs a model invocation, out of reach for
# this hermetic script) -- so it is a named, accepted residual, not a second assertion.
n_cp=$(grep -o 'cpSync(' tests/evals/run.mjs | wc -l | tr -d ' ')
check "run.mjs's cpSync( occurrence count is unchanged (4)" "$n_cp" "4"
if grep -qF 'cpSync(fixtureDir, work' tests/evals/run.mjs \
   && grep -qF 'startsWith(`task${id}-`)' tests/evals/run.mjs; then
  ok "run.mjs's live reconstruction copies the resolved per-task dir, not the fixtures root"
else
  bad "run.mjs's live reconstruction copies the resolved per-task dir, not the fixtures root"
fi

# --- task01: the absence criterion 3 scores ----------------------------------------------
# `kb` was missing and row size is one of the three things criterion 3 forbids; spelled-out
# magnitudes ("half a billion") slipped because the alternation required an adjacent digit.
vol=$(grep -rniE '[0-9][0-9,._]*[[:space:]]*(rows|req|rps|qps|[kmgt]i?b|[kmgtKMGT]\b|million|billion|thousand)|(rows|req)/(s|sec|second|min|hour|day|yr|year)|(hundreds|tens|dozens|scores|half|quarter|couple)[[:space:]]+(of[[:space:]]+)?(a[[:space:]]+)?(million|billion|thousand|gigabyte|terabyte|megabyte)s?|(million|billion|thousand|gigabyte|terabyte)s?([[:space:]]+of)?[[:space:]]+(rows|records|requests|events)|[0-9]+e[0-9]+[[:space:]]*(rows|records|requests|events)' \
      "$F/task01-plan" 2>/dev/null)
if [ -z "$vol" ]; then
  ok "task01 trips no known volume-figure phrasing (denylist, not a proof)"
else
  bad "task01 trips no known volume-figure phrasing (denylist, not a proof)"
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
# "Byte-identical except the expiry comparison" is a claim about SOURCE. Assert it there: strip
# each file's header block, remove the expiry guard from the control, and require what remains to
# match the mutant exactly. The behavioural cross-check below is the second layer -- on its own it
# only ever minted well-formed tokens, so a one-line divergence in the malformed-token message
# passed at 29/29 and then let a candidate whose only new test asserted `verifyToken(null)` throws
# score green/green/attributably-red with zero expiry logic.
# "Byte-identical except the expiry comparison" is a claim about SOURCE, so assert it there --
# the behavioural cross-check below only ever exercised inputs someone thought to probe. COMMENTS
# are excluded deliberately: the two files explain different things and should say so. Code is
# what must match, and an earlier version normalised one JSDoc line by regex, which is exactly the
# kind of "the check has a special case" seam that hides a real divergence.
ident=$( node "$ROOT/tests/scripts/lib/reference-pair.mjs" \
           "$F/task02-code-mutant.mjs" "$F/task02-code-control.mjs" 2>/dev/null )
check "control is the mutant plus EXACTLY the expiry block (source-identical)" "$ident" "ok"

pair=$( node --input-type=module -e "
  const mut = await import('$ROOT/$F/task02-code-mutant.mjs');
  const ctl = await import('$ROOT/$F/task02-code-control.mjs');
  const past = Math.floor(Date.now()/1000) - 60, future = Math.floor(Date.now()/1000) + 3600;
  const acc = (m, e) => { try { m.verifyToken(m.mintToken('u', e)); return true; } catch { return false; } };
  // Probe the ERROR paths too, not just well-formed tokens. Both files must agree exactly on
  // every input that is not an expiry question.
  const good = mut.mintToken('u', future);
  const shapes = [null, undefined, '', 'no-dot', 'a.b', good + 'x', good.split('.')[0] + '.', 42, {},
                  Buffer.from('{}','utf8').toString('base64url') + '.' + 'sig'];
  const out = (m, t) => { try { return 'OK:' + JSON.stringify(m.verifyToken(t)); } catch (e) { return 'ERR:' + e.message; } };
  const errAgree = shapes.every((t) => out(mut, t) === out(ctl, t));
  const cross = (a, b, e) => out(b, a.mintToken('u', e));
  const expiryOnly = acc(mut,past) && !acc(ctl,past)
    && acc(mut,future) && acc(ctl,future)
    && cross(mut, ctl, future) === cross(ctl, mut, future)
    && cross(mut, ctl, future) === cross(mut, mut, future);
  process.stdout.write(!errAgree ? 'they disagree on a non-expiry input shape'
    : expiryOnly ? 'ok' : 'differ on more than expiry, or not on expiry');
" 2>/dev/null )
check "mutant accepts an expired token, control rejects it, agree otherwise" "$pair" "ok"

if node "$F/make-review-patch.mjs" --check >/dev/null 2>&1; then
  ok "committed patch matches its generator (--check)"
else
  bad "committed patch matches its generator (run: node $F/make-review-patch.mjs)"
fi

# THE DEFECT MUST STILL BE THERE. Every other task02 assertion guards the *conditions* around
# the bug -- no expiry coverage, mutant parity, reference greenness -- and none guards the bug.
# Adding the four-line expiry check to token.mjs and clearing the manifest through the sanctioned
# --update-manifest path scored 38/38 green: a task with nothing to fix, whose candidate still
# writes a test that is green on the control and red on the mutant, so S5 flatlines at pass in
# BOTH arms and reports no regression. task03's symmetric assertion existed from the start.
defect2=$( node --input-type=module -e "
  const t = await import('$ROOT/$F/task02-code/src/auth/token.mjs');
  const expired = t.mintToken('u', Math.floor(Date.now()/1000) - 60);
  let accepted = false;
  try { t.verifyToken(expired); accepted = true; } catch {}
  process.stdout.write(accepted ? 'ok' : 'token.mjs already REJECTS expired tokens - task02 has no defect left to find');
" 2>/dev/null )
check "shipped token.mjs accepts an expired token (the defect IS the task)" "$defect2" "ok"

# task01's trap is the ADR's filename-vs-content tension: the filename says no-new-datastores,
# the content only requires a migration path. If the content ever grows an actual prohibition,
# criterion 4's "citing it as 'we don't add datastores' fails" becomes a false fail.
adr="$F/task01-plan/docs/adr/0004-no-new-datastores.md"
# Scoped to the Decision BODY. The title legitimately reads "No new datastores without a migration
# path" -- that filename-vs-title-vs-content tension is the whole trap, so searching the whole file
# for a prohibition matches the trap itself and fails a correct fixture.
# Scoped to the Decision AND Consequences bodies. The title legitimately reads "No new datastores
# without a migration path" -- that filename-vs-title-vs-content tension is the whole trap.
#
# Asserted POSITIVELY. A denylist of prohibition phrasings let through "we don't add datastores",
# "New datastores are prohibited", and "Never introduce a new datastore" -- the first being the
# exact wrong answer criterion 4 fails a candidate for citing. Requiring the conditional-permission
# construct and forbidding any modal-negative is a claim the pattern can actually make.
adr_ok=$( node "$ROOT/tests/scripts/lib/adr-shape.mjs" "$adr" 2>/dev/null )
check "task01 ADR grants conditional permission and prohibits nothing (the trap)" "$adr_ok" "yes"

exp=$(grep -ncE '\bexp\b|expir' "$F/task02-code/tests/auth/token.test.mjs" 2>/dev/null | tr -d ' \n')
check "task02 suite has NO expiry coverage (the absence is the task)" "${exp:-0}" "0"

# Pass count alone is satisfied by a suite with a red test appended: `pass 3` stays true while
# `fail 1` goes unexamined -- and a red task02 baseline makes criterion 1(a) ("green first")
# unmeetable for every run.
t2p=$( cd "$F/task02-code" && node --test 2>&1 | grep -oE '^(#|ℹ) pass [0-9]+' | grep -oE '[0-9]+' | head -1 )
t2f=$( cd "$F/task02-code" && node --test 2>&1 | grep -oE '^(#|ℹ) fail [0-9]+' | grep -oE '[0-9]+' | head -1 )
check "task02 suite is exactly 3 passing / 0 failing" "${t2p:-?}/${t2f:-?}" "3/0"

# Criterion 1(b) says "whole suite green on the control" and skips identifying which tests are
# new. That is only sound while every BASELINE test is green against both references -- true
# because they differ only in expiry and no baseline test touches expiry. Pin the premise.
refs_ok=ok
for r in task02-code-control task02-code-mutant; do
  RB=$(mktemp -d) || { bad "mktemp -d failed"; exit 1; }; : "${RB:?empty}"; cp -r "$F/task02-code/." "$RB"/; cp "$F/$r.mjs" "$RB/src/auth/token.mjs"
  got=$( cd "$RB" && node --test 2>&1 | grep -oE '^(#|ℹ) (pass|fail) [0-9]+' | grep -oE '[0-9]+' | tr '\n' '/' )
  [ "$got" = "3/0/" ] || refs_ok="$r -> $got"
  rm -rf "$RB"
done
check "baseline suite is green against BOTH references (1(b)'s premise)" "$refs_ok" "ok"

# --- routed from 4.1's first live runs ---------------------------------------------------------
# task01's endpoint must AUTHENTICATE the caller. The problem statement asks to record "who sent
# it"; when tenantId came straight from the request body that was unanswerable, so the request
# rested on a false premise -- and commands/plan.md §1a makes the premise check "not optional".
# All 3 of 3 live runs correctly blocked on the auth gap instead of answering the storage
# question, and the task failed them for complying: S2 0/3, S1 0/3, S6 0/3.
#
# The general property -- a fixture must not contain a defect more urgent than the one it measures
# -- is not mechanically checkable. This asserts the specific regression, which is.
if grep -q 'tenantForKey' "$F/task01-plan/src/ingest/handler.mjs" \
   && ! grep -qE 'const \{ *tenantId' "$F/task01-plan/src/ingest/handler.mjs"; then
  ok "task01's endpoint authenticates the caller (the premise the task rests on)"
else
  bad "task01's endpoint authenticates the caller -- tenantId must not come from the request body"
fi

# --- routed from 3.3b pass 5: the contract must be asserted, not just written down --------------
# R4 in task02's spec states the clock shape the candidate may inject. Three passes running, the
# references were "fixed" by adding whichever convention the last review found unsupported --
# epoch-seconds, then an options object, then a clock function. That does not converge, and it
# judged candidates against a rule they were never given. R4 is now the contract; this asserts the
# references honour exactly it.
clock=$( node --input-type=module -e "
  const ctl = await import('$ROOT/$F/task02-code-control.mjs');
  const mut = await import('$ROOT/$F/task02-code-mutant.mjs');
  const T = 1700000000;
  const throws = (m, e, now) => { try { m.verifyToken(m.mintToken('u', e), now); return false; } catch { return true; } };
  const bad = [];
  // R4: second positional parameter, epoch MILLISECONDS.
  if (!throws(ctl, T - 1, T * 1000)) bad.push('control accepts an expired token under an injected ms clock');
  if (throws(ctl, T + 3600, T * 1000)) bad.push('control rejects a VALID token under an injected ms clock');
  // Default parameter: a candidate reading the wall clock directly passes no argument.
  if (!throws(ctl, Math.floor(Date.now()/1000) - 60, undefined)) bad.push('control accepts an expired token with no clock passed');
  if (throws(ctl, Math.floor(Date.now()/1000) + 3600, undefined)) bad.push('control rejects a valid token with no clock passed');
  // The mutant must ignore the clock in every one of those positions -- that IS the mutation.
  if (throws(mut, T - 1, T * 1000) || throws(mut, Math.floor(Date.now()/1000) - 60, undefined)) bad.push('mutant enforces expiry');
  process.stdout.write(bad.length ? bad.join('; ') : 'ok');
" 2>/dev/null )
check "references honour R4's clock contract exactly (ms positional, or none)" "$clock" "ok"

# R4 must actually be stated where the candidate reads it, or the assertion above is scoring a
# rule nobody was given -- which is the failure it was added to end.
if grep -q 'epoch' "$F/task02-code/_somi/plans/expired-token/spec.md"; then
  ok "task02 spec states the clock contract to the candidate (R4)"
else
  bad "task02 spec states the clock contract to the candidate (R4)"
fi

# Task specs have been renumbered once and are cross-referenced from three documents. A
# `criterion N` pointing at a criterion that no longer means that is a scorer reading the wrong
# dimension -- task01's Scenario did exactly this after the pass-3 split.
xref=$( node -e "
  const fs = require('fs'), path = require('path');
  const dir = '$ROOT/tests/evals/tasks';
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(n => /^\\d+-.*\\.md\$/.test(n))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const n = (t.match(/^[0-9]+\\. \\*\\*S[1-7]/gm) || []).length;
    for (const m of t.matchAll(/criterion ([0-9]+)/gi)) {
      if (Number(m[1]) > n || Number(m[1]) < 1) bad.push(f + ' cites criterion ' + m[1] + ' but has ' + n);
    }
  }
  process.stdout.write(bad.length ? bad.join('; ') : 'ok');
" 2>/dev/null )
check "every task spec's 'criterion N' cross-reference resolves" "$xref" "ok"

# --- the shell-quoting class, closed structurally ----------------------------------------------
embed=$( node "$ROOT/tests/scripts/lib/shell-embedded-js.mjs" \
  "$ROOT/tests/scripts/evals-fixtures.sh" "$ROOT/tests/scripts/eval-runner.sh" \
  "$ROOT/tests/scripts/evals-packaging.sh" 2>/dev/null )
if [ "$embed" = "ok" ]; then
  ok "no node -e block contains a backtick or unescaped double quote"
else
  bad "no node -e block contains a backtick or unescaped double quote"
  printf '%s\n' "$embed" | sed 's/^/       /'
fi

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
