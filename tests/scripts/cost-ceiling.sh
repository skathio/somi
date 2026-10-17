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

# State file helper: prints the persisted state as compact JSON, or "none".
state() { run "$1" 'const fs = await import("node:fs"); const f = C.ceilingStatePath(ROOT); process.stdout.write(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "none")'; }
res() { run "$1" 'const r = C.resolveCeiling(ROOT, undefined); process.stdout.write([r.ceiling, r.overridden, r.source, r.ceiling_origin].join(","))'; }

# --- nothing set: the built-in default is medium, and nothing is written ------------------------
A="$TMP/a"; mkdir -p "$A/.somi"
check "no config, no state, no env, no arg: medium, from the default" "$(res "$A")" "medium,false,default,default"
check "... and a resolve with nothing explicit writes no state file" "$(state "$A")" "none"
check "DEFAULT_CEILING is medium" "$(run "$A" 'process.stdout.write(C.DEFAULT_CEILING)')" "medium"

# --- config is read LIVE: an edit between two resolves moves the ceiling -------------------------
B="$TMP/b"; mkdir -p "$B/.somi"
printf '{"cost": {"ceiling": "low"}}\n' > "$B/.somi/config.json"
check "config's cost.ceiling is honoured" "$(res "$B")" "low,false,config,config"
printf '{"cost": {"ceiling": "high"}}\n' > "$B/.somi/config.json"
check "a bare config edit moves the ceiling on the very next resolve (config is live)" "$(res "$B")" "high,false,config,config"
printf '{}\n' > "$B/.somi/config.json"
check "removing cost.ceiling from the config falls back to the default" "$(res "$B")" "medium,false,default,default"
check "config-only resolves never write state" "$(state "$B")" "none"

# --- CLI/env beat config, and are persisted with their origin ------------------------------------
printf '{"cost": {"ceiling": "low"}}\n' > "$B/.somi/config.json"
out="$(SOMI_COST_CEILING=high node --input-type=module -e "const C = await import('$LIB'); const r = C.resolveCeiling('$B', undefined); process.stdout.write(r.ceiling+','+r.overridden+','+r.source+','+r.override.field+','+r.override.from+','+r.override.to+','+r.override.source)")"
check "env value beats config, and the override record names what was in force" "$out" "high,true,env,ceiling,low,high,env"
check "the override was persisted with origin env and a one-entry ceiling_overrides" \
  "$(run "$B" 'const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write([s.ceiling, s.ceiling_origin, s.ceiling_overrides.length, s.ceiling_overrides[0].source].join(","))')" \
  "high,env,1,env"

# Config OUTRANKS a persisted cli/env ceiling (it is live; state only fills in when config is silent).
check "persisted env ceiling is outranked by cost.ceiling in config (config > persisted state)" \
  "$(res "$B")" "low,false,config,config"
printf '{}\n' > "$B/.somi/config.json"
check "with config silent, the persisted env ceiling stands: source state, origin env" \
  "$(res "$B")" "high,false,state,env"
printf '{"cost": {"ceiling": "low"}}\n' > "$B/.somi/config.json"
check "no duplicate override entry was recorded by the bare calls" \
  "$(run "$B" 'const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write(String(s.ceiling_overrides.length))')" \
  "1"

# --- an explicit argument beats an env var set in the SAME call ---------------------------------
out="$(SOMI_COST_CEILING=low node --input-type=module -e "const C = await import('$LIB'); const r = C.resolveCeiling('$B', 'medium'); process.stdout.write(r.ceiling+','+r.override.source+','+r.override.from+','+r.ceiling_origin)")"
check "explicit argument wins over env, is recorded with source cli; from is the ceiling in force" "$out" "medium,cli,low,cli"
check "an explicit CLI value matching what config gives still reports source cli and persists origin cli" \
  "$(run "$B" 'const r = C.resolveCeiling(ROOT, "low"); process.stdout.write([r.overridden, r.source, r.ceiling_origin].join(","))')" \
  "false,cli,cli"
check "... the persisted origin is now cli" \
  "$(run "$B" 'const fs = await import("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")).ceiling_origin)')" "cli"
out="$(SOMI_COST_CEILING=low node --input-type=module -e "const C = await import('$LIB'); process.stdout.write(C.resolveCeiling('$B', undefined).source)")"
check "an explicit env var: source is 'env'" "$out" "env"

# --- a persisted ceiling that was NOT set by cli/env yields to config and to the default ---------
STATES="$TMP/states"
for spec in 'legacy|{"ceiling":"high"}' 'default-origin|{"ceiling":"high","ceiling_origin":"default"}' 'config-origin|{"ceiling":"high","ceiling_origin":"config"}'; do
  name="${spec%%|*}"; body="${spec#*|}"
  d="$STATES-$name"; mkdir -p "$d/.somi/somi-state"; printf '%s' "$body" > "$d/.somi/somi-state/ceiling.json"
  check "$name fixture was written" "$(state "$d")" "$body"
  check "$name state (high) yields to the medium default" "$(res "$d")" "medium,false,default,default"
  printf '{"cost": {"ceiling": "low"}}\n' > "$d/.somi/config.json"
  check "$name state (high) yields to config low" "$(res "$d")" "low,false,config,config"
  rm "$d/.somi/config.json"
done
# A state file written before origins were recorded: just {"ceiling":"high"}.
LEG="$TMP/legacy-literal"; mkdir -p "$LEG/.somi/somi-state"; printf '{"ceiling":"high"}' > "$LEG/.somi/somi-state/ceiling.json"
check "the legacy fixture really holds high" "$(state "$LEG")" '{"ceiling":"high"}'
check "a legacy state file does not outrank the default" "$(res "$LEG")" "medium,false,default,default"
d="$STATES-cli"; mkdir -p "$d/.somi/somi-state"; printf '{"ceiling":"low","ceiling_origin":"cli"}' > "$d/.somi/somi-state/ceiling.json"
check "a cli-origin state (low) does apply when config is silent" "$(res "$d")" "low,false,state,cli"
printf '{"cost": {"ceiling": "high"}}\n' > "$d/.somi/config.json"
check "... and config high outranks it" "$(res "$d")" "high,false,config,config"
d="$STATES-yield-write"; mkdir -p "$d/.somi/somi-state"; printf '{"ceiling":"high"}' > "$d/.somi/somi-state/ceiling.json"
run "$d" 'C.resolveCeiling(ROOT, undefined)' >/dev/null
check "a yielding legacy state file is left untouched by a bare resolve" "$(state "$d")" '{"ceiling":"high"}'
check "an explicit value persists over a legacy state file, with origin" \
  "$(run "$d" 'C.resolveCeiling(ROOT, "low"); const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write(s.ceiling + "," + s.ceiling_origin + "," + s.ceiling_overrides[0].from)')" \
  "low,cli,medium"

check "a present state file with an invalid (not merely absent) ceiling_origin value dies loudly" \
  "$(run "$STATES-yield-write" 'const fs = await import("node:fs"); fs.writeFileSync(C.ceilingStatePath(ROOT), JSON.stringify({ceiling:"low",ceiling_origin:"bogus"})); try { C.resolveCeiling(ROOT, undefined); process.stdout.write("no"); } catch { process.stdout.write("threw"); }')" \
  "threw"
check "config-stale is gone: no resolve ever reports it" \
  "$(run "$B" 'process.stdout.write(String(JSON.stringify(C.resolveCeiling(ROOT, undefined)).includes("stale")))')" "false"

# --- an UNPARSABLE state file (bad JSON, not just a wrong shape) dies loudly and names the file --
STATE_BROKEN="$TMP/state-broken"; mkdir -p "$STATE_BROKEN/.somi/somi-state"
printf '{"ceiling": "low"\n' > "$STATE_BROKEN/.somi/somi-state/ceiling.json"  # missing closing brace
expect_exit "an unparsable state file dies loudly rather than a bare uncaught SyntaxError" 1 \
  "$STATE_BROKEN" 'C.resolveCeiling(ROOT, undefined)'
check "the unparsable-state error names the ceiling.json file path, not a bare JSON position" \
  "$(run "$STATE_BROKEN" 'try { C.resolveCeiling(ROOT, undefined); } catch (e) { process.stdout.write(String(e.message.includes("ceiling.json"))); }')" \
  "true"
SYMS="$TMP/state-symlink"; mkdir -p "$SYMS/.somi/somi-state"; printf '{"ceiling":"low","ceiling_origin":"cli"}' > "$SYMS/real.json"
ln -s ../../real.json "$SYMS/.somi/somi-state/ceiling.json"
expect_exit "a symlinked state file is refused rather than followed" 1 "$SYMS" 'C.resolveCeiling(ROOT, undefined)'

# --- malformed values die loudly, never silently defang the ceiling -----------------------------
M="$TMP/m"; mkdir -p "$M/.somi"
run "$M" 'C.resolveCeiling(ROOT, "low")' >/dev/null; run "$M" 'C.resolveCeiling(ROOT, "high")' >/dev/null
expect_exit "a malformed explicit argument is rejected (uncaught, not swallowed)" 1 \
  "$M" 'C.resolveCeiling(ROOT, "unlimited")'
expect_exit "a malformed env var is rejected" 1 \
  "$M" 'process.env.SOMI_COST_CEILING = "unlimited"; C.resolveCeiling(ROOT, undefined)'
check "a rejected malformed value leaves the on-disk ceiling and override count untouched" \
  "$(run "$M" 'const fs = await import("node:fs"); const s = JSON.parse(fs.readFileSync(C.ceilingStatePath(ROOT), "utf8")); process.stdout.write(s.ceiling + "," + s.ceiling_overrides.length)')" \
  "high,2"

CFG="$TMP/c"; mkdir -p "$CFG/.somi"
printf '{"cost": {"ceiling": "unlimited"}}\n' > "$CFG/.somi/config.json"
expect_exit "a malformed config-sourced ceiling dies loudly" 1 \
  "$CFG" 'C.resolveCeiling(ROOT, undefined)'
check "a failed config read leaves no state file behind" \
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
bash "$(dirname "${BASH_SOURCE[0]}")/cost-defaults.sh" || exit 1
bash "$(dirname "${BASH_SOURCE[0]}")/ensure-default-config.sh" || exit 1
bash "$(dirname "${BASH_SOURCE[0]}")/somi-config.sh" || exit 1
bash "$(dirname "${BASH_SOURCE[0]}")/cost-lowering.sh" || exit 1
