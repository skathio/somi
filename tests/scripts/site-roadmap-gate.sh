#!/usr/bin/env bash
# Unit guard for tests/scripts/lib/site-roadmap-gate.mjs (the overview page's roadmap must cover every
# CHANGELOG release). Proved both ways against synthetic repos -- green on a consistent pair, red on
# each mismatch a release can produce -- rather than trusted because the real tree passes today.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$ROOT/tests/scripts/lib/site-roadmap-gate.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

echo "== site roadmap gate =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# mkrepo <dir> <changelog versions...> -- writes a CHANGELOG with one dated heading per version,
# newest first, plus an [Unreleased] heading the gate must skip.
mkrepo() {
  local dir="$1"; shift
  mkdir -p "$dir/site/src/content"
  { echo '# Changelog'; echo; echo '## [Unreleased]'; echo
    for v in "$@"; do echo "## [$v] — 2026-01-01 — release $v"; echo; done; } > "$dir/CHANGELOG.md"
}
roadmap() { printf '%s\n' "$2" > "$1/site/src/content/roadmap.json"; }

# expect <name> <want-exit> <dir> [stderr-substring]
expect() {
  local name="$1" want="$2" dir="$3" needle="${4:-}" out rc
  out="$(node "$GATE" "$dir" 2>&1)"; rc=$?
  if [ "$rc" -ne "$want" ]; then bad "$name -- expected exit $want, got $rc ($out)"; return; fi
  if [ -n "$needle" ] && [[ "$out" != *"$needle"* ]]; then bad "$name -- output lacks '$needle' ($out)"; return; fi
  ok "$name"
}

GOOD='{"eras":[{"label":"a","entries":[{"version":"1.0.0","covers":["1.0.0","1.0.1"]},{"version":"1.1.0","covers":["1.1.0"]}]}]}'

R="$TMP/green"; mkrepo "$R" 1.1.0 1.0.1 1.0.0; roadmap "$R" "$GOOD"
expect "a roadmap covering every release passes" 0 "$R" "covers all 3 releases"

R="$TMP/new-release"; mkrepo "$R" 1.2.0 1.1.0 1.0.1 1.0.0; roadmap "$R" "$GOOD"
expect "a new CHANGELOG release missing from the roadmap fails" 1 "$R" "release 1.2.0 is missing"
expect "  ...and the roadmap no longer ends at the latest release" 1 "$R" "not the latest release 1.2.0"

R="$TMP/twice"; mkrepo "$R" 1.1.0 1.0.1 1.0.0
roadmap "$R" '{"eras":[{"entries":[{"version":"1.0.0","covers":["1.0.0","1.0.1"]},{"version":"1.1.0","covers":["1.1.0","1.0.1"]}]}]}'
expect "a release covered by two entries fails" 1 "$R" "1.0.1 is covered twice"

R="$TMP/unknown"; mkrepo "$R" 1.1.0 1.0.1 1.0.0
roadmap "$R" '{"eras":[{"entries":[{"version":"1.0.0","covers":["1.0.0","1.0.1","0.9.0"]},{"version":"1.1.0","covers":["1.1.0"]}]}]}'
expect "a roadmap version the CHANGELOG lacks fails" 1 "$R" "0.9.0 is on the roadmap but not a release"

R="$TMP/own"; mkrepo "$R" 1.1.0 1.0.1 1.0.0
roadmap "$R" '{"eras":[{"entries":[{"version":"1.0.0","covers":["1.0.1"]},{"version":"1.1.0","covers":["1.1.0"]}]}]}'
expect "an entry whose covers omits its own version fails" 1 "$R" "does not list its own version"

R="$TMP/order"; mkrepo "$R" 1.1.0 1.0.1 1.0.0
roadmap "$R" '{"eras":[{"entries":[{"version":"1.1.0","covers":["1.1.0"]},{"version":"1.0.0","covers":["1.0.0","1.0.1"]}]}]}'
expect "a roadmap that does not end at the latest release fails" 1 "$R" "ends at 1.0.0"

R="$TMP/malformed"; mkrepo "$R" 1.0.0; roadmap "$R" '{"eras": [ broken'
expect "an unreadable roadmap exits 2" 2 "$R" "cannot read site/src/content/roadmap.json"

R="$TMP/no-eras"; mkrepo "$R" 1.0.0; roadmap "$R" '{"intro":"x"}'
expect "a roadmap without eras exits 2" 2 "$R" 'no "eras" list'

R="$TMP/no-releases"; mkdir -p "$R/site/src/content"; printf '# Changelog\n\n## [Unreleased]\n' > "$R/CHANGELOG.md"; roadmap "$R" "$GOOD"
expect "a CHANGELOG without dated releases exits 2" 2 "$R" "no release headings"

# site/ is not in the npm package (package.json `files`), so the real-tree case runs only in a checkout.
if [ -d "$ROOT/site" ]; then expect "the real tree passes" 0 "$ROOT"; else echo "  (skipped: site/ not packaged)"; fi

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
