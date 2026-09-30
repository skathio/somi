#!/usr/bin/env bash
# Cross-checks agents/somi.md's dispatch instructions against both dispatch surfaces' real
# behavior. A prompt cannot be exercised without a model, but what it tells the model to RUN can
# be: the primary path is the bundled somi_resolve/somi_command MCP tools (checked against the
# real server below, driven rather than hand-typed), and the CLI fallback invocation shape plus the
# exit codes Step 4 maps must still be real and current against scripts/somi-dispatch.mjs, not
# prose that quietly drifted from either surface it describes.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_MD="$ROOT_REPO/agents/somi.md"
SKILL_MD="$ROOT_REPO/skills/somi-dispatch/SKILL.md"
CLI="$ROOT_REPO/scripts/somi-dispatch.mjs"
COMMAND_MDS="$ROOT_REPO"/commands/*.md

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

echo "== somi agent <-> somi-dispatch.mjs dispatch contract =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fresh() { mktemp -d -p "$TMP"; }
reach() { # $1=name $2=want-exit-code, remaining = CLI args after 'resolve'
  local name="$1" want="$2" rc=0
  shift 2
  CLAUDE_PROJECT_DIR="$(fresh)" node "$CLI" resolve "$@" >/dev/null 2>&1 || rc=$?
  if [ "$rc" = "$want" ]; then ok "$name"; else bad "$name (expected exit $want, got $rc)"; fi
}

# --- the CLI-fallback invocation shape is named in skills/somi-dispatch/SKILL.md (the resolve
# procedure lives there so every command that Tasks an agent shares it, not just the front door) --
# checked against the skill and, for belt-and-braces, agents/somi.md too, since either file could
# carry the wording after a future edit.
if grep -qF 'resolve --agent <agent name> --host <host>' "$AGENT_MD" "$SKILL_MD"; then
  ok "skills/somi-dispatch/SKILL.md names the 'resolve --agent ... --host ...' invocation shape"
else
  bad "neither agents/somi.md nor skills/somi-dispatch/SKILL.md names the resolve --agent/--host CLI fallback shape -- if the wording changed intentionally, update this test to match it"
fi

out="$(CLAUDE_PROJECT_DIR="$(fresh)" node "$CLI" resolve --agent coder --host claude-code)"; rc=$?
if [ "$rc" -eq 0 ] && node -e 'JSON.parse(process.argv[1])' "$out" >/dev/null 2>&1; then
  ok "the literal CLI-fallback invocation Step 4 names succeeds against the real CLI and prints valid JSON"
else
  bad "Step 4's CLI-fallback invocation does not succeed against the real CLI (rc=$rc, out=$out)"
fi

# --- the two host values the dispatch skill names are the CLI's own recognized host strings -------
if grep -q '`claude-code` if this turn is running in Claude Code' "$AGENT_MD" "$SKILL_MD" \
    && grep -q '`copilot` if.*running in GitHub Copilot' "$AGENT_MD" "$SKILL_MD"; then
  ok "skills/somi-dispatch/SKILL.md names claude-code and copilot precisely as the two --host values"
else
  bad "neither agents/somi.md nor skills/somi-dispatch/SKILL.md clearly names both claude-code and copilot as --host values"
fi
for h in claude-code copilot; do
  hrc=0
  CLAUDE_PROJECT_DIR="$(fresh)" node "$CLI" resolve --agent coder --host "$h" >/dev/null 2>&1 || hrc=$?
  if [ "$hrc" = "0" ]; then ok "--host $h is accepted by the real CLI"; else bad "--host $h was rejected (rc=$hrc)"; fi
done

# --- the exit codes the dispatch skill maps are EXACTLY the CLI's real EXIT_* constants -----------
PROMPT_CODES="$(grep -ohE '^- `[0-9]+`' "$AGENT_MD" "$SKILL_MD" | grep -oE '[0-9]+' | sort -un | tr '\n' ' ')"
CLI_CODES="$(grep -oE '^const EXIT_[A-Z_]+ = [0-9]+;' "$CLI" | grep -oE '[0-9]+' | sort -un | tr '\n' ' ')"
if [ -n "$PROMPT_CODES" ] && [ "$PROMPT_CODES" = "$CLI_CODES" ]; then
  ok "the exit codes skills/somi-dispatch/SKILL.md maps ($PROMPT_CODES) exactly match the CLI's real EXIT_* constants ($CLI_CODES)"
else
  bad "the mapped exit codes ($PROMPT_CODES) do not match the CLI's real EXIT_* constants ($CLI_CODES)"
fi

# --- each code Step 4 maps is genuinely reachable against the real CLI, not merely documented -----
reach "64 (usage) is reachable: missing --agent" 64
reach "65 (unknown agent) is reachable" 65 --agent totally-not-a-real-agent
reach "66 (malformed declaration) is reachable: somi is exempt from cost:" 66 --agent somi

R67="$(fresh)"; mkdir -p "$R67/.somi"
printf '{"cost": {"ceiling": "low"}\n' > "$R67/.somi/config.json"  # missing closing brace
r67rc=0
CLAUDE_PROJECT_DIR="$R67" node "$CLI" resolve --agent coder >/dev/null 2>&1 || r67rc=$?
if [ "$r67rc" = "67" ]; then
  ok "67 (project environment/config failure) is reachable: unparsable .somi/config.json"
else
  bad "67 was not reachable via an unparsable config.json (got $r67rc)"
fi

# 67 is also reachable AFTER a session already bootstrapped successfully (M1: a config error must
# never surface as 66, blamed on the agent's own cost: declaration, just because it happened on a
# LATER call than the one that wrote .somi/somi-state/ceiling.json).
R67_POST="$(fresh)"; mkdir -p "$R67_POST/.somi"
printf '{"cost": {"ceiling": "high"}}\n' > "$R67_POST/.somi/config.json"
CLAUDE_PROJECT_DIR="$R67_POST" node "$CLI" resolve --agent coder >/dev/null 2>&1 # bootstrap
printf '{"cost": {"ceiling": "high"}\n' > "$R67_POST/.somi/config.json"  # now corrupt
r67postrc=0
CLAUDE_PROJECT_DIR="$R67_POST" node "$CLI" resolve --agent coder >/dev/null 2>&1 || r67postrc=$?
if [ "$r67postrc" = "67" ]; then
  ok "67 is reachable even AFTER a successful bootstrap, not just on a fresh project"
else
  bad "config corrupted after bootstrap did not reach 67 (got $r67postrc) -- may be misattributed to 66"
fi


# --- agents/somi.md + skills/somi-dispatch/SKILL.md's tool/argument names match the REAL
# somi-mcp.mjs tools/list --------------------------------------------------------------------------
# Step 4/5 now call the bundled MCP tools as their primary path (the CLI above is the fallback, only
# where SoMi's own install path is already known); the RESOLVE side of that (somi_resolve's
# arguments, fallback order, exit-code mapping) moved out of agents/somi.md into
# skills/somi-dispatch/SKILL.md so every command that Tasks an agent directly shares it too --
# agents/somi.md keeps only what's specific to the front door (somi_command, the classify/recursion
# steps). So this section checks the UNION of both files: wherever a given rule now lives, it must
# still be there, and it must still be derived from the REAL server, never a hand-typed second copy
# of scripts/somi-mcp.mjs's TOOLS table, which is exactly the kind of copy that quietly drifts.
echo "== agents/somi.md + skills/somi-dispatch/SKILL.md <-> somi-mcp.mjs tool/argument contract =="

SCHEMA_JSON="$(node "$ROOT_REPO/tests/scripts/lib/somi-mcp-tool-schema.mjs" 2>/dev/null || true)"
if [ -z "$SCHEMA_JSON" ] || ! node -e 'JSON.parse(process.argv[1])' "$SCHEMA_JSON" >/dev/null 2>&1; then
  bad "could not drive scripts/somi-mcp.mjs's real tools/list to derive its schema"
else
  ok "drove the real MCP server to derive its tools/list schema"

  schema_field() { node -e '
    const s = JSON.parse(process.argv[1])[process.argv[2]] || {};
    console.log((s[process.argv[3]] || []).join(" "));
  ' "$SCHEMA_JSON" "$1" "$2"; }

  # The UNION of the front door, the skill, AND every commands/*.md file -- a command's own
  # dispatch-reference line now names `somi_resolve`/`somi_skill` directly (not just a link to the
  # skill), so a stale or invented tool name there would otherwise go unchecked: the skill/front-door
  # pair alone can't see a typo that only ever appears in a command file.
  REAL_TOOLS="$(node -e 'console.log(Object.keys(JSON.parse(process.argv[1])).sort().join(" "))' "$SCHEMA_JSON")"
  PROMPT_TOOLS="$(grep -ohE '`somi_[a-z_]+`' "$AGENT_MD" "$SKILL_MD" $COMMAND_MDS | tr -d '`' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
  if [ "$REAL_TOOLS" = "$PROMPT_TOOLS" ]; then
    ok "agents/somi.md + skills/somi-dispatch/SKILL.md + commands/*.md together name exactly the server's real tools ($REAL_TOOLS)"
  else
    bad "tool-name mismatch -- server: [$REAL_TOOLS] vs agents/somi.md + skills/somi-dispatch/SKILL.md + commands/*.md: [$PROMPT_TOOLS]"
  fi

  # somi_resolve: every REAL property must be named somewhere across the two files (nothing silently
  # dropped) -- and every key the skill's own canonical invocation example passes must be a REAL
  # property (nothing invented, nothing stale).
  REAL_RESOLVE_PROPS="$(schema_field somi_resolve properties)"
  for prop in $REAL_RESOLVE_PROPS; do
    if grep -qE "\b${prop}\b" "$AGENT_MD" "$SKILL_MD"; then
      ok "somi_resolve's real argument '$prop' is named in agents/somi.md or skills/somi-dispatch/SKILL.md"
    else
      bad "somi_resolve's real argument '$prop' is never mentioned in agents/somi.md or skills/somi-dispatch/SKILL.md"
    fi
  done

  SNIPPET="$(cat "$AGENT_MD" "$SKILL_MD" | sed -n '/somi_resolve({ agent:/,/})/p')"
  if [ -z "$SNIPPET" ]; then
    bad "neither agents/somi.md nor skills/somi-dispatch/SKILL.md has a somi_resolve({ agent: ...}) canonical invocation example -- if the wording changed intentionally, update this test to match it"
  else
    ok "found the canonical somi_resolve invocation example (skills/somi-dispatch/SKILL.md)"
    SNIPPET_KEYS="$(printf '%s' "$SNIPPET" | grep -oE '[a-zA-Z_]+:' | tr -d ':' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
    for key in $SNIPPET_KEYS; do
      case " $REAL_RESOLVE_PROPS " in
        *" $key "*) ok "the example's argument '$key' is a real somi_resolve property" ;;
        *) bad "the example passes '$key', which is not a real somi_resolve property" ;;
      esac
    done
    REAL_RESOLVE_REQUIRED="$(schema_field somi_resolve required)"
    for req in $REAL_RESOLVE_REQUIRED; do
      case " $SNIPPET_KEYS " in
        *" $req "*) ok "the example passes somi_resolve's required argument '$req'" ;;
        *) bad "somi_resolve's required argument '$req' is missing from the example" ;;
      esac
    done
  fi

  # somi_command: same shape, one required "name" argument -- stays specific to agents/somi.md
  # (only the front door reads a command's procedure text this way), but check both files anyway
  # so a future move doesn't silently drop the check.
  REAL_COMMAND_PROPS="$(schema_field somi_command properties)"
  for prop in $REAL_COMMAND_PROPS; do
    if grep -qE "\b${prop}\b" "$AGENT_MD" "$SKILL_MD"; then
      ok "somi_command's real argument '$prop' is named in agents/somi.md or skills/somi-dispatch/SKILL.md"
    else
      bad "somi_command's real argument '$prop' is never mentioned in agents/somi.md or skills/somi-dispatch/SKILL.md"
    fi
  done

  # somi_skill: same shape again, one required "name" argument -- checked against the UNION that
  # actually names it (agents/somi.md today; any commands/*.md file would also count).
  REAL_SKILL_PROPS="$(schema_field somi_skill properties)"
  for prop in $REAL_SKILL_PROPS; do
    if grep -qE "\b${prop}\b" "$AGENT_MD" "$SKILL_MD" $COMMAND_MDS; then
      ok "somi_skill's real argument '$prop' is named in agents/somi.md, skills/somi-dispatch/SKILL.md, or a command"
    else
      bad "somi_skill's real argument '$prop' is never mentioned in agents/somi.md, skills/somi-dispatch/SKILL.md, or any command"
    fi
  done
fi

echo "somi agent <-> somi-dispatch.mjs dispatch contract tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
