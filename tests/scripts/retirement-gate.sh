#!/usr/bin/env bash
# Unit guard for tests/scripts/lib/retirement-gate.mjs (the stale-vocabulary retirement gate).
#
# The gate exists to catch a half-converted file that scripts/validate.sh's frontmatter
# assertions structurally cannot see. validate.sh:296-300 already documents the trap a check like
# this can fall into: a pattern broad enough to match the CORRECTED text fires on its own fix, and
# a check that fires on its own fix is a check nobody keeps. So this proves the gate BOTH ways —
# red against a synthetic fixture still carrying the retired vocabulary, green against a clean one
# — rather than trusting it because the real tree happens to pass today.
#
# The gate exits 0 for every SCAN outcome (clean or stale) and signals purely through stdout
# content (`ok*` vs. anything else) — a scan result must never exit non-zero, because
# scripts/validate.sh assigns its stdout via command substitution under `set -euo pipefail`, and a
# plain assignment's exit status is the substitution's: a non-zero exit there kills the caller at
# the assignment, before the `case` that prints the hit list ever runs. The CALLER SHAPE case below
# reproduces that exact seam. (A missing-argument usage error is a different case, exits 2, and
# reaches the terminal via stderr instead — see the gate's own exit-contract comment.)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$ROOT/tests/scripts/lib/retirement-gate.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

echo "== stale-vocabulary retirement gate =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- RED: a synthetic fixture still carrying the retired vocabulary must fail -------------------
STALE="$TMP/stale"; mkdir -p "$STALE/agents" "$STALE/commands"
cat > "$STALE/agents/example.md" <<'EOF'
---
name: example
description: An example agent.
model: sonnet
---

> **Tier: ECO (`sonnet`).** This agent runs on the ECO tier and hands off to the MAX tier when
> deeper design is needed. See the MAX->ECO handoff for details.
EOF

out="$(cd "$STALE" && node "$GATE" agents commands 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then
  ok "gate always exits 0, even against a stale fixture (signals failure via stdout content only)"
else
  bad "gate exited non-zero ($rc) against a stale fixture -- it must always exit 0 (got: $out)"
fi
case "$out" in
  "STALE VOCABULARY"*) ok "gate's stdout starts with STALE VOCABULARY against a fixture that still carries MAX/ECO vocabulary" ;;
  *) bad "gate's stdout does not start with STALE VOCABULARY against a fixture that still carries MAX/ECO vocabulary (got: $out)" ;;
esac
case "$out" in
  *"STALE VOCABULARY"*"ECO"*) ok "gate's report names the stale hit" ;;
  *) bad "gate's report does not name the stale hit (got: $out)" ;;
esac

# --- RED: a hardcoded model name outside frontmatter must also fail -----------------------------
STALE2="$TMP/stale2"; mkdir -p "$STALE2/commands"
cat > "$STALE2/commands/example.md" <<'EOF'
---
description: An example command.
model: sonnet
---

Task the reviewer agent (`opus`) on a fresh context.
EOF
out2="$(cd "$STALE2" && node "$GATE" commands 2>&1)"; rc2=$?
if [ "$rc2" -eq 0 ]; then
  ok "gate always exits 0 against a fixture with a hardcoded model name in prose"
else
  bad "gate exited non-zero ($rc2) against a fixture with a hardcoded model name in prose (got: $out2)"
fi
case "$out2" in
  "STALE VOCABULARY"*) ok "gate's stdout starts with STALE VOCABULARY for a hardcoded model name in prose" ;;
  *) bad "gate's stdout does not start with STALE VOCABULARY for a hardcoded model name in prose (got: $out2)" ;;
esac

# --- CALLER SHAPE: reproduce scripts/validate.sh's own `assignment under set -e` + `case` idiom -
# against the stale fixture, line for line. This is the exact seam the dead-diagnostic bug lived
# in: node exiting non-zero under `set -euo pipefail` killed the caller at a plain assignment,
# silently, before the `case` that prints the hit list ever ran. A regression here (the gate
# exiting non-zero again) makes this fail the same way the real bug did: the diagnostic never
# reaches `caller_out` at all.
caller_out="$(
  exec 2>&1
  set -euo pipefail
  cd "$STALE"
  retirement_gate=$(node "$GATE" agents commands)
  case "$retirement_gate" in
    ok*) echo "  $retirement_gate" ;;
    *)
      echo "STALE VOCABULARY RETIREMENT GATE FAILED:" >&2
      echo "$retirement_gate" >&2
      exit 1
      ;;
  esac
)"
caller_rc=$?
if [ "$caller_rc" -eq 1 ]; then
  ok "caller-shape subshell exits 1 via the case's own exit"
else
  bad "caller-shape subshell exited $caller_rc, expected 1 from the case block (got: $caller_out)"
fi
case "$caller_out" in
  *"STALE VOCABULARY RETIREMENT GATE FAILED:"*"ECO"*)
    ok "caller-shape diagnostic reaches output: header and the stale hit are both present" ;;
  *)
    bad "caller-shape diagnostic did not reach output -- the assignment likely died under set -e before the case ran (got: $caller_out)" ;;
esac

# --- GREEN: the converted-style equivalent must pass ---------------------------------------------
CLEAN="$TMP/clean"; mkdir -p "$CLEAN/agents" "$CLEAN/commands"
cat > "$CLEAN/agents/example.md" <<'EOF'
---
name: example
description: An example agent.
model: sonnet
cost: medium
---

> **Cost: medium (`cost: medium`).** This agent runs at cost: medium and hands off to cost: high
> when deeper design is needed. See the design->execution handoff for details.
EOF
cat > "$CLEAN/commands/example.md" <<'EOF'
---
description: An example command.
model: sonnet
cost: medium
---

Task the reviewer agent (`cost: high`) on a fresh context.
EOF

if out3="$(cd "$CLEAN" && node "$GATE" agents commands 2>&1)"; then
  ok "gate exits 0 against a fully-converted fixture"
else
  bad "gate exits non-zero against a fully-converted fixture (got: $out3)"
fi
case "$out3" in
  ok*) ok "gate's report starts with 'ok' on the clean fixture" ;;
  *) bad "gate's report does not start with 'ok' on the clean fixture (got: $out3)" ;;
esac

# --- Frontmatter `model:` line is structural, not vocabulary: alone, it must not fail -----------
FRONTMATTER_ONLY="$TMP/frontmatter-only"; mkdir -p "$FRONTMATTER_ONLY/agents"
cat > "$FRONTMATTER_ONLY/agents/example.md" <<'EOF'
---
name: example
description: An example agent with only a bare model: line, no other vocabulary.
model: opus
cost: high
---

Ordinary body text with no retired vocabulary anywhere in it.
EOF
if out4="$(cd "$FRONTMATTER_ONLY" && node "$GATE" agents 2>&1)"; then
  ok "a bare frontmatter 'model: opus' line alone does not fail the gate"
else
  bad "a bare frontmatter 'model: opus' line alone failed the gate (got: $out4)"
fi

# --- RED: a bare `model: opus` line OUTSIDE frontmatter and outside any fence must fail -- the ---
# exemption is POSITIONAL, not "any column-0 line reading model: <value>, anywhere in the file" --
POSITIONAL="$TMP/positional"; mkdir -p "$POSITIONAL/agents"
cat > "$POSITIONAL/agents/example.md" <<'EOF'
---
name: example
description: An example agent.
model: sonnet
cost: high
---

Some ordinary prose above a stray line.

model: opus

More ordinary prose below it.
EOF
out7="$(cd "$POSITIONAL" && node "$GATE" agents 2>&1)"
case "$out7" in
  "STALE VOCABULARY"*) ok "a bare 'model: opus' line outside frontmatter and outside a fence fails the gate" ;;
  *) bad "a bare 'model: opus' line outside frontmatter and outside a fence did not fail the gate -- the exemption is lexical again, not positional (got: $out7)" ;;
esac

# --- GREEN: a `model: opus` line INSIDE a fenced code block teaching the frontmatter shape -------
# (docs/EXTENDING.md's and docs/COMMANDS.md's "Adding an agent/command" recipes) must NOT fail ---
FENCED="$TMP/fenced"; mkdir -p "$FENCED/docs"
cat > "$FENCED/docs/example.md" <<'EOF'
## Adding an agent

```markdown
---
name: <name>
description: ...
model: opus
cost: high
---
```

More prose after the fence, with no retired vocabulary.
EOF
out8="$(cd "$FENCED" && node "$GATE" docs 2>&1)"
case "$out8" in
  ok*) ok "a 'model: opus' line inside a fenced documentation example does not fail the gate" ;;
  *) bad "a 'model: opus' line inside a fenced documentation example failed the gate (got: $out8)" ;;
esac

# --- RED: a capitalized model name in prose must also fail -- MODEL_PATTERN is case-insensitive --
CAPS="$TMP/caps"; mkdir -p "$CAPS/docs"
cat > "$CAPS/docs/example.md" <<'EOF'
Opus front-loads the reasoning; Sonnet executes; Haiku is the cheapest tier.
EOF
out9="$(cd "$CAPS" && node "$GATE" docs 2>&1)"
case "$out9" in
  "STALE VOCABULARY"*) ok "a capitalized model name ('Opus') in prose fails the gate" ;;
  *) bad "a capitalized model name in prose did not fail the gate -- MODEL_PATTERN missed the capitalized spelling (got: $out9)" ;;
esac

# --- A named exemption (e.g. CHANGELOG.md) keeps carrying the old words without failing ---------
EXEMPT="$TMP/exempt"; mkdir -p "$EXEMPT"
cat > "$EXEMPT/CHANGELOG.md" <<'EOF'
## [1.1.0] - MAX/ECO economy & the execution brief

Re-tiers SoMi's models: the MAX tier (opus) front-loads; the ECO tier (sonnet) executes.
EOF
if out5="$(cd "$EXEMPT" && node "$GATE" . 2>&1)"; then
  ok "CHANGELOG.md keeps the retired vocabulary without failing the gate (named exemption)"
else
  bad "CHANGELOG.md failed the gate despite being a named exemption (got: $out5)"
fi

# --- tests/evals/results/ is skipped even though it is swept ------------------------------------
EVALS="$TMP/evals"; mkdir -p "$EVALS/tests/evals/results"
cat > "$EVALS/tests/evals/results/transcript.json" <<'EOF'
{"transcript": "Depth gate: proceeding on ECO (`/plan`), not escalating to MAX."}
EOF
if out6="$(cd "$EVALS" && node "$GATE" tests 2>&1)"; then
  ok "tests/evals/results/ is skipped even though a transcript inside it carries the old words"
else
  bad "tests/evals/results/ was swept and failed the gate (got: $out6)"
fi

# --- RED: an odd run of fence markers must not leave the fence tracker stuck open ---------------
# A boolean toggle flips on ANY backtick run, so a four-backtick-fenced block whose own CONTENT
# contains a three-backtick line (an odd count: open, content, close = 3 toggles, ending true)
# leaves the tracker believing it is still inside a fence for the rest of the file -- silently
# exempting a real, bare `model:` line in ordinary prose below it. CommonMark's rule (track the
# opening marker's length, close only on a marker at least as long) must not make this mistake.
FENCE_NESTING="$TMP/fence-nesting"; mkdir -p "$FENCE_NESTING/docs"
printf '%s\n' \
  'Some prose above.' \
  '' \
  '````' \
  'A fenced block using four backticks.' \
  '```' \
  'This inner line has exactly three backticks; a boolean toggle would flip on it too.' \
  '````' \
  '' \
  'model: opus' \
  '' \
  'More prose below the real close.' \
  > "$FENCE_NESTING/docs/example.md"
out10="$(cd "$FENCE_NESTING" && node "$GATE" docs 2>&1)"
case "$out10" in
  "STALE VOCABULARY"*"model: opus"*)
    ok "a bare 'model: opus' line after an odd-count nested fence run still fails the gate" ;;
  *)
    bad "an odd-count nested fence run left the tracker stuck open -- 'model: opus' below it was silently exempted (got: $out10)" ;;
esac

# --- Pin EXEMPT_FILES.size so growing the exemption list is a deliberate, visible edit -----------
exempt_count="$(awk '
  /^const EXEMPT_FILES = new Set\(\[$/ { f=1; next }
  f && /^\]\);$/ { f=0; next }
  f { print }
' "$GATE" | grep -c "'")"
if [ "$exempt_count" -eq 9 ]; then
  ok "EXEMPT_FILES has exactly 9 entries (growing the list is now a visible test failure, not a silent edit)"
else
  bad "EXEMPT_FILES has $exempt_count entries, expected 9 -- if the exemption list grew on purpose, update this pin deliberately"
fi

echo "retirement gate tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
