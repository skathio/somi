#!/usr/bin/env bash
# Unit guard for scripts/lib/cost-ceiling.mjs: the session cost ceiling.
#
# Exercises: re-resolution per dispatch across separate process invocations (state lives on disk,
# not in memory), a bare .somi/config.json edit cannot move a ceiling already recorded,
# hard-cap selection (no override: the ceiling tier itself, whatever was declared; the declared set
# only feeds `degraded`; the old never-degrade rule is reversed), and a
# malformed ceiling or declared set — from config, an env var, or an explicit argument — dying loudly
# instead of silently disabling the ceiling.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT_REPO/scripts/lib/cost-ceiling.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# Runs a snippet with the module imported as `C` and `ROOT` bound to a throwaway directory.
run() { node --input-type=module -e "const C = await import('$LIB'); const ROOT = '$1'; $2"; }
expect_exit() { # $1 = name, $2 = expected exit code, $3 = root, $4 = snippet
  local name="$1" want="$2" root="$3" snippet="$4" got=0
  run "$root" "$snippet" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then ok "$name"; else bad "$name (expected exit $want, got $got)"; fi
}

echo "== cost ceiling =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- bootstrap: no config, no env, no arg -> DEFAULT_CEILING, no overrides array yet -------------
A="$TMP/a"; mkdir -p "$A/.somi"
check "first resolve with nothing set bootstraps to the default" \
  "$(run "$A" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.ceiling + "," + r.overridden)')" \
  "high,false"
check "bootstrap writes state with no ceiling_overrides key (lazy creation)" \
  "$(run "$A" 'const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write(String("ceiling_overrides" in s))')" \
  "false"

# --- bootstrap reads .somi/config.json's cost.ceiling exactly once ------------------------------
B="$TMP/b"; mkdir -p "$B/.somi"
printf '{"cost": {"ceiling": "low"}}\n' > "$B/.somi/config.json"
check "bootstrap honours config's cost.ceiling" \
  "$(run "$B" 'process.stdout.write(C.resolveCeiling(ROOT, undefined).ceiling)')" \
  "low"

# The loop-cap precedent's central guard, mirrored: a bare config edit AFTER state exists must
# not move a ceiling already in force.
printf '{"cost": {"ceiling": "high"}}\n' > "$B/.somi/config.json"
check "a bare config edit after bootstrap does not move the ceiling already in force" \
  "$(run "$B" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.ceiling + "," + r.overridden)')" \
  "low,false"

# --- an explicit env var THIS call raises the ceiling and is recorded ---------------------------
out="$(SOMI_COST_CEILING=high node --input-type=module -e "const C = await import('$LIB'); const r = C.resolveCeiling('$B', undefined); process.stdout.write(r.ceiling+','+r.overridden+','+r.override.field+','+r.override.from+','+r.override.to+','+r.override.source)")"
check "env override moves the ceiling and reports it" "$out" "high,true,ceiling,low,high,env"
check "the override was persisted to disk, in a ceiling_overrides array" \
  "$(run "$B" 'const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write(s.ceiling_overrides.length + "," + s.ceiling_overrides[0].source)')" \
  "1,env"

# --- re-resolution: a later bare call keeps the raised ceiling, records no new entry -------------
check "a later bare call keeps the raised ceiling in force" \
  "$(run "$B" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.ceiling + "," + r.overridden)')" \
  "high,false"
check "no duplicate override entry was recorded for the bare call" \
  "$(run "$B" 'const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write(String(s.ceiling_overrides.length))')" \
  "1"

# --- an explicit argument beats an env var set in the SAME call ---------------------------------
out="$(SOMI_COST_CEILING=low node --input-type=module -e "const C = await import('$LIB'); const r = C.resolveCeiling('$B', 'medium'); process.stdout.write(r.ceiling+','+r.override.source+','+r.override.from)")"
check "explicit argument wins over env var, and is recorded with source cli" "$out" "medium,cli,high"

# --- resolveCeiling reports WHERE this call's ceiling came from -- this is what lets a dispatcher
# announce a `low` ceiling honestly, by its real source, not just its bare value. Additive field,
# checked independently of `ceiling`/`overridden` above so a caller that never reads it stays
# unaffected. ---------------------------------------------------------------------------------
DEF="$TMP/source-default"; mkdir -p "$DEF/.somi"
check "bootstrap with no config, no env, no arg: source is 'default'" \
  "$(run "$DEF" 'process.stdout.write(C.resolveCeiling(ROOT, undefined).source)')" \
  "default"

CFGSRC="$TMP/source-config"; mkdir -p "$CFGSRC/.somi"
printf '{"cost": {"ceiling": "low"}}\n' > "$CFGSRC/.somi/config.json"
check "bootstrap from .somi/config.json's cost.ceiling: source is 'config'" \
  "$(run "$CFGSRC" 'process.stdout.write(C.resolveCeiling(ROOT, undefined).source)')" \
  "config"
check "a later bare call against the same state: source is 'state', not 'config' again" \
  "$(run "$CFGSRC" 'process.stdout.write(C.resolveCeiling(ROOT, undefined).source)')" \
  "state"
check "an explicit CLI argument: source is 'cli' even when it matches the value already on disk" \
  "$(run "$CFGSRC" 'process.stdout.write(C.resolveCeiling(ROOT, "low").source)')" \
  "cli"
out="$(SOMI_COST_CEILING=low node --input-type=module -e "const C = await import('$LIB'); process.stdout.write(C.resolveCeiling('$CFGSRC', undefined).source)")"
check "an explicit env var: source is 'env'" "$out" "env"

# --- ceiling_origin: what actually produced the value now in force, distinct from `source` (what
# THIS call did). This is the field that makes "source: state" actionable -- see cost-ceiling.mjs's
# own doc comment. --------------------------------------------------------------------------------
ORIG_DEF="$TMP/origin-default"; mkdir -p "$ORIG_DEF/.somi"
check "bootstrap with nothing set: ceiling_origin is 'default', matching source on this first call" \
  "$(run "$ORIG_DEF" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.source + "," + r.ceiling_origin)')" \
  "default,default"

ORIG_CFG="$TMP/origin-config"; mkdir -p "$ORIG_CFG/.somi"
printf '{"cost": {"ceiling": "low"}}\n' > "$ORIG_CFG/.somi/config.json"
check "bootstrap from config: ceiling_origin is 'config', matching source on this first call" \
  "$(run "$ORIG_CFG" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.source + "," + r.ceiling_origin)')" \
  "config,config"
# The crux of the feature: a LATER bare call reports source "state" (nothing moved this call), but
# ceiling_origin still says "config" -- "saved state" alone would not explain why the user is at
# `low`; the origin does.
check "a later bare call: source is 'state', but ceiling_origin still says 'config' -- actionable" \
  "$(run "$ORIG_CFG" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.source + "," + r.ceiling_origin)')" \
  "state,config"

# An override updates ceiling_origin to track the value NOW in force, and a later bare call carries
# that origin forward too -- proving the disclosure survives across process invocations, not just
# within the one call that made the override.
ORIG_OVR="$TMP/origin-override"; mkdir -p "$ORIG_OVR/.somi"
out="$(SOMI_COST_CEILING=low node --input-type=module -e "const C = await import('$LIB'); const r = C.resolveCeiling('$ORIG_OVR', undefined); process.stdout.write(r.source + ',' + r.ceiling_origin)")"
check "an env override this call: source and ceiling_origin both report 'env'" "$out" "env,env"
check "a bare call after that override: source is 'state', ceiling_origin still says 'env'" \
  "$(run "$ORIG_OVR" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.source + "," + r.ceiling_origin)')" \
  "state,env"

# A CLI argument that matches the value already on disk records no override (per the existing
# no-duplicate-entry behavior above) -- ceiling_origin must therefore be left exactly as it was,
# not overwritten to "cli" for a value that didn't actually move.
ORIG_NOOP="$TMP/origin-noop"; mkdir -p "$ORIG_NOOP/.somi"
printf '{"cost": {"ceiling": "medium"}}\n' > "$ORIG_NOOP/.somi/config.json"
run "$ORIG_NOOP" 'C.resolveCeiling(ROOT, undefined)' >/dev/null # bootstrap from config first
check "a --ceiling matching the value already on disk: ceiling_origin is untouched (still 'config')" \
  "$(run "$ORIG_NOOP" 'const r = C.resolveCeiling(ROOT, "medium"); process.stdout.write(r.overridden + "," + r.source + "," + r.ceiling_origin)')" \
  "false,cli,config"

# M3: a state file written BEFORE ceiling_origin existed (this repo's own committed
# .somi/somi-state/ceiling.json is exactly this shape: {"ceiling":"high"}, no origin key at all) has
# no way to have set it -- absence is legacy, not corruption, and must not hard-fail. Reported as the
# distinct value 'unknown' rather than a guess. Contrast with ORIG_BADVAL below: PRESENT but wrong
# is still rejected.
ORIG_LEGACY="$TMP/origin-legacy"; mkdir -p "$ORIG_LEGACY/.somi/somi-state"
printf '{"ceiling": "high"}' > "$ORIG_LEGACY/.somi/somi-state/ceiling.json"
check "a state file predating ceiling_origin does not hard-fail; reports 'unknown'" \
  "$(run "$ORIG_LEGACY" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.ceiling + "," + r.ceiling_origin)')" \
  "high,unknown"

# M2: `ceiling_origin: "config"` goes stale when .somi/config.json's cost.ceiling changes to a
# DIFFERENT value after state already exists -- a bare edit still cannot MOVE the ceiling already in
# force (proven above), but continuing to report "config" would keep claiming a committed policy
# that no longer matches what's committed. Reported as "config-stale", never persisted.
ORIG_STALE="$TMP/origin-stale"; mkdir -p "$ORIG_STALE/.somi"
printf '{"cost": {"ceiling": "low"}}\n' > "$ORIG_STALE/.somi/config.json"
run "$ORIG_STALE" 'C.resolveCeiling(ROOT, undefined)' >/dev/null # bootstrap from config: low, origin config
printf '{"cost": {"ceiling": "high"}}\n' > "$ORIG_STALE/.somi/config.json" # config now says something else
check "config changed after bootstrap: ceiling stays put, ceiling_origin reports 'config-stale'" \
  "$(run "$ORIG_STALE" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write(r.ceiling + "," + r.overridden + "," + r.ceiling_origin)')" \
  "low,false,config-stale"
check "config-stale is never written back to the state file itself" \
  "$(run "$ORIG_STALE" 'const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write(s.ceiling_origin)')" \
  "config"

ORIG_REMOVED="$TMP/origin-removed"; mkdir -p "$ORIG_REMOVED/.somi"
printf '{"cost": {"ceiling": "medium"}}\n' > "$ORIG_REMOVED/.somi/config.json"
run "$ORIG_REMOVED" 'C.resolveCeiling(ROOT, undefined)' >/dev/null # bootstrap from config
printf '{}\n' > "$ORIG_REMOVED/.somi/config.json" # the policy is removed entirely, not just changed
check "config.json's cost.ceiling removed entirely after bootstrap: still reported 'config-stale'" \
  "$(run "$ORIG_REMOVED" 'process.stdout.write(C.resolveCeiling(ROOT, undefined).ceiling_origin)')" \
  "config-stale"

ORIG_UNCHANGED="$TMP/origin-unchanged"; mkdir -p "$ORIG_UNCHANGED/.somi"
printf '{"cost": {"ceiling": "low"}}\n' > "$ORIG_UNCHANGED/.somi/config.json"
run "$ORIG_UNCHANGED" 'C.resolveCeiling(ROOT, undefined)' >/dev/null # bootstrap
check "config.json unchanged after bootstrap: ceiling_origin stays plain 'config', not stale" \
  "$(run "$ORIG_UNCHANGED" 'process.stdout.write(C.resolveCeiling(ROOT, undefined).ceiling_origin)')" \
  "config"

# A ceiling_origin of 'cli'/'env'/'default' never gets the staleness check applied, even against a
# config.json that would otherwise look stale by value -- staleness is only ever about a 'config'
# claim specifically.
ORIG_NOTCONFIG="$TMP/origin-not-config"; mkdir -p "$ORIG_NOTCONFIG/.somi"
out="$(SOMI_COST_CEILING=low node --input-type=module -e "const C = await import('$LIB'); const r = C.resolveCeiling('$ORIG_NOTCONFIG', undefined); process.stdout.write(r.ceiling_origin)")"
check "bootstrap via env override: ceiling_origin is 'env', unaffected by the config-staleness check" "$out" "env"

# M3 + M2 do not interact: a legacy (no ceiling_origin) state file is never treated as possibly stale.
ORIG_LEGACY_CFG="$TMP/origin-legacy-cfg"; mkdir -p "$ORIG_LEGACY_CFG/.somi/somi-state"
mkdir -p "$ORIG_LEGACY_CFG/.somi"
printf '{"ceiling": "high"}' > "$ORIG_LEGACY_CFG/.somi/somi-state/ceiling.json"
printf '{"cost": {"ceiling": "low"}}\n' > "$ORIG_LEGACY_CFG/.somi/config.json"
check "a legacy state file with a differing config.json still reports 'unknown', not 'config-stale'" \
  "$(run "$ORIG_LEGACY_CFG" 'process.stdout.write(C.resolveCeiling(ROOT, undefined).ceiling_origin)')" \
  "unknown"

ORIG_BADVAL="$TMP/origin-badval"; mkdir -p "$ORIG_BADVAL/.somi/somi-state"
printf '{"ceiling": "low", "ceiling_origin": "bogus"}' > "$ORIG_BADVAL/.somi/somi-state/ceiling.json"
expect_exit "a present state file with an invalid (not merely absent) ceiling_origin value dies loudly" 1 \
  "$ORIG_BADVAL" 'C.resolveCeiling(ROOT, undefined)'

# --- an UNPARSABLE state file (bad JSON, not just a wrong shape) dies loudly and names the file --
STATE_BROKEN="$TMP/state-broken"; mkdir -p "$STATE_BROKEN/.somi/somi-state"
printf '{"ceiling": "low"\n' > "$STATE_BROKEN/.somi/somi-state/ceiling.json"  # missing closing brace
expect_exit "an unparsable state file dies loudly rather than a bare uncaught SyntaxError" 1 \
  "$STATE_BROKEN" 'C.resolveCeiling(ROOT, undefined)'
check "the unparsable-state error names the ceiling.json file path, not a bare JSON position" \
  "$(run "$STATE_BROKEN" 'try { C.resolveCeiling(ROOT, undefined); } catch (e) { process.stdout.write(String(e.message.includes("ceiling.json"))); }')" \
  "true"

# --- malformed values die loudly, never silently defang the ceiling -----------------------------
expect_exit "a malformed explicit argument is rejected (uncaught, not swallowed)" 1 \
  "$B" 'C.resolveCeiling(ROOT, "unlimited")'
expect_exit "a malformed env var is rejected" 1 \
  "$B" 'process.env.SOMI_COST_CEILING = "unlimited"; C.resolveCeiling(ROOT, undefined)'
check "a rejected malformed value leaves the on-disk ceiling and override count untouched" \
  "$(run "$B" 'const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write(s.ceiling + "," + s.ceiling_overrides.length)')" \
  "medium,2"

CFG="$TMP/c"; mkdir -p "$CFG/.somi"
printf '{"cost": {"ceiling": "unlimited"}}\n' > "$CFG/.somi/config.json"
expect_exit "a malformed config-sourced ceiling dies loudly at bootstrap" 1 \
  "$CFG" 'C.resolveCeiling(ROOT, undefined)'
check "a failed bootstrap leaves no state file behind" \
  "$(run "$CFG" 'const fs = await import("node:fs"); process.stdout.write(String(fs.existsSync(C.ceilingStatePath(ROOT))))')" \
  "false"

# --- a wrong-shaped `cost` container fails closed, not open to the loosest ceiling --------------
SHAPE1="$TMP/shape1"; mkdir -p "$SHAPE1/.somi"; printf '{"cost": "low"}' > "$SHAPE1/.somi/config.json"
expect_exit "a cost key that is a string, not an object, dies loudly rather than defaulting" 1 \
  "$SHAPE1" 'C.resolveCeiling(ROOT, undefined)'
SHAPE2="$TMP/shape2"; mkdir -p "$SHAPE2/.somi"; printf '{"cost": {"celing": "low"}}' > "$SHAPE2/.somi/config.json"
expect_exit "a typo'd key inside cost dies loudly rather than falling back to the default" 1 \
  "$SHAPE2" 'C.resolveCeiling(ROOT, undefined)'
SHAPE3="$TMP/shape3"; mkdir -p "$SHAPE3/.somi"; printf '{"ceiling": "low"}' > "$SHAPE3/.somi/config.json"
expect_exit "a ceiling key at the top level (outside cost) dies loudly, not silently ignored" 1 \
  "$SHAPE3" 'C.resolveCeiling(ROOT, undefined)'

# --- an UNPARSABLE config.json (bad JSON, not just a wrong shape) dies loudly too, never {} ------
BROKEN="$TMP/broken"; mkdir -p "$BROKEN/.somi"
printf '{"cost": {"ceiling": "low"}\n' > "$BROKEN/.somi/config.json"  # missing closing brace
expect_exit "an unparsable config.json dies loudly rather than silently resolving to {}" 1 \
  "$BROKEN" 'C.resolveCeiling(ROOT, undefined)'
broken_out="$(run "$BROKEN" 'C.resolveCeiling(ROOT, undefined); process.stdout.write("SHOULD-NOT-PRINT")' 2>/dev/null)"
check "an unparsable config.json produces no stdout before dying" "$broken_out" ""
check "the unparsable-config error names the config file path" \
  "$(run "$BROKEN" 'try { C.resolveCeiling(ROOT, undefined); } catch (e) { process.stdout.write(String(e.message.includes("config.json"))); }')" \
  "true"
check "an unparsable config leaves no state file behind" \
  "$(run "$BROKEN" 'const fs = await import("node:fs"); process.stdout.write(String(fs.existsSync(C.ceilingStatePath(ROOT))))')" \
  "false"

# --- a present state file with a semantically corrupt ceiling dies loudly, not silently ---------
CORRUPT="$TMP/corrupt"; mkdir -p "$CORRUPT/.somi/somi-state"
printf '{}' > "$CORRUPT/.somi/somi-state/ceiling.json"
expect_exit "a present state file missing its ceiling key dies loudly" 1 \
  "$CORRUPT" 'C.resolveCeiling(ROOT, undefined)'
check "the thrown message names the state file, not a flag or env var" \
  "$(run "$CORRUPT" 'try { C.resolveCeiling(ROOT, undefined); } catch (e) { process.stdout.write(String(e.message.includes("ceiling.json"))); }')" \
  "true"

# --- decideDispatch: the ceiling is a HARD cap. With no override the selected tier IS the ceiling,
# whatever the unit declared; the declared set (a capability set) is echoed in `supported` and used
# only to compute `degraded`. A bare string is a one-member set. The old never-degrade rule (run at
# the cheapest declared member when none fits) is reversed. Override / source cases: cost-hardcap.sh.
# Each case prints action,selected,supported,degraded,tier_source.
dd() { run "$B" "const d = C.decideDispatch($1); process.stdout.write([d.action, d.selected, d.supported.join('|'), d.degraded, d.tier_source].join(','))"; }

check "one-member set under a higher ceiling: runs at the ceiling, not degraded" \
  "$(dd '"low", "high"')" "allow,high,low,false,ceiling"
check "single-high declaration under a medium ceiling: clamped to medium, degraded" \
  "$(dd '"high", "medium"')" "allow,medium,high,true,ceiling"
check "single-high declaration under a low ceiling: clamped to low, degraded" \
  "$(dd '["high"], "low"')" "allow,low,high,true,ceiling"
check "two-member set [medium,high], ceiling low: clamped to low, below every declared member" \
  "$(dd '["medium","high"], "low"')" "allow,low,medium|high,true,ceiling"
check "two-member set [medium,high], ceiling medium: medium, degraded (below its highest member)" \
  "$(dd '["medium","high"], "medium"')" "allow,medium,medium|high,true,ceiling"
check "two-member set [medium,high], ceiling high: high, not degraded" \
  "$(dd '["medium","high"], "high"')" "allow,high,medium|high,false,ceiling"
check "three-member set, ceiling low: low, degraded" \
  "$(dd '["low","medium","high"], "low"')" "allow,low,low|medium|high,true,ceiling"
check "three-member set, ceiling medium: medium, degraded" \
  "$(dd '["low","medium","high"], "medium"')" "allow,medium,low|medium|high,true,ceiling"
check "three-member set, ceiling high: high, not degraded" \
  "$(dd '["low","medium","high"], "high"')" "allow,high,low|medium|high,false,ceiling"

# Sweep: without an override, selected is exactly the ceiling for every set x ceiling; the selected
# tier may be outside the declared set, and degraded is exactly "selected below the top member".
check "no override: selected === ceiling and degraded matches rank, across every set x ceiling" \
  "$(run "$B" 'const sets=[["low"],["medium"],["high"],["low","medium"],["medium","high"],["low","high"],["low","medium","high"]]; const R={low:0,medium:1,high:2}; let bad=0; for (const s of sets) for (const c of ["low","medium","high"]) { const d=C.decideDispatch(s,c); if (d.action!=="allow"||d.selected!==c||d.tier_source!=="ceiling") bad++; if (d.degraded !== (R[c] < R[s[s.length-1]])) bad++; } process.stdout.write(String(bad))')" \
  "0"

check "the decision object is frozen -- a caller cannot rewrite the selection after the fact" \
  "$(run "$B" 'const d = C.decideDispatch(["low","high"], "high"); try { d.selected = "low"; } catch {} process.stdout.write(d.selected)')" \
  "high"
check "the supported array itself is frozen too, not just the decision object wrapping it" \
  "$(run "$B" 'const d = C.decideDispatch(["low","high"], "high"); const before = d.supported.length; try { d.supported.push("medium"); } catch {} process.stdout.write(String(d.supported.length === before))')" \
  "true"
check "the allow shape carries exactly action, ceiling, degraded, selected, supported, tier_source" \
  "$(run "$B" 'process.stdout.write(Object.keys(C.decideDispatch(["low","high"], "high")).sort().join("|"))')" \
  "action|ceiling|degraded|selected|supported|tier_source"
expect_exit "an unrecognized cost value throws rather than silently allowing" 1 \
  "$B" 'C.decideDispatch("critical", "high")'
expect_exit "an unrecognized ceiling value throws rather than silently allowing" 1 \
  "$B" 'C.decideDispatch("low", "critical")'
expect_exit "an unordered declared set (high before medium) throws rather than being silently sorted" 1 \
  "$B" 'C.decideDispatch(["high","medium"], "high")'
expect_exit "a duplicate in the declared set throws" 1 \
  "$B" 'C.decideDispatch(["medium","medium"], "high")'
expect_exit "an empty declared set throws rather than resolving to no-capability-silently" 1 \
  "$B" 'C.decideDispatch([], "high")'

# --- modelForDispatch: the sanctioned composition from a decideDispatch decision ----------------
check "modelForDispatch resolves the model for the SELECTED tier, not just any declared member" \
  "$(run "$B" 'process.stdout.write(C.modelForDispatch(C.decideDispatch(["low","medium"],"medium"), "claude-code"))')" \
  "sonnet"
check "modelForDispatch on a one-member set resolves the CEILING tier's model (hard cap), not the member's" \
  "$(run "$B" 'process.stdout.write(C.modelForDispatch(C.decideDispatch("low","high"), "claude-code"))')" \
  "opus"
check "modelForDispatch follows an override above the ceiling" \
  "$(run "$B" 'process.stdout.write(C.modelForDispatch(C.decideDispatch("low","low","high"), "claude-code"))')" \
  "opus"
# decideDispatch itself can only produce "allow" -- the guard is unreachable by construction, but it
# is still exercised directly against a hand-built non-allow shape, so the backstop stays proven.
expect_exit "modelForDispatch refuses a decision shaped as anything but allow" 1 \
  "$B" 'C.modelForDispatch({ action: "refuse", supported: ["high"], ceiling: "low" }, "claude-code")'
expect_exit "modelForDispatch refuses a missing decision" 1 \
  "$B" 'C.modelForDispatch(undefined, "claude-code")'

echo "cost ceiling tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
bash "$(dirname "${BASH_SOURCE[0]}")/cost-hardcap.sh" || exit 1
