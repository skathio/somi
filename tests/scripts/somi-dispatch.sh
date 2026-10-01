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
# mergeHostMapping, never a second config reader. A malformed one fails loudly, no stdout -- exit 67
# whenever the project's own cost.mapping is the cause: either the mapping's own SHAPE is invalid
# (mergeHostMapping's own checks: a disallowed host key, a non-object per-host value), or the shape
# is fine but the resolved data is incomplete or wrong for the tier actually selected (resolveModel's
# checks, via modelForDispatch) for a host the project's OWN mapping named -- a partial override of a
# shipped host replaces that host's whole tier map rather than merging it tier-by-tier, so overriding
# just one tier drops the others, and the resulting error names ".somi/config.json cost.mapping"
# explicitly rather than reading like agent coder's own broken cost: declaration. Exit 66 stays
# reserved for a resolution failure on a host the project's mapping never mentioned at all -- which
# would mean a bug in the shipped HOST_MODELS table itself (see scripts/somi-dispatch.mjs's own
# split). ------------------------------------------------------------------------------------------
expect_malformed() { # $1=name $2=want-exit-code $3=proj, remaining = CLI args
  local name="$1" want="$2" proj="$3" out rc=0; shift 3
  out="$(run "$proj" "$@" 2>/dev/null)" || rc=$?
  check "$name: exit $want" "$rc" "$want"
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

# A __proto__ key is rejected outright (mergeHostMapping's denylist) -- this is the PROJECT's own
# config.json being malformed, exit 67, never merged.
R_PROTO="$(fresh)"; mkdir -p "$R_PROTO/.somi"
printf '{"cost": {"mapping": {"__proto__": {"low": "x"}}}}\n' > "$R_PROTO/.somi/config.json"
expect_malformed "a __proto__ key in cost.mapping" 67 "$R_PROTO" resolve --agent coder
proto_err="$(run "$R_PROTO" resolve --agent coder 2>&1 >/dev/null)"
case "$proto_err" in
  *"__proto__"*) ok "the __proto__ rejection names the disallowed key" ;;
  *) bad "the __proto__ rejection does not name the key (got: $proto_err)" ;;
esac

# A mapped host missing the tier actually selected (coder's default selection is medium; this
# mapping supplies only low), and a non-string model value, are shape-valid but data-incomplete for
# THIS dispatch -- resolveModel's own checks, via modelForDispatch. Both name "copilot", which the
# project's OWN mapping named, so both are the project's fault: exit 67, message names
# ".somi/config.json cost.mapping" (not every mapping problem is the project's own file being
# broken in the STRUCTURAL sense mergeHostMapping checks, but these two are still its own data).
R_PARTIAL="$(fresh)"; mkdir -p "$R_PARTIAL/.somi"
printf '{"cost": {"mapping": {"copilot": {"low": "gpt-5-mini"}}}}\n' > "$R_PARTIAL/.somi/config.json"
expect_malformed "a mapped host missing the selected tier" 67 "$R_PARTIAL" resolve --agent coder --host copilot
partial_msg="$(run "$R_PARTIAL" resolve --agent coder --host copilot 2>&1 >/dev/null || true)"
case "$partial_msg" in
  *".somi/config.json cost.mapping"*) ok "the missing-tier error names .somi/config.json cost.mapping" ;;
  *) bad "the missing-tier error does not name .somi/config.json cost.mapping (got: $partial_msg)" ;;
esac

R_NONSTRING="$(fresh)"; mkdir -p "$R_NONSTRING/.somi"
printf '{"cost": {"mapping": {"copilot": {"low": "gpt-5-mini", "medium": 5, "high": "gpt-5-pro"}}}}\n' \
  > "$R_NONSTRING/.somi/config.json"
expect_malformed "a non-string mapped model" 67 "$R_NONSTRING" resolve --agent coder --host copilot
nonstring_msg="$(run "$R_NONSTRING" resolve --agent coder --host copilot 2>&1 >/dev/null || true)"
case "$nonstring_msg" in
  *".somi/config.json cost.mapping"*) ok "the non-string-model error names .somi/config.json cost.mapping" ;;
  *) bad "the non-string-model error does not name .somi/config.json cost.mapping (got: $nonstring_msg)" ;;
esac

# The reported bug: a partial override of a SHIPPED host (claude-code) that names only one tier
# replaces that host's whole tier map (mergeHostMapping never merges tier-by-tier), so every OTHER
# tier for that host now fails too -- and the failure must name .somi/config.json cost.mapping, not
# read like coder's own cost: declaration is broken.
R_SHIPPED_PARTIAL="$(fresh)"; mkdir -p "$R_SHIPPED_PARTIAL/.somi"
printf '{"cost": {"mapping": {"claude-code": {"high": "custom-opus"}}}}\n' > "$R_SHIPPED_PARTIAL/.somi/config.json"
expect_malformed "a partial override of the shipped claude-code host drops its other tiers" 67 \
  "$R_SHIPPED_PARTIAL" resolve --agent coder
shipped_partial_msg="$(run "$R_SHIPPED_PARTIAL" resolve --agent coder 2>&1 >/dev/null || true)"
case "$shipped_partial_msg" in
  *".somi/config.json cost.mapping"*) ok "the shipped-host partial-override error names .somi/config.json cost.mapping" ;;
  *) bad "the shipped-host partial-override error does not name .somi/config.json cost.mapping (got: $shipped_partial_msg)" ;;
esac

# A tier key outside low|medium|high in cost.mapping is ALSO the project's own file being malformed
# (mergeHostMapping's own check, same as __proto__ above) -- exit 67, not 66.
R_BADTIER="$(fresh)"; mkdir -p "$R_BADTIER/.somi"
printf '{"cost": {"mapping": {"copilot": {"lo": "gpt-5-mini"}}}}\n' > "$R_BADTIER/.somi/config.json"
expect_malformed "a tier key outside low|medium|high in cost.mapping" 67 "$R_BADTIER" resolve --agent coder --host copilot

# A named regression test: bootstrap normally (valid config, ceiling state written), THEN corrupt
# config.json -- the ceiling itself doesn't re-read config after bootstrap, but the mapping
# (read fresh every call) does, and its failure must be reported as the PROJECT's file breaking
# (67), never as agent coder's own cost: declaration being malformed (66).
R_POSTBOOT="$(fresh)"; mkdir -p "$R_POSTBOOT/.somi"
printf '{"cost": {"ceiling": "high"}}\n' > "$R_POSTBOOT/.somi/config.json"
run "$R_POSTBOOT" resolve --agent coder >/dev/null # bootstrap: writes .somi/somi-state/ceiling.json
printf '{"cost": {"ceiling": "high"}\n' > "$R_POSTBOOT/.somi/config.json"  # now corrupt (missing brace)
postboot_rc=0
run "$R_POSTBOOT" resolve --agent coder >/dev/null 2>&1 || postboot_rc=$?
check "config corrupted AFTER a successful bootstrap: exit 67, not 66" "$postboot_rc" "67"

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

# --- the four failure exit codes, DERIVED from the CLI's own EXIT_* constants (not re-typed here),
# are pairwise distinct, and distinct from success (0) -------------------------------------------
cli_codes="$(grep -oE '^const EXIT_[A-Z_]+ = [0-9]+;' "$CLI" | grep -oE '[0-9]+')"
check "the CLI declares exactly four EXIT_* constants" "$(printf '%s\n' "$cli_codes" | wc -l | tr -d ' ')" "4"
check "the CLI's own EXIT_* constants are pairwise distinct, and none is 0 (success)" \
  "$(printf '%s\n0\n' "$cli_codes" | sort -u | wc -l | tr -d ' ')" "5"

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

# --- a syntactically-present but invalid --ceiling VALUE (not empty/missing, an unrecognized tier)
# is a usage error, and -- the actual point of this guard -- it must be rejected BEFORE
# resolveCeiling() ever touches disk, so a rejected value leaves no .somi/ state behind. -----------
R_BADCEIL="$(fresh)"
expect_exit "an invalid --ceiling VALUE ('critical') is a usage error, not a project-env failure" 64 \
  "$R_BADCEIL" resolve --agent coder --ceiling critical
badceil_msg="$(run "$R_BADCEIL" resolve --agent coder --ceiling critical 2>&1 >/dev/null || true)"
case "$badceil_msg" in
  *"--ceiling"*"critical"*) ok "the bad --ceiling error names the flag and the rejected value" ;;
  *) bad "the bad --ceiling error is unclear (got: $badceil_msg)" ;;
esac
if [ -e "$R_BADCEIL/.somi" ]; then
  bad "a rejected --ceiling value must be caught before the ceiling state is ever touched (found .somi/ in the project root)"
else
  ok "a rejected --ceiling value ('critical') leaves the project root untouched -- validated before resolveCeiling touches disk"
fi

# --- project environment/config failures: exit 67, distinct from 64 (usage) and 66 (declaration),
# and the message names the offending file -- these are the caller's PROJECT state being broken,
# not a bad argument to this command and not a bad agent declaration. ------------------------------
R_CFG_BROKEN="$(fresh)"; mkdir -p "$R_CFG_BROKEN/.somi"
printf '{"cost": {"ceiling": "low"}\n' > "$R_CFG_BROKEN/.somi/config.json"  # missing closing brace
expect_exit "an unparsable .somi/config.json is a project-env failure (67), not usage or malformed" 67 \
  "$R_CFG_BROKEN" resolve --agent coder
cfg_broken_msg="$(run "$R_CFG_BROKEN" resolve --agent coder 2>&1 >/dev/null || true)"
case "$cfg_broken_msg" in
  *"config.json"*) ok "the unparsable-config error names config.json" ;;
  *) bad "the unparsable-config error does not name config.json (got: $cfg_broken_msg)" ;;
esac

R_STATE_BROKEN="$(fresh)"; mkdir -p "$R_STATE_BROKEN/.somi/somi-state"
printf '{"ceiling": "low"\n' > "$R_STATE_BROKEN/.somi/somi-state/ceiling.json"  # missing closing brace
expect_exit "an unparsable .somi/somi-state/ceiling.json is a project-env failure (67)" 67 \
  "$R_STATE_BROKEN" resolve --agent coder
state_broken_msg="$(run "$R_STATE_BROKEN" resolve --agent coder 2>&1 >/dev/null || true)"
case "$state_broken_msg" in
  *"ceiling.json"*) ok "the unparsable-state error names ceiling.json" ;;
  *) bad "the unparsable-state error does not name ceiling.json (got: $state_broken_msg)" ;;
esac

# A malformed SOMI_COST_CEILING is the CALLER's input (same channel as --ceiling, just an env var
# instead of a flag), not the project's own persisted state -- classified 64 (usage), not 67, and
# -- the actual point of this guard -- rejected before resolveCeiling() ever touches disk, same as
# a bad --ceiling value above.
R_ENV_BAD="$(fresh)"
env_bad_rc=0
CLAUDE_PROJECT_DIR="$R_ENV_BAD" SOMI_COST_CEILING=critical node "$CLI" resolve --agent coder >/dev/null 2>&1 || env_bad_rc=$?
check "a malformed SOMI_COST_CEILING is a usage error (64), not a project-env failure" "$env_bad_rc" "64"
if [ -e "$R_ENV_BAD/.somi" ]; then
  bad "a rejected SOMI_COST_CEILING must be caught before the ceiling state is ever touched (found .somi/ in the project root)"
else
  ok "a rejected SOMI_COST_CEILING ('critical') leaves the project root untouched -- validated before resolveCeiling touches disk"
fi
envbad_msg="$(CLAUDE_PROJECT_DIR="$(fresh)" SOMI_COST_CEILING=critical node "$CLI" resolve --agent coder 2>&1 >/dev/null || true)"
case "$envbad_msg" in
  *"SOMI_COST_CEILING"*"critical"*) ok "the bad SOMI_COST_CEILING error names the variable and the rejected value" ;;
  *) bad "the bad SOMI_COST_CEILING error is unclear (got: $envbad_msg)" ;;
esac

# --- output shape: exactly the seven documented fields, and a real JSON array for `supported` -----
out="$(run "$(fresh)" resolve --agent coder --ceiling medium)"
check "JSON output carries exactly agent/ceiling/ceiling_origin/ceiling_source/model/supported/tier" \
  "$(node -e 'process.stdout.write(Object.keys(JSON.parse(process.argv[1])).sort().join("|"))' "$out")" \
  "agent|ceiling|ceiling_origin|ceiling_source|model|supported|tier"
check "coder's supported set is exactly [low, medium], echoing its declared frontmatter" \
  "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).supported.join(","))' "$out")" \
  "low,medium"

# --- ceiling_origin surfaces through the CLI, not just the library: the source/origin distinction
# that makes "ceiling_source: state" actionable round-trips through the JSON. ---------------------
out="$(run "$(fresh)" resolve --agent coder)"
check "fresh project, no override: ceiling_origin matches ceiling_source ('default')" \
  "$(field "$out" ceiling_origin)" "default"

R_ORIGIN="$(fresh)"; mkdir -p "$R_ORIGIN/.somi"
printf '{"cost": {"ceiling": "low"}}\n' > "$R_ORIGIN/.somi/config.json"
run "$R_ORIGIN" resolve --agent coder >/dev/null  # bootstrap from config
out="$(run "$R_ORIGIN" resolve --agent coder)"    # a later bare call: state now on disk
check "a later call: ceiling_source is 'state' but ceiling_origin still says 'config' -- actionable" \
  "$(field "$out" ceiling_source),$(field "$out" ceiling_origin)" "state,config"

# --- CRLF checkout (#28): a Windows clone with core.autocrlf rewrites agent files to CRLF; the
# frontmatter delimiter is then `---\r`, which must still parse. Run a copy of the install whose
# agent files are CRLF. -----------------------------------------------------------------------------
CRLF_INSTALL="$(fresh)"
cp -R "$ROOT_REPO/scripts" "$ROOT_REPO/agents" "$CRLF_INSTALL/"
for f in "$CRLF_INSTALL"/agents/*.md; do sed -i 's/$/\r/' "$f"; done
crlf_rc=0
out="$(CLAUDE_PROJECT_DIR="$(fresh)" node "$CRLF_INSTALL/scripts/somi-dispatch.mjs" resolve --agent planner --host copilot 2>&1)" || crlf_rc=$?
check "CRLF agent files: resolve exits 0 (was 66, 'declares no cost:')" "$crlf_rc" "0"
[ "$crlf_rc" = 0 ] && check "CRLF agent files: planner's supported set parses without a trailing CR" \
  "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).supported.join(","))' "$out")" "low,medium"

echo "somi-dispatch tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
