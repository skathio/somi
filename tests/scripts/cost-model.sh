#!/usr/bin/env bash
# Unit guard for scripts/lib/cost-model.mjs: the cost -> model resolver.
#
# Exercises the three required behaviors: a known (cost, host) pair resolves to its mapped model,
# an unmapped host falls back to no override (its own default) without erroring, and an
# unrecognized cost value — or a mapped host missing that tier — throws rather than silently
# defaulting.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/cost-model.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# Runs a snippet with the resolver imported as `M`. A function so no case can forget the import
# path and silently test nothing.
run() { node --input-type=module -e "const M = await import('$LIB'); $1"; }
expect_exit() { # $1 = name, $2 = expected exit code, $3 = snippet run via run()
  local name="$1" want="$2" snippet="$3" got=0
  run "$snippet" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then ok "$name"; else bad "$name (expected exit $want, got $got)"; fi
}

echo "== cost model resolver =="

# --- a known (cost, host) pair resolves to its mapped model ----------------------
check "low/claude-code resolves to haiku" \
  "$(run 'process.stdout.write(M.resolveModel("low", "claude-code"))')" "haiku"
check "medium/claude-code resolves to sonnet" \
  "$(run 'process.stdout.write(M.resolveModel("medium", "claude-code"))')" "sonnet"
check "high/claude-code resolves to opus" \
  "$(run 'process.stdout.write(M.resolveModel("high", "claude-code"))')" "opus"
expect_exit "a known pair resolves without throwing" 0 \
  'M.resolveModel("medium", "claude-code")'

# --- an unmapped host falls back to its own default, without erroring ------------
check "unmapped host returns null (no override), not a guessed model" \
  "$(run 'process.stdout.write(String(M.resolveModel("medium", "some-future-host")))')" "null"
expect_exit "an unmapped host does not error" 0 \
  'M.resolveModel("medium", "some-future-host")'
check "a prototype-chain host name is treated as unmapped, not inherited" \
  "$(run 'process.stdout.write(String(M.resolveModel("medium", "constructor")))')" "null"

# --- a mapped model value must look like a model identifier, not just any non-empty string ------
# Built from harmless shell metacharacters -- never a destructive command.
HOSTILE_MODEL='opus; echo pwned; `id`; $(id)'
expect_exit "a hostile mapped model value is rejected, not resolved" 1 \
  "M.resolveModel(\"high\", \"hostile-host\", { \"hostile-host\": { \"high\": \"$HOSTILE_MODEL\" } })"
hostile_out="$(run "process.stdout.write(M.resolveModel(\"high\", \"hostile-host\", { \"hostile-host\": { \"high\": \"$HOSTILE_MODEL\" } }))" 2>/dev/null)"
check "the hostile model value produces no stdout before dying" "$hostile_out" ""
check "the thrown error names the bad value, not a generic message" \
  "$(run "try { M.resolveModel(\"high\", \"hostile-host\", { \"hostile-host\": { \"high\": \"$HOSTILE_MODEL\" } }); } catch (e) { process.stdout.write(String(e.message.includes('is not a valid model identifier'))); }")" \
  "true"
check "every shipped HOST_MODELS value passes the model-identifier pattern" \
  "$(run 'let bad = 0; for (const host of Object.keys(M.HOST_MODELS)) { for (const c of M.VALID_COSTS) { try { M.resolveModel(c, host); } catch { bad++; } } } process.stdout.write(String(bad))')" \
  "0"

# --- an unrecognized cost value fails loudly, never silently ---------------------
expect_exit "an invalid cost value throws (uncaught, not swallowed)" 1 \
  'M.resolveModel("critical", "claude-code")'
check "the thrown error names the bad value, not a generic message" \
  "$(run 'try { M.resolveModel("critical", "claude-code"); } catch (e) { process.stdout.write(e.message); }')" \
  'cost-model: unrecognized cost "critical" (expected one of low|medium|high)'

# --- a mapped host missing that specific tier is malformed data, not a silent default --
expect_exit "a mapped host missing the requested tier throws, not undefined" 1 \
  'M.resolveModel("high", "partial-host", { "partial-host": { "medium": "x" } })'
check "the thrown error for a missing tier names the host and tier, not a generic message" \
  "$(run 'try { M.resolveModel("high", "partial-host", { "partial-host": { "medium": "x" } }); } catch (e) { process.stdout.write(e.message); }')" \
  'cost-model: host "partial-host" has no "high" entry in its mapping'

# --- mergeHostMapping: the config-driven-override seam resolveModel's third arg composes with ---
check "a new host from the override is merged in" \
  "$(run 'process.stdout.write(M.resolveModel("low", "extra-host", M.mergeHostMapping(M.HOST_MODELS, { "extra-host": { "low": "x" } })))')" \
  "x"
check "an override for an existing host replaces its whole tier map, not merged tier-by-tier" \
  "$(run 'const merged = M.mergeHostMapping(M.HOST_MODELS, { "claude-code": { "low": "y" } }); process.stdout.write(String(merged["claude-code"].medium))')" \
  "undefined"
check "an unmapped host stays unmapped when the override does not name it" \
  "$(run 'const merged = M.mergeHostMapping(M.HOST_MODELS, { "extra-host": { "low": "x" } }); process.stdout.write(String(merged["some-other-host"]))')" \
  "undefined"
check "no override at all returns the defaults unchanged" \
  "$(run 'process.stdout.write(String(M.mergeHostMapping(M.HOST_MODELS, undefined) === M.HOST_MODELS))')" \
  "true"
expect_exit "a __proto__ key in a JSON.parse'd override is rejected, not silently absorbed" 1 \
  'M.mergeHostMapping(M.HOST_MODELS, JSON.parse(`{"__proto__": {"low": "x"}}`))'
check "rejecting a __proto__ key does not pollute Object.prototype" \
  "$(run 'try { M.mergeHostMapping(M.HOST_MODELS, JSON.parse(`{"__proto__": {"low": "x"}}`)); } catch {} process.stdout.write(String(({}).low))')" \
  "undefined"
expect_exit "a non-object override is rejected" 1 \
  'M.mergeHostMapping(M.HOST_MODELS, "not-an-object")'
expect_exit "a non-object per-host value in the override is rejected, not passed through" 1 \
  'M.mergeHostMapping(M.HOST_MODELS, { "h": "sonnet" })'
expect_exit "a null per-host value in the override is rejected, not a bare TypeError later" 1 \
  'M.mergeHostMapping(M.HOST_MODELS, { "h": null })'

# --- mergeHostMapping rejects a tier key outside low|medium|high -- a typo'd tier would otherwise
# sit unused forever, unflagged, since resolveModel() only ever looks up the tier actually selected.
expect_exit "a tier key outside low|medium|high is rejected" 1 \
  'M.mergeHostMapping(M.HOST_MODELS, { "some-host": { "lo": "x" } })'
check "the rejected tier key error names the bad key, the host, and the valid set" \
  "$(run 'try { M.mergeHostMapping(M.HOST_MODELS, { "some-host": { "lo": "x" } }); } catch (e) { process.stdout.write(e.message); }')" \
  'cost-model: mapping override for host "some-host" has an unrecognized tier key "lo" (expected one of low|medium|high)'
expect_exit "a valid tier key alongside an invalid one still rejects the whole per-host override" 1 \
  'M.mergeHostMapping(M.HOST_MODELS, { "h": { "low": "x", "typo": "y" } })'
check "a mapping with only valid tier keys is unaffected by the new check" \
  "$(run 'process.stdout.write(M.resolveModel("low", "h", M.mergeHostMapping(M.HOST_MODELS, { "h": { "low": "x" } })))')" \
  "x"


# --- scripts/validate.sh's own derivation idiom stays capture-then-check, not a bare eval --------
# validate.sh builds its cost/model environment from this resolver via a shell idiom: assign the
# node call's stdout to a plain variable with an explicit `|| { ...; exit 1; }`, THEN eval the
# variable -- never `eval "$(node -e ...)"` directly. A PARTIAL failure (one tier's resolveModel
# call throws after earlier tiers already printed) exits node non-zero, but a bare eval hides that
# status from `set -e`: the failing substitution is only an argument being built for eval, not the
# exit status of a simple command, so the earlier assignments land silently and the surrounding
# checks report PASSED with the missing tier never having been derived. Two independent instruments
# below, covering two different things -- neither substitutes for the other: the shape checks read
# the REAL `scripts/validate.sh` and are the only coverage that file's own form actually has
# (literal revert, or the script-form bypass below); the behavioral reproduction that follows runs
# a hardcoded COPY of the idiom -- it never opens `validate.sh` -- and only pins that the
# capture-then-check shell idiom itself, in the abstract, still exits 1 and reports its diagnostic
# under a genuinely partial derivation failure. A rewrite of `validate.sh` that changes its form
# without losing this property would pass the shape checks (correctly) but is not exercised by the
# behavioral block at all.
VALIDATE="$ROOT/scripts/validate.sh"
if grep -qF 'cost_env="$(node -e' "$VALIDATE"; then
  ok "validate.sh still captures the cost-model derivation into a plain variable before checking it"
else
  bad "validate.sh no longer captures the cost-model derivation into cost_env -- the guard may have been reverted"
fi
if grep -qF 'cost-model derivation failed; cannot validate cost tiers' "$VALIDATE"; then
  ok "validate.sh still has an explicit failure diagnostic for the derivation"
else
  bad "validate.sh's derivation-failure diagnostic is gone"
fi
if grep -vE '^[[:space:]]*#' "$VALIDATE" | grep -qE 'eval[[:space:]]+"\$\(node|source[[:space:]]+<\(node'; then
  bad "validate.sh evaluates or sources a node derivation directly (bare eval \"\$(node ...)\" or source <(node ...)) -- set -e cannot see a partial failure through either form"
else
  ok "validate.sh does not eval or source a node derivation directly (outside comments) -- the capture-then-check form is intact"
fi

# The previous literal `eval "$(node -e` match missed a script-form bypass: a longer derivation
# naturally moves from `node -e '...'` to a file, and `eval "$(node scripts/lib/some-file.mjs)"`
# loses the same capture-then-check property without containing `-e` anywhere. Prove the widened
# check actually catches that form, on a scratch copy -- never the real file.
scratch_validate="$(mktemp)"
cp -a "$VALIDATE" "$scratch_validate"
printf '\neval "$(node scripts/lib/derive-dispatch.mjs)"\n' >> "$scratch_validate"
if grep -vE '^[[:space:]]*#' "$scratch_validate" | grep -qE 'eval[[:space:]]+"\$\(node|source[[:space:]]+<\(node'; then
  ok "the widened shape check catches a bare eval of a node SCRIPT FILE (not just -e), on a scratch copy"
else
  bad "the widened shape check misses a bare eval of a node script file -- a literal '-e' match is too narrow"
fi
rm -f "$scratch_validate"

# A derivation that prints two assignments and then throws is what a real partial failure looks
# like (e.g. a tier added to VALID_COSTS but missing from a host's mapping, mid-forEach). Run
# validate.sh's exact idiom against it under the same `set -euo pipefail` validate.sh runs under.
partial_derivation() { node -e 'console.log("a=1"); console.log("b=2"); throw new Error("boom");'; }
guarded_out="$(
  exec 2>&1
  set -euo pipefail
  cost_env="$(partial_derivation)" || { echo "cost-model derivation failed; cannot validate cost tiers" >&2; exit 1; }
  eval "$cost_env"
  echo "REACHED-PAST-THE-GUARD"
)"
guarded_rc=$?
if [ "$guarded_rc" -eq 1 ]; then
  ok "the capture-then-check idiom exits 1 on a partial derivation failure"
else
  bad "the capture-then-check idiom did not exit 1 on a partial derivation failure (rc=$guarded_rc, out: $guarded_out)"
fi
case "$guarded_out" in
  *"cost-model derivation failed; cannot validate cost tiers"*)
    ok "the capture-then-check idiom's diagnostic reaches output" ;;
  *)
    bad "the capture-then-check idiom's diagnostic did not reach output (got: $guarded_out)" ;;
esac
case "$guarded_out" in
  *"REACHED-PAST-THE-GUARD"*)
    bad "execution continued past a partial derivation failure -- the guard did not stop it" ;;
  *)
    ok "execution did not continue past a partial derivation failure" ;;
esac

echo "cost model tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
