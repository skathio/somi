#!/usr/bin/env bash
# Unit guard for scripts/lib/cost-ceiling.mjs: the session cost ceiling.
#
# Exercises: re-resolution per dispatch across separate process invocations (state lives on disk,
# not in memory), a bare .somi/config.json edit cannot move a ceiling already recorded, the
# three-way ask/refuse/never-degrade split, and a malformed ceiling value — from config, an env
# var, or an explicit argument — dying loudly instead of silently disabling the ceiling.
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

# --- a present state file with a semantically corrupt ceiling dies loudly, not silently ---------
CORRUPT="$TMP/corrupt"; mkdir -p "$CORRUPT/.somi/somi-state"
printf '{}' > "$CORRUPT/.somi/somi-state/ceiling.json"
expect_exit "a present state file missing its ceiling key dies loudly" 1 \
  "$CORRUPT" 'C.resolveCeiling(ROOT, undefined)'
check "the thrown message names the state file, not a flag or env var" \
  "$(run "$CORRUPT" 'try { C.resolveCeiling(ROOT, undefined); } catch (e) { process.stdout.write(String(e.message.includes("ceiling.json"))); }')" \
  "true"

# --- decideDispatch: the three-way ask / refuse / never-degrade split ---------------------------
check "cost within ceiling: allow, cost echoed unchanged" \
  "$(run "$B" 'const d = C.decideDispatch("low", "high", true); process.stdout.write(d.action + "," + d.cost)')" \
  "allow,low"
check "over ceiling, interactive: ask, naming the cost, cost echoed unchanged" \
  "$(run "$B" 'const d = C.decideDispatch("high", "low", true); process.stdout.write(d.action + "," + d.cost + "," + d.message.includes("high"))')" \
  "ask,high,true"
check "over ceiling, non-interactive: refuse, cost echoed unchanged, reason recorded" \
  "$(run "$B" 'const d = C.decideDispatch("high", "low", false); process.stdout.write(d.action + "," + d.cost + "," + (d.reason.length > 0))')" \
  "refuse,high,true"
check "no branch ever substitutes a different cost: allow/ask/refuse all echo the input" \
  "$(run "$B" 'const a = C.decideDispatch("medium", "medium", true).cost; const b = C.decideDispatch("high", "low", true).cost; const c = C.decideDispatch("high", "low", false).cost; process.stdout.write([a,b,c].join(","))')" \
  "medium,high,high"
check "the decision object is frozen -- a caller cannot rewrite the cost after the fact" \
  "$(run "$B" 'const d = C.decideDispatch("high", "low", false); try { d.cost = "low"; } catch {} process.stdout.write(d.cost)')" \
  "high"
check "the ask/refuse shapes carry no field a caller could read as a substitute cost" \
  "$(run "$B" 'const ask = Object.keys(C.decideDispatch("high", "low", true)).sort().join("|"); const refuse = Object.keys(C.decideDispatch("high", "low", false)).sort().join("|"); process.stdout.write(ask + " / " + refuse)')" \
  "action|ceiling|cost|message / action|ceiling|cost|reason"
expect_exit "an unrecognized cost value throws rather than silently allowing" 1 \
  "$B" 'C.decideDispatch("critical", "high", true)'
expect_exit "an unrecognized ceiling value throws rather than silently allowing" 1 \
  "$B" 'C.decideDispatch("low", "critical", true)'

# --- modelForDispatch: the sanctioned composition, structurally unable to degrade ---------------
check "modelForDispatch resolves the model for an allow decision" \
  "$(run "$B" 'process.stdout.write(C.modelForDispatch(C.decideDispatch("low","high",true), "claude-code"))')" \
  "haiku"
expect_exit "modelForDispatch refuses an ask decision -- ceiling is never read as a substitute cost" 1 \
  "$B" 'C.modelForDispatch(C.decideDispatch("high","low",true), "claude-code")'
expect_exit "modelForDispatch refuses a refuse decision" 1 \
  "$B" 'C.modelForDispatch(C.decideDispatch("high","low",false), "claude-code")'

echo "cost ceiling tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
