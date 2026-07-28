#!/usr/bin/env bash
# End-to-end tests for scripts/check-links.mjs.
#
# This work item has produced a fix-without-a-guard five separate times, so a new checker ships with
# its own regression suite. Fixtures are real `git init` repos, not bare directories, because the
# walker enumerates via `git ls-files` — and one case depends on `.gitignore` actually being
# honoured, which a bare directory cannot demonstrate.
#
# NEGATIVE cases are as load-bearing as positive ones here. The walker's pass-1 regex silently
# passed five dead-link forms, and every staged failure used the single form it was authored
# against — the same sample-selection defect iteration 3.1 was blocked on. The forms below are
# chosen to be ones a naive implementation gets WRONG.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/check-links.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
failures=0; total=0
expect_exit() { local name="$1" want="$2" got=0; shift 2; "$@" >/dev/null 2>&1 || got=$?
  [[ "$got" == "$want" ]] || { echo "FAIL: $name — expected exit $want, got $got" >&2; failures=$((failures+1)); }
  total=$((total+1)); }
check() { total=$((total+1)); [[ "$2" == "0" ]] || { echo "FAIL: $1" >&2; failures=$((failures+1)); }; }

mkrepo() { rm -rf "$TMP/r"; mkdir -p "$TMP/r/docs" "$TMP/r/examples" "$TMP/r/scripts"
  cp "$CHECK" "$TMP/r/scripts/check-links.mjs"
  printf '# t\n' > "$TMP/r/docs/real.md"
  (cd "$TMP/r" && git init -q -b main && git config user.email t@t && git config user.name t); }
commit() { (cd "$TMP/r" && git add -A && git commit -qm x); }
run() { (cd "$TMP/r" && node scripts/check-links.mjs); }

# --- baseline -------------------------------------------------------------------
mkrepo; printf '[ok](./real.md)\n' > "$TMP/r/docs/a.md"; commit
expect_exit "resolving relative link passes" 0 run
printf '[dead](./nope.md)\n' >> "$TMP/r/docs/a.md"; commit
expect_exit "dead relative link fails" 1 run

# --- FENCED AND INLINE CODE ARE NOT LINKS ---------------------------------------
# The pass-1 walker had no fence awareness. Four fenced sample links in
# examples/feature-plan-example.md read as real, and "fixing" them wrote a CI token into the
# canonical example that ships to npm. This is the case that must never regress.
mkrepo
printf '# t\n\n```markdown\n[sample](./does-not-exist.md)\n```\n\nInline: `[x](./nope.md)`\n' > "$TMP/r/docs/a.md"
commit
expect_exit "links inside a fenced block are not checked" 0 run
printf '\n~~~md\n[t](./nope2.md)\n~~~\n' >> "$TMP/r/docs/a.md"; commit
expect_exit "tilde fences are honoured too" 0 run
printf '\n[after](./nope4.md)\n' >> "$TMP/r/docs/a.md"; commit
expect_exit "a dead link AFTER a fence is still caught" 1 run

# --- FENCE FORMS THE PASS-2 REWRITE MISSED ---------------------------------------
# Both reproduce the Blocker's outcome (displayed source flagged as a real link), and both shipped
# unguarded until code review measured them.
# (1) A fence indented 4+ spaces is legal inside a list item.
mkrepo
printf '# t\n\n1. Step:\n\n    ```markdown\n    [sample](./nope-listfence.md)\n    ```\n' > "$TMP/r/docs/a.md"
commit
expect_exit "a list-indented fence (4+ spaces) is honoured" 0 run
# (2) CommonMark requires the closer be at least as long as the opener, so a ``` inside a ````
# block does not close it.
mkrepo
printf '# t\n\n````markdown\n```\n[inner](./nope-quad.md)\n```\n````\n' > "$TMP/r/docs/a.md"
commit
expect_exit "a shorter fence run does not close a longer one" 0 run

# --- FORMS THE PASS-1 REGEX SILENTLY PASSED -------------------------------------
mkrepo; printf '# t\n\nRef: [text][r]\n\n[r]: ./nope-ref.md\n' > "$TMP/r/docs/a.md"; commit
expect_exit "reference-style link with a dead target is caught" 1 run
mkrepo; printf '# t\n\n[link text that\nwraps](./nope-wrap.md)\n' > "$TMP/r/docs/a.md"; commit
expect_exit "line-wrapped link text is caught" 1 run
mkrepo; printf '# t\n\n[t](<./nope-angle.md>)\n' > "$TMP/r/docs/a.md"; commit
expect_exit "angle-bracket destination is caught" 1 run
mkrepo; printf '# t\n\nRef: [text][r]\n\n```\n[r]: ./real.md\n```\n' > "$TMP/r/docs/a.md"; commit
expect_exit "a reference definition inside a fence is not honoured" 0 run

# --- illustrative-path hatch: scoped, and self-invalidating ---------------------
mkrepo; printf '# t\n<!-- illustrative-path -->[dead](./nope.md)\n' > "$TMP/r/examples/e.md"; commit
expect_exit "same-line marker exempts, inside examples/" 0 run
check "the exemption is reported on success" \
  "$( (cd "$TMP/r" && node scripts/check-links.mjs) | grep -q '1 illustrative-path exemption'; echo $?)"
# The success line is F5's whole remedy — the number that makes hatch growth visible. An earlier
# form incremented `checked` before the resolving branch, so it reported exempted (non-resolving)
# links as resolving: "2 relative link(s) resolve" when zero did. A false claim in the output of
# the tool this work item built to remove false claims.
check "an exempted link is NOT counted as resolving" \
  "$( (cd "$TMP/r" && node scripts/check-links.mjs) | grep -q '^check-links: 0 relative link(s) resolve; 1 illustrative-path exemption'; echo $?)"
mkrepo; printf '# t\n<!-- illustrative-path -->[dead](./nope.md)\n' > "$TMP/r/docs/a.md"; commit
expect_exit "a marker OUTSIDE examples/ fails rather than exempts" 1 run
mkrepo; printf '# t\n<!-- illustrative-path -->\n[dead](./nope.md)\n' > "$TMP/r/examples/e.md"; commit
expect_exit "preceding-line marker does NOT exempt (pinned placement)" 1 run
mkrepo; printf '# t\n<!-- illustrative-path -->[ok](../docs/real.md)\n' > "$TMP/r/examples/e.md"; commit
expect_exit "marker on a RESOLVING link fails as stale" 1 run

# --- exclusions and skipped link kinds ------------------------------------------
mkrepo
printf '.somi/\n' > "$TMP/r/.gitignore"       # mirrors this repo: .somi is gitignored, so untracked
mkdir -p "$TMP/r/.somi"; printf '[x](./nope.md)\n' > "$TMP/r/.somi/plan.md"
printf '[x](./nope.md)\n' > "$TMP/r/CHANGELOG.md"
printf '[a](https://e.com/x.md)\n[b](#frag)\n[c](./real.md#frag)\n[d](mailto:a@b.c)\n[e](HTTPS://e.com/y.md)\n' > "$TMP/r/docs/a.md"
commit
expect_exit "gitignored .somi/ and CHANGELOG.md skipped; external/anchor/mailto ignored" 0 run
printf '[f](./nope.md#frag)\n' >> "$TMP/r/docs/a.md"; commit
expect_exit "a fragment on a DEAD target is still caught" 1 run

echo "check-links tests: $((total - failures)) of $total checks passed."
[[ "$failures" -eq 0 ]] || exit 1
