#!/usr/bin/env bash
# End-to-end tests for scripts/generate-digest.mjs.
#
# The digest lives in three files and drifted once already — the Copilot copy was missing a whole
# bullet and nothing could see it. The generator exists to make that unrepresentable, so it needs a
# regression guard of its own; manual mutation testing evaporates at the end of a session.
#
# Runs the real script against a throwaway repo whose layout mirrors this one (rules/CLAUDE.md
# canonical + two targets at different depths), so the per-target prefix transform is exercised for
# BOTH targets independently — getting one right and the other wrong is exactly the silent-drift
# class this iteration removes.
#
# Wired into scripts/validate.sh (npm test).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$ROOT/scripts/generate-digest.mjs"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failures=0
total=0
check() { # $1 = name, $2 = 0/1 pass
  total=$((total + 1))
  if [[ "$2" != "0" ]]; then
    echo "FAIL: $1" >&2
    failures=$((failures + 1))
  fi
}
expect_exit() { # $1 = name, $2 = expected code, then the command …
  local name="$1" want="$2" got=0; shift 2
  "$@" >/dev/null 2>&1 || got=$?
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $name — expected exit $want, got $got" >&2
    failures=$((failures + 1))
  fi
  total=$((total + 1))
}

# --- throwaway repo mirroring this one's layout --------------------------------
# The generator resolves paths from its own location (../ = repo root), so the fixture repo gets a
# copy of the script rather than the fixture being pointed at the real repo.
REPO="$TMP/repo"
mkdir -p "$REPO/scripts" "$REPO/rules" "$REPO/.github"
cp "$GEN" "$REPO/scripts/generate-digest.mjs"
for n in 00-priorities 20-clean-code; do printf '# %s\n' "$n" > "$REPO/rules/$n.md"; done

write_canonical() { # $1 = extra bullet or ""
  cat > "$REPO/rules/CLAUDE.md" <<EOF
# Rules

## Always-on digest

Framing paragraph that must NOT be copied into the targets.

<!-- digest:start -->
- **Priorities:** first. ([\`00\`](./00-priorities.md))
- **Clean code:** second. ([\`20\`](./20-clean-code.md))${1:+
$1}
<!-- digest:end -->

## Composition
EOF
}
write_targets() {
  printf '# Agents\n\n## Always-on digest\n\nSTALE\n\n## After\n\nkeep me\n' > "$REPO/AGENTS.md"
  printf '# Copilot\n\n## Always-on digest\n\nSTALE\n\n## After\n\nkeep me\n' > "$REPO/.github/copilot-instructions.md"
}
write_canonical ""
write_targets

GENC="$REPO/scripts/generate-digest.mjs"

# --- drift is detected, then fixed ---------------------------------------------
expect_exit "check reports drift before first generate" 1 node "$GENC" --check
expect_exit "generate succeeds" 0 node "$GENC"
expect_exit "check is clean after generate" 0 node "$GENC" --check

# --- BOTH targets transformed, each with its own prefix -------------------------
# The whole point of a per-target prefix: root-level AGENTS.md needs ./rules/, and
# .github/copilot-instructions.md one level down needs ../rules/. A generator that got one right
# and the other wrong would still report "in sync".
check "AGENTS.md uses ./rules/ prefix" \
  "$(grep -qF '](./rules/00-priorities.md)' "$REPO/AGENTS.md"; echo $?)"
check "AGENTS.md has no ../rules/ prefix" \
  "$(! grep -qF '](../rules/' "$REPO/AGENTS.md"; echo $?)"
check "copilot copy uses ../rules/ prefix" \
  "$(grep -qF '](../rules/00-priorities.md)' "$REPO/.github/copilot-instructions.md"; echo $?)"
check "copilot copy has no ./rules/ prefix" \
  "$(! grep -qF '](./rules/' "$REPO/.github/copilot-instructions.md"; echo $?)"

# --- the framing paragraph and following sections are NOT copied/clobbered ------
check "framing paragraph not copied into target" \
  "$(! grep -q 'must NOT be copied' "$REPO/AGENTS.md"; echo $?)"
check "content after the digest section preserved" \
  "$(grep -q 'keep me' "$REPO/AGENTS.md"; echo $?)"
check "stale content replaced" \
  "$(! grep -q 'STALE' "$REPO/AGENTS.md"; echo $?)"

# --- a new canonical bullet propagates to both ----------------------------------
write_canonical '- **Third:** added. ([`00`](./00-priorities.md))'
expect_exit "check detects a new canonical bullet" 1 node "$GENC" --check
node "$GENC" >/dev/null
check "new bullet reached AGENTS.md" \
  "$(grep -q 'Third' "$REPO/AGENTS.md"; echo $?)"
check "new bullet reached copilot copy" \
  "$(grep -q 'Third' "$REPO/.github/copilot-instructions.md"; echo $?)"

# --- drift in EITHER target alone is caught -------------------------------------
# The original defect was one copy silently missing a bullet.
perl -0pi -e 's/- \*\*Third:.*\n//' "$REPO/AGENTS.md"
expect_exit "drift in AGENTS.md alone is caught" 1 node "$GENC" --check
node "$GENC" >/dev/null
perl -0pi -e 's/- \*\*Third:.*\n//' "$REPO/.github/copilot-instructions.md"
expect_exit "drift in the copilot copy alone is caught" 1 node "$GENC" --check
node "$GENC" >/dev/null

# --- malformed inputs fail loudly, never with a raw stack trace ------------------
cp "$REPO/rules/CLAUDE.md" "$TMP/canon.bak"
perl -0pi -e 's/<!-- digest:end -->/<!-- digest:ended -->/' "$REPO/rules/CLAUDE.md"
err="$(node "$GENC" --check 2>&1 || true)"
check "malformed markers give a clean error, not a stack trace" \
  "$([[ "$err" == *"generate-digest:"* && "$err" != *"at Object."* && "$err" != *"    at "* ]]; echo $?)"
cp "$TMP/canon.bak" "$REPO/rules/CLAUDE.md"

# --- a duplicate heading is ambiguous, not silently first-wins -------------------
cp "$REPO/AGENTS.md" "$TMP/agents.bak"
printf '\n## Always-on digest\n\nstray\n' >> "$REPO/AGENTS.md"
err="$(node "$GENC" --check 2>&1 || true)"
check "duplicate heading is rejected as ambiguous" \
  "$([[ "$err" == *"ambiguous"* ]]; echo $?)"
cp "$TMP/agents.bak" "$REPO/AGENTS.md"

# --- a heading MENTIONED in prose does not hijack the anchor ---------------------
perl -0pi -e 's/^# Agents$/# Agents\n\nSee the ## Always-on digest section below./m' "$REPO/AGENTS.md"
expect_exit "prose mentioning the heading does not hijack the anchor" 0 node "$GENC" --check
check "the prose mention survived intact" \
  "$(grep -q 'See the ## Always-on digest section below.' "$REPO/AGENTS.md"; echo $?)"

# --- retarget() rewrites ONLY citations, never other relative links -------------
# An unanchored `](./` pattern rewrote every relative link in a bullet: a prose link became
# ./rules/docs/GUIDE.md in one copy and ../rules/docs/GUIDE.md in the other — both dead — while
# --check reported "in sync". The hook's F-37 fix exists to keep prose links in bullets intact, so
# an unanchored rewrite here put the two halves of that seam in disagreement.
write_canonical '- **Guide:** see [guide](./docs/GUIDE.md) first. ([`20`](./20-clean-code.md))'
node "$GENC" >/dev/null
check "prose link survives untouched in AGENTS.md" \
  "$(grep -qF '[guide](./docs/GUIDE.md)' "$REPO/AGENTS.md"; echo $?)"
check "prose link survives untouched in the copilot copy" \
  "$(grep -qF '[guide](./docs/GUIDE.md)' "$REPO/.github/copilot-instructions.md"; echo $?)"
check "the citation beside it still retargets (AGENTS.md)" \
  "$(grep -qF '](./rules/20-clean-code.md)' "$REPO/AGENTS.md"; echo $?)"
check "the citation beside it still retargets (copilot copy)" \
  "$(grep -qF '](../rules/20-clean-code.md)' "$REPO/.github/copilot-instructions.md"; echo $?)"
write_canonical ""
node "$GENC" >/dev/null

# --- a fenced `## ` inside the digest section does not terminate the splice ------
# The fence sits INSIDE the digest section, which is generated territory — so correct behaviour is
# that the whole fence is REPLACED, leaving the following section untouched.
#
# Without fence tracking, `## Not a real heading` reads as the next heading: the splice ends there,
# the opening ``` (before it) is swallowed as generated content, and the fake heading plus the
# CLOSING ``` survive as an orphan — an unbalanced fence — while `--check` still reports "in sync".
# So the discriminator is the presence of that debris, not the survival of the fence.
cp "$REPO/AGENTS.md" "$TMP/agents-fence.bak"
perl -0pi -e 's/^## After$/```md\n## Not a real heading\n```\n\n## After/m' "$REPO/AGENTS.md"
node "$GENC" >/dev/null 2>&1 || true
check "fenced '## ' did not terminate the splice early (no orphan heading)" \
  "$(! grep -q 'Not a real heading' "$REPO/AGENTS.md"; echo $?)"
check "no unbalanced fence left behind" \
  "$([[ $(grep -c '^```' "$REPO/AGENTS.md") -eq 0 ]]; echo $?)"
check "section following the fence survived" \
  "$(grep -q 'keep me' "$REPO/AGENTS.md"; echo $?)"
cp "$TMP/agents-fence.bak" "$REPO/AGENTS.md"

echo "generate-digest tests: $((total - failures)) of $total checks passed."
[[ "$failures" -eq 0 ]] || exit 1
