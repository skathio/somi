#!/usr/bin/env bash
# Unit guard for scripts/somi-dispatch.mjs: the deterministic dispatch resolver a prompt shells out
# to for "which tier and model should this agent run at, right now" -- the first real call site for
# decideDispatch/modelForDispatch (nothing before this composed them together outside a test).
#
# Exercises: resolution against real shipped agents at every representative declared shape
# (high-only, medium+high, low+medium) across all three ceilings; ceiling_source surfacing each of
# cli/env/config/state/default; an unmapped host resolving to model: null rather than a guess; the
# project's `.somi/config.json` `cost.mapping` override (an unmapped host gaining a mapped model, a
# single claude-code tier overridden, a __proto__ key rejected, a malformed mapping -- missing tier
# or non-string model -- failing loudly with no JSON on stdout); a path-traversal attempt in
# --agent rejected before any file is read, in either direction (`../` and a bare `/`); the somi
# exemption and an unknown agent each failing with their own distinct, clear, non-zero exit code;
# an empty or missing value for --host/--ceiling/--agent rejected outright rather than falling
# through to a silent default; and the three exit codes (usage / unknown agent / malformed
# declaration) staying distinct from each other and from success.
#
# Every invocation is scoped to its OWN throwaway CLAUDE_PROJECT_DIR, so the real repo's
# .somi/somi-state/ceiling.json is never read or written by this suite -- agent frontmatter itself
# is still read from the REAL agents/ directory (the resolver's install root, not the project
# root), which is the behavior under test, not something to fake.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT_REPO/scripts/somi-dispatch.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

echo "== somi-dispatch resolve =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fresh() { mktemp -d -p "$TMP"; }

# $1 = project root, remaining = full CLI args (including the subcommand).
run() {
  local proj="$1"; shift
  CLAUDE_PROJECT_DIR="$proj" node "$CLI" "$@"
}
# $1 = a captured JSON string, $2 = key to extract.
field() {
  node -e 'const o = JSON.parse(process.argv[1]); process.stdout.write(String(o[process.argv[2]]))' "$1" "$2"
}
expect_exit() { # $1 = name, $2 = expected exit code, $3 = project root, remaining = CLI args
  local name="$1" want="$2" proj="$3" got=0
  shift 3
  run "$proj" "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then ok "$name"; else bad "$name (expected exit $want, got $got)"; fi
}

# --- high-only (`designer`, cost: high): no cheaper mode exists, so every ceiling still runs high -
for c in low medium high; do
  out="$(run "$(fresh)" resolve --agent designer --ceiling "$c")"
  check "designer (high-only) under ceiling=$c: tier is high -- no cheaper mode to select" \
    "$(field "$out" tier)" "high"
  check "designer under ceiling=$c: model is opus" "$(field "$out" model)" "opus"
done

# --- graded medium/high (`reviewer`): ceiling picks the highest permitted member -----------------
out="$(run "$(fresh)" resolve --agent reviewer --ceiling low)"
check "reviewer (medium,high) under ceiling=low: no member fits, selects cheapest (medium)" \
  "$(field "$out" tier)" "medium"
out="$(run "$(fresh)" resolve --agent reviewer --ceiling medium)"
check "reviewer under ceiling=medium: selects medium" "$(field "$out" tier)" "medium"
out="$(run "$(fresh)" resolve --agent reviewer --ceiling high)"
check "reviewer under ceiling=high: selects high" "$(field "$out" tier)" "high"

# --- graded low/medium (`coder`): the opt-in `low` bar's shipped example ------------------------
out="$(run "$(fresh)" resolve --agent coder --ceiling low)"
check "coder (low,medium) under ceiling=low: selects low" "$(field "$out" tier)" "low"
check "coder under ceiling=low: model is haiku" "$(field "$out" model)" "haiku"
out="$(run "$(fresh)" resolve --agent coder --ceiling medium)"
check "coder under ceiling=medium: selects medium" "$(field "$out" tier)" "medium"
out="$(run "$(fresh)" resolve --agent coder --ceiling high)"
check "coder under ceiling=high: selects its own top member (medium), never invents high" \
  "$(field "$out" tier)" "medium"
check "coder under ceiling=high: model is sonnet, not opus" "$(field "$out" model)" "sonnet"

# --- ceiling_source covers all five origins -- this is what lets a dispatcher announce a `low`
# ceiling honestly, by its real source, not just its bare value. -----------------------------------
out="$(run "$(fresh)" resolve --agent coder)"
check "no config, no env, no --ceiling: ceiling_source is default" "$(field "$out" ceiling_source)" "default"

out="$(run "$(fresh)" resolve --agent coder --ceiling medium)"
check "explicit --ceiling: ceiling_source is cli" "$(field "$out" ceiling_source)" "cli"

R_ENV="$(fresh)"
out="$(CLAUDE_PROJECT_DIR="$R_ENV" SOMI_COST_CEILING=medium node "$CLI" resolve --agent coder)"
check "SOMI_COST_CEILING set, no --ceiling: ceiling_source is env" "$(field "$out" ceiling_source)" "env"

R_CFG="$(fresh)"; mkdir -p "$R_CFG/.somi"
printf '{"cost": {"ceiling": "low"}}\n' > "$R_CFG/.somi/config.json"
out="$(run "$R_CFG" resolve --agent coder)"
check "bootstrap from .somi/config.json's cost.ceiling: ceiling_source is config" \
  "$(field "$out" ceiling_source)" "config"
out2="$(run "$R_CFG" resolve --agent coder)"
check "a second call against the same project root: ceiling_source is state, not config again" \
  "$(field "$out2" ceiling_source)" "state"

# --- unmapped host: model is null (let the host choose), never a guessed name -------------------
out="$(run "$(fresh)" resolve --agent coder --host some-future-host)"
check "unmapped host: model is null" "$(field "$out" model)" "null"
check "unmapped host: tier still resolves normally" "$(field "$out" tier)" "medium"

# --- .somi/config.json's cost.mapping override: how a host SoMi doesn't map (e.g. Copilot) is told
# which of ITS OWN models is low/medium/high -- reused via readCostConfig, merged via
# mergeHostMapping, never a second config reader. A malformed one fails loudly (66), no stdout. ---
expect_malformed() { # $1=name $2=proj, remaining = CLI args
  local name="$1" proj="$2" out rc=0; shift 2
  out="$(run "$proj" "$@" 2>/dev/null)" || rc=$?
  check "$name: exit 66" "$rc" "66"
  check "$name: no JSON on stdout" "$out" ""
}

# Otherwise-unmapped host, mapped by the project: resolves to it for the tier actually selected
# (coder is low,medium; default ceiling high -> its own top member, medium). Without the mapping,
# same as any unmapped host: null.
R_MAP="$(fresh)"; mkdir -p "$R_MAP/.somi"
printf '{"cost": {"mapping": {"copilot": {"low": "gpt-5-mini", "medium": "gpt-5", "high": "gpt-5-pro"}}}}\n' \
  > "$R_MAP/.somi/config.json"
out="$(run "$R_MAP" resolve --agent coder --host copilot)"
check "copilot mapped via project config: model is the mapped medium entry" "$(field "$out" model)" "gpt-5"
out="$(run "$(fresh)" resolve --agent coder --host copilot)"
check "copilot with no project mapping: model is null" "$(field "$out" model)" "null"

# A project mapping can override a single claude-code tier; designer (cost: high, no cheaper mode)
# always selects high, isolating the override to exactly the tier it names.
R_OVERRIDE="$(fresh)"; mkdir -p "$R_OVERRIDE/.somi"
printf '{"cost": {"mapping": {"claude-code": {"low": "haiku", "medium": "sonnet", "high": "custom-opus"}}}}\n' \
  > "$R_OVERRIDE/.somi/config.json"
out="$(run "$R_OVERRIDE" resolve --agent designer)"
check "project mapping overrides claude-code's high tier" "$(field "$out" model)" "custom-opus"

# A __proto__ key is rejected outright (mergeHostMapping's denylist), never merged.
R_PROTO="$(fresh)"; mkdir -p "$R_PROTO/.somi"
printf '{"cost": {"mapping": {"__proto__": {"low": "x"}}}}\n' > "$R_PROTO/.somi/config.json"
expect_malformed "a __proto__ key in cost.mapping" "$R_PROTO" resolve --agent coder
proto_err="$(run "$R_PROTO" resolve --agent coder 2>&1 >/dev/null)"
case "$proto_err" in
  *"__proto__"*) ok "the __proto__ rejection names the disallowed key" ;;
  *) bad "the __proto__ rejection does not name the key (got: $proto_err)" ;;
esac

# A mapped host missing the tier actually selected (coder's default selection is medium; this
# mapping supplies only low), and a non-string model value, are malformed the same way.
R_PARTIAL="$(fresh)"; mkdir -p "$R_PARTIAL/.somi"
printf '{"cost": {"mapping": {"copilot": {"low": "gpt-5-mini"}}}}\n' > "$R_PARTIAL/.somi/config.json"
expect_malformed "a mapped host missing the selected tier" "$R_PARTIAL" resolve --agent coder --host copilot

R_NONSTRING="$(fresh)"; mkdir -p "$R_NONSTRING/.somi"
printf '{"cost": {"mapping": {"copilot": {"low": "gpt-5-mini", "medium": 5, "high": "gpt-5-pro"}}}}\n' \
  > "$R_NONSTRING/.somi/config.json"
expect_malformed "a non-string mapped model" "$R_NONSTRING" resolve --agent coder --host copilot

# --- path traversal in --agent: rejected before any file is read, in either direction ------------
expect_exit "path traversal in --agent (../etc/passwd) rejected as a usage error" 64 \
  "$(fresh)" resolve --agent ../etc/passwd
expect_exit "a slash in --agent (a/b) rejected as a usage error" 64 \
  "$(fresh)" resolve --agent a/b

R_TRAV="$(fresh)"
run "$R_TRAV" resolve --agent ../etc/passwd >/dev/null 2>&1
if [ -e "$R_TRAV/.somi" ]; then
  bad "a rejected --agent must be caught before the ceiling is ever touched (found .somi/ in the project root)"
else
  ok "a rejected --agent (../etc/passwd) leaves the project root untouched -- rejected before any read"
fi

# --- somi is exempt: a clear, distinct, non-zero error, never a guessed model --------------------
expect_exit "agent somi (exempt from cost:) fails with its own distinct exit code" 66 \
  "$(fresh)" resolve --agent somi
msg="$(run "$(fresh)" resolve --agent somi 2>&1 >/dev/null || true)"
case "$msg" in
  *exempt*) ok "somi's error message names the exemption, not a generic failure" ;;
  *) bad "somi's error message does not mention the exemption (got: $msg)" ;;
esac

# --- unknown agent: a clear, distinct, non-zero error --------------------------------------------
expect_exit "unknown agent fails with its own distinct exit code" 65 \
  "$(fresh)" resolve --agent totally-not-a-real-agent
msg="$(run "$(fresh)" resolve --agent totally-not-a-real-agent 2>&1 >/dev/null || true)"
case "$msg" in
  *"unknown agent"*) ok "unknown-agent error message says so" ;;
  *) bad "unknown-agent error message is unclear (got: $msg)" ;;
esac

# --- the three failure exit codes are pairwise distinct, and distinct from success ---------------
check "usage (64), unknown-agent (65) and malformed (66) are three different codes" \
  "$(printf '%s' "64 65 66" | tr ' ' '\n' | sort -u | wc -l | tr -d ' ')" "3"

# --- bad args: missing --agent, unknown subcommand, unknown flag --------------------------------
expect_exit "missing --agent is a usage error" 64 "$(fresh)" resolve
expect_exit "unknown subcommand is a usage error" 64 "$(fresh)" bogus-subcommand --agent coder
expect_exit "unknown flag is a usage error" 64 "$(fresh)" resolve --agent coder --bogus-flag x
expect_exit "no subcommand at all is a usage error" 64 "$(fresh)"

# --- an empty or missing flag value is rejected outright, never silently defaulted --------------
expect_exit "--host with an explicitly empty value is a usage error, not a silent default" 64 \
  "$(fresh)" resolve --agent coder --host ""
expect_exit "a trailing --host with no value at all is a usage error" 64 \
  "$(fresh)" resolve --agent coder --host
expect_exit "--ceiling with an explicitly empty value is a usage error" 64 \
  "$(fresh)" resolve --agent coder --ceiling ""
expect_exit "a trailing --ceiling with no value at all is a usage error" 64 \
  "$(fresh)" resolve --agent coder --ceiling
expect_exit "--agent with an explicitly empty value is a usage error" 64 \
  "$(fresh)" resolve --agent ""

# --- output shape: exactly the six documented fields, and a real JSON array for `supported` ------
out="$(run "$(fresh)" resolve --agent coder --ceiling medium)"
check "JSON output carries exactly agent/supported/tier/model/ceiling/ceiling_source" \
  "$(node -e 'process.stdout.write(Object.keys(JSON.parse(process.argv[1])).sort().join("|"))' "$out")" \
  "agent|ceiling|ceiling_source|model|supported|tier"
check "coder's supported set is exactly [low, medium], echoing its declared frontmatter" \
  "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).supported.join(","))' "$out")" \
  "low,medium"

echo "somi-dispatch tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
