#!/usr/bin/env bash
# Guard for the default config table (scripts/lib/cost-defaults.mjs). Until frontmatter `cost:` is
# retired, the table must equal the HIGHEST tier each agents/*.md declares, with exactly the same
# set of agents (the front-door `somi` agent, which declares no cost, is the one exclusion). Each
# parity check is also proven red: a copy of the table with one tier changed, or one row removed,
# must fail the same comparison.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB_SRC="$ROOT_REPO/scripts/lib"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

echo "== cost defaults =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Prints "name:tier" per agents/*.md that declares cost: (highest member), sorted.
frontmatter_tiers() {
  for f in "$ROOT_REPO"/agents/*.md; do
    line="$(awk '/^---$/{n++; next} n==1 && /^cost:/{sub(/^cost:[ \t]*/,""); print; exit}' "$f")"
    [ -n "$line" ] || continue
    printf '%s:%s\n' "$(basename "$f" .md)" "$(printf '%s' "$line" | awk -F',' '{gsub(/[ \t\r]/,"",$NF); print $NF}')"
  done | sort
}
# Prints "name:tier" for the table in the lib dir given, sorted.
table_tiers() {
  node --input-type=module -e "
    const D = await import('$1/cost-defaults.mjs');
    for (const [k, v] of Object.entries(D.AGENT_DEFAULT_TIERS)) console.log(k + ':' + v);" | sort
}

EXPECT="$(frontmatter_tiers)"
[ -n "$EXPECT" ] || bad "no agent frontmatter was parsed"
check "the table equals the highest declared tier of every agent that declares one (exact agent set)" \
  "$(table_tiers "$LIB_SRC")" "$EXPECT"

# Red proofs on copies of the lib.
mutant() { # $1 = name, $2 = sed expression
  mkdir -p "$TMP/$1"; cp "$LIB_SRC"/cost-*.mjs "$TMP/$1/"; sed -i "$2" "$TMP/$1/cost-defaults.mjs"
  cmp -s "$LIB_SRC/cost-defaults.mjs" "$TMP/$1/cost-defaults.mjs" && bad "mutant $1 did not change the file"
}
mutant tier-changed "s/^  coder: 'medium',/  coder: 'high',/"
mutant row-removed  "/^  atlas: 'high',/d"
mutant row-added    "s/^  atlas: 'high',/  atlas: 'high',\n  ghost: 'low',/"
for m in tier-changed row-removed row-added; do
  if [ "$(table_tiers "$TMP/$m")" != "$EXPECT" ]; then ok "red proof: parity fails for $m"; else bad "red proof: parity still holds for $m"; fi
done

# The shape of the default config.
node --input-type=module -e "
  const D = await import('$LIB_SRC/cost-defaults.mjs');
  const C = await import('$LIB_SRC/cost-ceiling.mjs');
  const V = await import('$LIB_SRC/cost-config.mjs');
  const cfg = D.buildDefaultConfig();
  const out = [];
  out.push(['ceiling is the built-in default', cfg.cost.ceiling === C.DEFAULT_CEILING && D.DEFAULT_CEILING_TIER === C.DEFAULT_CEILING]);
  out.push(['validates through the shared validator', (() => { try { V.validateCostConfig(cfg.cost); return true; } catch { return false; } })()]);
  out.push(['agents are sorted by name', Object.keys(cfg.cost.agents).join() === Object.keys(cfg.cost.agents).sort().join()]);
  out.push(['the table is frozen and null-prototype', Object.isFrozen(D.AGENT_DEFAULT_TIERS) && Object.getPrototypeOf(D.AGENT_DEFAULT_TIERS) === null]);
  out.push(['serialization is stable and is JSON, 2-space indent, trailing newline', D.serializeDefaultConfig() === D.serializeDefaultConfig() && D.serializeDefaultConfig() === JSON.stringify(cfg, null, 2) + '\n' && D.serializeDefaultConfig().endsWith('}\n')]);
  out.push(['serialization round-trips to the same object', JSON.stringify(JSON.parse(D.serializeDefaultConfig())) === JSON.stringify(cfg)]);
  out.push(['the somi front-door agent is not listed', !('somi' in D.AGENT_DEFAULT_TIERS)]);
  out.push(['a bad table row is rejected', (() => { try { D.buildDefaultConfig({ coder: 'turbo' }); return false; } catch { return true; } })()]);
  out.push(['a bad agent name is rejected', (() => { try { D.buildDefaultConfig({ 'Bad_Name': 'low' }); return false; } catch { return true; } })()]);
  for (const [n, v] of out) console.log((v ? 'ok' : 'FAIL') + '\t' + n);" > "$TMP/shape.out" 2>&1
while IFS=$'\t' read -r s n; do case "$s" in ok) ok "$n" ;; FAIL) bad "$n" ;; *) bad "unexpected output: $s $n" ;; esac; done < "$TMP/shape.out"

# No model names anywhere in the file or its output: the pattern comes from the shipped mapping.
PATTERN="$(node --input-type=module -e "
  const M = await import('$LIB_SRC/cost-model.mjs');
  console.log(Object.values(M.HOST_MODELS).flatMap((h) => Object.values(h)).join('|'))")"
if [ -n "$PATTERN" ] && ! grep -qiE "$PATTERN" "$LIB_SRC/cost-defaults.mjs" \
   && ! node --input-type=module -e "const D = await import('$LIB_SRC/cost-defaults.mjs'); process.stdout.write(D.serializeDefaultConfig())" | grep -qiE "$PATTERN"; then
  ok "no model name in the table file or in the serialized config"
else bad "a model name appears in the table file or the serialized config"; fi

echo "cost defaults tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
