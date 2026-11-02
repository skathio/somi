#!/usr/bin/env bash
# Guard for the default tier table (scripts/lib/cost-defaults.mjs), the one source of each agent's tier:
#  - the table lists exactly the agents/*.md files, minus the exempt front-door `somi` (existence, both
#    directions);
#  - no agents/*.md or commands/*.md declares `cost:` (the real check from scripts/validate.sh, extracted
#    from a copy of it and run over fixtures, so this proves that block's own logic).
# Each check is also proven red: a copy of the table with one row removed or added, and fixtures that
# declare `cost:`, must fail the same comparison.
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

# Prints the agent names (agents/*.md minus the exempt `somi`), sorted.
agent_files() { for f in "$1"/*.md; do n="$(basename "$f" .md)"; [ "$n" = somi ] || printf '%s\n' "$n"; done | sort; }
# Prints the table's agent names for the lib dir given, sorted.
table_names() {
  node --input-type=module -e "
    const D = await import('$1/cost-defaults.mjs');
    for (const k of Object.keys(D.AGENT_DEFAULT_TIERS)) console.log(k);" | sort
}

EXPECT="$(agent_files "$ROOT_REPO/agents")"
[ -n "$EXPECT" ] || bad "no agent file was found"
check "the table lists exactly the agent files (minus the exempt somi)" "$(table_names "$LIB_SRC")" "$EXPECT"

# The tier values themselves: a literal expected list (changing a tier is a deliberate edit here).
EXPECT_TIERS="somi-architecture-reviewer:high
somi-atlas:high
somi-coder:medium
somi-designer:high
somi-discovery-analyst:high
somi-flow:medium
somi-general:medium
somi-impact:medium
somi-incident:medium
somi-plan-reviewer:high
somi-planner:medium
somi-pr:medium
somi-refactor-designer:high
somi-refactorer:medium
somi-reviewer:high
somi-sdlc-reviewer:high
somi-security-reviewer:high
somi-test-strategist:high"
table_tiers() {
  node --input-type=module -e "
    const D = await import('$1/cost-defaults.mjs');
    for (const [k, v] of Object.entries(D.AGENT_DEFAULT_TIERS)) console.log(k + ':' + v);" | sort
}
EXPECT_TIERS="$(printf '%s\n' "$EXPECT_TIERS" | sort)"
check "the table's name:tier list equals the literal expected list" "$(table_tiers "$LIB_SRC")" "$EXPECT_TIERS"

# Red proofs on copies of the lib.
mutant() { # $1 = name, $2 = sed expression
  mkdir -p "$TMP/$1"; cp "$LIB_SRC"/cost-*.mjs "$TMP/$1/"; sed -i "$2" "$TMP/$1/cost-defaults.mjs"
  cmp -s "$LIB_SRC/cost-defaults.mjs" "$TMP/$1/cost-defaults.mjs" && bad "mutant $1 did not change the file"
}
mutant tier-changed "s/^  'somi-coder': 'medium',/  'somi-coder': 'high',/"
mutant row-removed  "/^  'somi-atlas': 'high',/d"
mutant row-added    "s/^  'somi-atlas': 'high',/  'somi-atlas': 'high',\n  'somi-ghost': 'low',/"
if [ "$(table_tiers "$TMP/tier-changed")" != "$EXPECT_TIERS" ]; then ok "red proof: the tier list check fails for tier-changed"; else bad "red proof: a changed tier went unnoticed"; fi
for m in row-removed row-added; do
  if [ "$(table_names "$TMP/$m")" != "$EXPECT" ]; then ok "red proof: existence check fails for $m"; else bad "red proof: existence check still holds for $m"; fi
done
mkdir -p "$TMP/agents-extra"; cp "$ROOT_REPO"/agents/*.md "$TMP/agents-extra/"; printf -- '---\nname: extra\n---\n' > "$TMP/agents-extra/extra.md"
if [ "$(agent_files "$TMP/agents-extra")" != "$(table_names "$LIB_SRC")" ]; then ok "red proof: an agent file with no table row fails the check"; else bad "red proof: an unlisted agent file went unnoticed"; fi

# No agent or command declares `cost:` -- the real block from scripts/validate.sh, over fixtures.
HELPER="$(awk '/^fm_has\(\) \{/{c=1} c{print} c&&/^\}$/{exit}' "$ROOT_REPO/scripts/validate.sh")"
BLOCK="$(awk '/^cost_failed=0$/{c=1} c{print} c&&/^done$/{exit}' "$ROOT_REPO/scripts/validate.sh")"
if [ -z "$HELPER" ] || [ -z "$BLOCK" ]; then bad "could not extract the cost check from scripts/validate.sh -- its markers may have moved"; else
  SNIPPET="$HELPER"$'\n'"$BLOCK"$'\nexit $cost_failed'
  fx() { (cd "$1" && bash -c "$SNIPPET" 2>"$1/err"); echo $?; }
  mkdir -p "$TMP/fx-ok/agents" "$TMP/fx-ok/commands" "$TMP/fx-agent/agents" "$TMP/fx-agent/commands" "$TMP/fx-cmd/agents" "$TMP/fx-cmd/commands" "$TMP/fx-crlf/agents" "$TMP/fx-crlf/commands"
  printf -- '---\nname: x\ndescription: d\n---\nbody line: cost: high\n' > "$TMP/fx-ok/agents/x.md"
  printf -- '---\ndescription: d\n---\nbody\n' > "$TMP/fx-ok/commands/c.md"
  for d in fx-agent fx-cmd fx-crlf; do cp "$TMP/fx-ok/agents/x.md" "$TMP/$d/agents/x.md"; cp "$TMP/fx-ok/commands/c.md" "$TMP/$d/commands/c.md"; done
  printf -- '---\nname: x\ncost: medium, high\n---\n' > "$TMP/fx-agent/agents/x.md"
  printf -- '---\ndescription: d\ncost: high\n---\n' > "$TMP/fx-cmd/commands/c.md"
  printf -- '---\r\nname: x\r\ncost: high\r\n---\r\n' > "$TMP/fx-crlf/agents/x.md"
  check "an agent and a command without a frontmatter cost: pass (a body line is not frontmatter)" "$(fx "$TMP/fx-ok")" "0"
  check "red proof: an agent declaring cost: fails" "$(fx "$TMP/fx-agent")" "1"
  check "red proof: a command declaring cost: fails" "$(fx "$TMP/fx-cmd")" "1"
  check "red proof: a CRLF agent declaring cost: fails" "$(fx "$TMP/fx-crlf")" "1"
  grep -q "agents/x.md declares cost:" "$TMP/fx-agent/err" && ok "the message names the offending file" || bad "message wrong: $(cat "$TMP/fx-agent/err")"
  n="$(awk 'FNR==1{c=0} /^---$/{c++} c==1 && /^cost:/{print FILENAME; nextfile}' "$ROOT_REPO"/agents/*.md "$ROOT_REPO"/commands/*.md | wc -l)"
  check "no shipped agent or command declares cost:" "$n" "0"
fi

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
  out.push(['a bad table row is rejected', (() => { try { D.buildDefaultConfig({ 'somi-coder': 'turbo' }); return false; } catch { return true; } })()]);
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
