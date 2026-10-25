#!/usr/bin/env bash
# Guard for "this change lowers a tier and needs the user": the pure rules (scripts/lib/cost-lowering.mjs), the
# PreToolUse hook (hooks/pre-tool/guard-cost-lowering.mjs) that asks on the somi_config MCP tool and on
# Write/Edit/MultiEdit of .somi/config.json, and the CLI's --refuse-lowering. The rules and the fail-closed
# behaviour are also proven red on mutated copies.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT_REPO/hooks/pre-tool/guard-cost-lowering.mjs"
CLI="$ROOT_REPO/scripts/somi-config.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

echo "== cost lowering =="

TMP="$(mktemp -d)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

# --- the pure rules ----------------------------------------------------------------------------------
# $1 = lib dir; stdin = JS using L (cost-lowering), D (defaults) and `res(before, after)` -> "true|false:reasonCount"
rules() {
  node --input-type=module -e "
    const L = await import('$1/cost-lowering.mjs'); const D = await import('$1/cost-defaults.mjs');
    const d = () => D.buildDefaultConfig(); const mod = (f) => { const c = d(); f(c.cost); return c; };
    const r = (b, a) => { const v = L.lowers(b, a); return v.lowers + ':' + v.reasons.length; };
    const out = [];
    const t = (n, got, want) => out.push((got === want ? 'ok' : 'FAIL') + '\t' + n + (got === want ? '' : ' (want ' + want + ', got ' + got + ')'));
    t('a no-op never lowers', r(d(), d()), 'false:0');
    t('init from an absent file (defaults) does not lower', r({}, d()), 'false:0');
    t('raising the ceiling does not lower', r(d(), mod((c) => { c.ceiling = 'high'; })), 'false:0');
    t('raising an agent does not lower', r(d(), mod((c) => { c.agents['somi-coder'] = 'high'; })), 'false:0');
    t('pinning security-reviewer to high does not lower', r({ cost: { ceiling: 'low' } }, { cost: { ceiling: 'low', agents: { 'somi-security-reviewer': 'high' } } }), 'false:0');
    t('lowering the ceiling lowers (unpinned agents drop)', L.lowers({ cost: { ceiling: 'high' } }, { cost: { ceiling: 'medium' } }).reasons.includes(L.REASONS.ceiling), true);
    t('lowering an agent lowers', L.lowers(d(), mod((c) => { c.agents['somi-coder'] = 'low'; })).reasons.join('|'), L.REASONS.agent);
    t('security-reviewer pinned low is flagged', L.lowers(d(), mod((c) => { c.agents['somi-security-reviewer'] = 'low'; })).reasons.includes(L.REASONS.security), true);
    t('an explicit low security-reviewer pin is flagged even when unchanged from before', L.lowers(mod((c) => { c.agents['somi-security-reviewer'] = 'low'; }), mod((c) => { c.agents['somi-security-reviewer'] = 'low'; c.agents['somi-coder'] = 'high'; })).reasons.includes(L.REASONS.security), true);
    t('security-reviewer left to a medium ceiling is flagged on any real change', L.lowers({ cost: { ceiling: 'medium' } }, { cost: { ceiling: 'medium', agents: { 'somi-coder': 'high' } } }).reasons.includes(L.REASONS.security), true);
    t('removing a pin above the ceiling lowers, with its own reason', L.lowers({ cost: { ceiling: 'low', agents: { 'somi-designer': 'high', 'somi-security-reviewer': 'high' } } }, { cost: { ceiling: 'low', agents: { 'somi-security-reviewer': 'high' } } }).reasons.join('|'), L.REASONS.pin);
    t('removing a pin at or below the ceiling does not lower', r({ cost: { ceiling: 'medium', agents: { 'somi-coder': 'low', 'somi-security-reviewer': 'high' } } }, { cost: { ceiling: 'medium', agents: { 'somi-coder': 'medium', 'somi-security-reviewer': 'high' } } }), 'false:0');
    t('an unparsable after lowers', r(d(), null), 'true:1');
    t('a non-object after lowers', r(d(), [1]), 'true:1');
    t('an invalid cost block in after lowers', r(d(), { cost: { agents: { 'somi-coder': 'turbo' } } }), 'true:1');
    t('an unknown cost key in after lowers', r(d(), { cost: { cieling: 'low' } }), 'true:1');
    t('a tolerant before: a bad value in before does not throw', r({ cost: { ceiling: 'turbo', agents: 5 } }, d()), 'false:0');
    t('an agent outside the default table is compared too', L.lowers({ cost: { agents: { mine: 'high' } } }, { cost: { agents: { mine: 'low' } } }).lowers, true);
    t('deleting cost.ceiling lowers whatever state exists later (the worst case is judged)', L.lowers({ cost: { ceiling: 'medium', agents: { 'somi-security-reviewer': 'high' } } }, { cost: { agents: { 'somi-security-reviewer': 'high' } } }).reasons.join('|'), L.REASONS.ceiling);
    t('deleting a ceiling that was already low does not lower', r({ cost: { ceiling: 'low', agents: { 'somi-security-reviewer': 'high' } } }, { cost: { agents: { 'somi-security-reviewer': 'high' } } }), 'false:0');
    t('replacing the ceiling with a higher one does not lower', r({ cost: { ceiling: 'medium', agents: { 'somi-security-reviewer': 'high' } } }, { cost: { ceiling: 'high', agents: { 'somi-security-reviewer': 'high' } } }), 'false:0');
    t('unpinning a medium pin in a config without a ceiling lowers (worst case)', L.lowers({ cost: { agents: { 'somi-coder': 'medium', 'somi-security-reviewer': 'high' } } }, { cost: { agents: { 'somi-security-reviewer': 'high' } } }).reasons.join('|'), L.REASONS.pin);
    t('reasons are fixed strings only', JSON.stringify(Object.values(L.REASONS).every((x) => typeof x === 'string')), 'true');
    console.log(out.join('\n'));" 2>&1
}
tally() { while IFS=$'\t' read -r s n; do case "$s" in ok) ok "$n" ;; FAIL) bad "$n" ;; *) bad "unexpected output: $s $n" ;; esac; done; }
rules "$ROOT_REPO/scripts/lib" | tally

# --- the hook -----------------------------------------------------------------------------------------------
export SOMI_AUDIT_LOG="$TMP/audit.log"
proj() { local p; p="$(mktemp -d -p "$TMP")"; mkdir "$p/.somi"; node "$CLI" init --project-dir "$p" > /dev/null; echo "$p"; }
# $1 = hook file, $2 = project root, $3 = payload JSON -> prints "ask" / "silent" / "BAD:<rc>"
verdict() {
  local out rc=0
  out="$(printf '%s' "$3" | CLAUDE_PROJECT_DIR="$2" node "$1" 2> "$TMP/herr")" || rc=$?
  [ "$rc" -eq 0 ] || { echo "BAD:$rc"; return; }
  [ -s "$TMP/herr" ] && { echo "BAD:stderr"; return; }
  if [ -z "$out" ]; then echo silent; elif printf '%s' "$out" | node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8')).hookSpecificOutput; process.exit(o.permissionDecision==='ask'&&o.hookEventName==='PreToolUse'?0:1)"; then echo ask; else echo "BAD:shape"; fi
}
reason_of() { printf '%s' "$2" | CLAUDE_PROJECT_DIR="$1" node "$HOOK" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).hookSpecificOutput.permissionDecisionReason)"; }
mcp() { node -e "console.log(JSON.stringify({tool_name:process.argv[1],tool_input:{action:process.argv[2],key:process.argv[3],value:process.argv[4]}}))" "$1" "$2" "${3:-}" "${4:-}"; }
T=mcp__plugin_somi_somi__somi_config

P="$(proj)"
check "MCP set that lowers security-reviewer: ask" "$(verdict "$HOOK" "$P" "$(mcp $T set cost.agents.somi-security-reviewer low)")" "ask"
check "MCP set that lowers the ceiling: ask" "$(verdict "$HOOK" "$P" "$(mcp $T set cost.ceiling low)")" "ask"
check "MCP set that lowers one agent: ask" "$(verdict "$HOOK" "$P" "$(mcp $T set cost.agents.somi-coder low)")" "ask"
check "MCP unset of a pin above the ceiling (after the ceiling was lowered by hand): ask" "$(P2="$(proj)"; node "$CLI" set cost.ceiling low --project-dir "$P2" > /dev/null; verdict "$HOOK" "$P2" "$(mcp $T unset cost.agents.somi-designer)")" "ask"
check "MCP raise: silent" "$(verdict "$HOOK" "$P" "$(mcp $T set cost.agents.somi-coder high)")" "silent"
check "MCP no-op: silent" "$(verdict "$HOOK" "$P" "$(mcp $T set cost.agents.somi-coder medium)")" "silent"
check "MCP show / get / init: silent" "$(verdict "$HOOK" "$P" "$(mcp $T show)")|$(verdict "$HOOK" "$P" "$(mcp $T get cost.ceiling)")|$(verdict "$HOOK" "$P" "$(mcp $T init)")" "silent|silent|silent"
check "MCP call with a bad key (the tool rejects it itself): silent" "$(verdict "$HOOK" "$P" "$(mcp $T set cost.bogus low)")" "silent"
check "the bare tool name somi_config is handled too" "$(verdict "$HOOK" "$P" "$(mcp somi_config set cost.ceiling low)")" "ask"
check "an unrelated MCP tool: silent" "$(verdict "$HOOK" "$P" "$(mcp mcp__x__other_tool set cost.ceiling low)")" "silent"
check "an unrelated tool (Bash): silent" "$(verdict "$HOOK" "$P" '{"tool_name":"Bash","tool_input":{"command":"ls"}}')" "silent"
check "the reason is plain text built from fixed strings and names no config content" "$(reason_of "$P" "$(mcp $T set cost.agents.somi-security-reviewer low)")" "SoMi: this change lowers a cost setting (security-reviewer would run below high; an agent tier would be lowered). Confirm only if you intend it."
P2="$(mktemp -d -p "$TMP")"
check "MCP set over an absent config (starts from defaults): raise is silent, lowering asks" "$(verdict "$HOOK" "$P2" "$(mcp $T set cost.ceiling high)")|$(verdict "$HOOK" "$P2" "$(mcp $T set cost.ceiling low)")" "silent|ask"
P2="$(mktemp -d -p "$TMP")"; mkdir "$P2/.somi"; printf '{ not json' > "$P2/.somi/config.json"
check "MCP set when the current config is unparsable (cannot evaluate): ask" "$(verdict "$HOOK" "$P2" "$(mcp $T set cost.ceiling high)")" "ask"

# Write / Edit / MultiEdit of the config file
wr() { node -e "console.log(JSON.stringify({tool_name:'Write',tool_input:{file_path:process.argv[1],content:process.argv[2]}}))" "$1" "$2"; }
ed() { node -e "console.log(JSON.stringify({tool_name:process.argv[1],tool_input:JSON.parse(process.argv[2])}))" "$1" "$2"; }
CFG="$P/.somi/config.json"
LOWCONTENT='{"cost":{"ceiling":"low"}}'
check "Write of lowering content to the config: ask" "$(verdict "$HOOK" "$P" "$(wr "$CFG" "$LOWCONTENT")")" "ask"
check "Write of the same content back: silent" "$(verdict "$HOOK" "$P" "$(wr "$CFG" "$(cat "$CFG")")")" "silent"
check "Write of raising content: silent" "$(verdict "$HOOK" "$P" "$(wr "$CFG" "$(node -e "const c=JSON.parse(require('fs').readFileSync('$CFG','utf8')); c.cost.ceiling='high'; console.log(JSON.stringify(c))")")")" "silent"
check "Write of unparsable content: ask" "$(verdict "$HOOK" "$P" "$(wr "$CFG" '{ nope')")" "ask"
check "Write of a relative path: resolved against the project root" "$(verdict "$HOOK" "$P" "$(wr '.somi/config.json' "$LOWCONTENT")")" "ask"
check "Write of .somi/../.somi/config.json: the same file, ask" "$(verdict "$HOOK" "$P" "$(wr "$P/.somi/../.somi/config.json" "$LOWCONTENT")")" "ask"
check "Write of another file: silent" "$(verdict "$HOOK" "$P" "$(wr "$P/other.json" "$LOWCONTENT")")|$(verdict "$HOOK" "$P" "$(wr "$P/.somi/other.json" "$LOWCONTENT")")" "silent|silent"
check "Edit that lowers (the ceiling string): ask" "$(verdict "$HOOK" "$P" "$(ed Edit "$(node -e "console.log(JSON.stringify({file_path:'$CFG',old_string:'\"ceiling\": \"medium\"',new_string:'\"ceiling\": \"low\"'}))")")")" "ask"
check "Edit that raises: silent" "$(verdict "$HOOK" "$P" "$(ed Edit "$(node -e "console.log(JSON.stringify({file_path:'$CFG',old_string:'\"somi-coder\": \"medium\"',new_string:'\"somi-coder\": \"high\"'}))")")")" "silent"
check "Edit whose old_string is absent (cannot apply): ask" "$(verdict "$HOOK" "$P" "$(ed Edit "$(node -e "console.log(JSON.stringify({file_path:'$CFG',old_string:'NOT-THERE',new_string:'x'}))")")")" "ask"
check "Edit with a non-unique old_string and no replace_all (the tool would fail): ask" "$(verdict "$HOOK" "$P" "$(ed Edit "$(node -e "console.log(JSON.stringify({file_path:'$CFG',old_string:'\"high\"',new_string:'\"low\"'}))")")")" "ask"
check "Edit with replace_all that lowers every high pin: ask" "$(verdict "$HOOK" "$P" "$(ed Edit "$(node -e "console.log(JSON.stringify({file_path:'$CFG',old_string:'\"high\"',new_string:'\"low\"',replace_all:true}))")")")" "ask"
check "Edit of another file: silent" "$(verdict "$HOOK" "$P" "$(ed Edit "$(node -e "console.log(JSON.stringify({file_path:'$P/README.md',old_string:'a',new_string:'b'}))")")")" "silent"
check "MultiEdit that lowers in its second edit: ask" "$(verdict "$HOOK" "$P" "$(ed MultiEdit "$(node -e "console.log(JSON.stringify({file_path:'$CFG',edits:[{old_string:'\"somi-coder\": \"medium\"',new_string:'\"somi-coder\": \"high\"'},{old_string:'\"ceiling\": \"medium\"',new_string:'\"ceiling\": \"low\"'}]}))")")")" "ask"
check "a Write with no file_path or a non-string one: silent (not a config write)" "$(verdict "$HOOK" "$P" '{"tool_name":"Write","tool_input":{"content":"x"}}')|$(verdict "$HOOK" "$P" '{"tool_name":"Write","tool_input":{"file_path":5,"content":"x"}}')" "silent|silent"
check "empty stdin: silent, exit 0" "$(verdict "$HOOK" "$P" '')" "silent"
# A symlinked .somi: the path still resolves to the project's config and is evaluated
OUT="$(mktemp -d -p "$TMP")"; node "$CLI" init --project-dir "$OUT" > /dev/null
PL="$(mktemp -d -p "$TMP")"; ln -s "$OUT/.somi" "$PL/.somi"
check "Write through a symlinked .somi that resolves to the config: ask (fail closed)" "$(verdict "$HOOK" "$PL" "$(wr "$PL/.somi/config.json" "$LOWCONTENT")")" "ask"
echo x > "$TMP/notadir"
check "audit write failure does not change the answer (unwritable log)" "$(SOMI_AUDIT_LOG="$TMP/notadir/x.log" verdict "$HOOK" "$P" "$(mcp $T set cost.ceiling low)")" "ask"

# --- CLI --refuse-lowering ----------------------------------------------------------------------------------
cfg() { local p=$1; shift; node "$CLI" "$@" --project-dir "$p" > "$TMP/out" 2> "$TMP/err"; echo $?; }
P="$(proj)"; cp "$P/.somi/config.json" "$TMP/before"
check "--refuse-lowering on a lowering set: exit 64, fixed message, nothing written" "$(cfg "$P" set cost.agents.somi-coder low --refuse-lowering)|$(grep -c 'this change lowers a tier and needs the user: ask them to run node scripts/somi-config.mjs themselves or edit .somi/config.json' "$TMP/err" | tr -d ' ')|$(cmp -s "$P/.somi/config.json" "$TMP/before" && echo same)|$(wc -c < "$TMP/out" | tr -d ' ')" "64|1|same|0"
check "--refuse-lowering on a security-reviewer pin below high: 64" "$(cfg "$P" set cost.agents.somi-security-reviewer medium --refuse-lowering)" "64"
check "--refuse-lowering on a raise succeeds" "$(cfg "$P" set cost.agents.somi-coder high --refuse-lowering)" "0"
check "--refuse-lowering on a no-op succeeds" "$(cfg "$P" set cost.agents.somi-coder high --refuse-lowering)" "0"
check "--refuse-lowering on an unset of a pin above the ceiling: 64" "$(cfg "$P" unset cost.agents.somi-designer --refuse-lowering)|$(cfg "$P" set cost.ceiling low)" "64|0"
check "without the flag a lowering is allowed (the CLI is the user's own tool)" "$(cfg "$P" set cost.agents.somi-coder low)" "0"
check "--refuse-lowering with show is a usage error" "$(cfg "$P" show --refuse-lowering)" "64"

# --- deleting the ceiling is a lowering whatever state exists, now or later ------------------------------------
persist_low() { CLAUDE_PROJECT_DIR="$1" env -u SOMI_COST_CEILING node "$ROOT_REPO/scripts/somi-dispatch.mjs" resolve --agent somi-coder --ceiling low > /dev/null; }
NOCEIL="$(node --input-type=module -e "const D = await import('$ROOT_REPO/scripts/lib/cost-defaults.mjs'); const c = D.buildDefaultConfig(); delete c.cost.ceiling; process.stdout.write(JSON.stringify(c))")"
P="$(proj)"
check "Write that deletes cost.ceiling (no persisted ceiling yet): ask" "$(verdict "$HOOK" "$P" "$(wr "$P/.somi/config.json" "$NOCEIL")")" "ask"
P2="$(proj)"; persist_low "$P2"
check "... and with a persisted low ceiling: ask" "$(verdict "$HOOK" "$P2" "$(wr "$P2/.somi/config.json" "$NOCEIL")")" "ask"
check "a Write that replaces the ceiling with a higher one: silent" "$(verdict "$HOOK" "$P" "$(wr "$P/.somi/config.json" "$(node -e "const c=JSON.parse(require('fs').readFileSync('$P/.somi/config.json','utf8')); c.cost.ceiling='high'; process.stdout.write(JSON.stringify(c))")")")" "silent"
# The reorder: delete the ceiling, unpin, and only then plant a persisted ceiling.
P="$(proj)"; printf '%s' "$NOCEIL" > "$P/.somi/config.json"; cp "$P/.somi/config.json" "$TMP/before.state"
check "reorder, step 2 (ceiling already deleted): unsetting a medium pin via MCP asks" "$(verdict "$HOOK" "$P" "$(mcp $T unset cost.agents.somi-coder)")" "ask"
check "reorder, step 2: --refuse-lowering exits 64 and writes nothing" "$(cfg "$P" unset cost.agents.somi-coder --refuse-lowering)|$(cmp -s "$P/.somi/config.json" "$TMP/before.state" && echo same)" "64|same"
persist_low "$P"
check "reorder, step 3 (state planted afterwards): the same unset still asks, and is still refused" "$(verdict "$HOOK" "$P" "$(mcp $T unset cost.agents.somi-coder)")|$(cfg "$P" unset cost.agents.somi-coder --refuse-lowering)" "ask|64"
P2="$(proj)"
check "a plain (non-lowering) set on a config that has its ceiling stays silent" "$(verdict "$HOOK" "$P2" "$(mcp $T set cost.agents.somi-coder high)")" "silent"

# --- the persisted ceiling file and somi_resolve are guarded too ------------------------------------------------------
P="$(proj)"; mkdir -p "$P/.somi/somi-state"
ST="$P/.somi/somi-state/ceiling.json"
check "Write to the persisted ceiling file: ask" "$(verdict "$HOOK" "$P" "$(wr "$ST" '{"ceiling":"low","ceiling_origin":"cli"}')")" "ask"
check "Edit and MultiEdit of it: ask" "$(verdict "$HOOK" "$P" "$(ed Edit "$(node -e "console.log(JSON.stringify({file_path:'$ST',old_string:'a',new_string:'b'}))")")")|$(verdict "$HOOK" "$P" "$(ed MultiEdit "$(node -e "console.log(JSON.stringify({file_path:'$ST',edits:[{old_string:'a',new_string:'b'}]}))")")")" "ask|ask"
check "case variant and relative path: ask" "$(verdict "$HOOK" "$P" "$(wr "$P/.SOMI/Somi-State/Ceiling.JSON" '{}')")|$(verdict "$HOOK" "$P" "$(wr '.somi/somi-state/ceiling.json' '{}')")" "ask|ask"
P3="$(mktemp -d -p "$TMP")"; ALST="$TMP/alias-state"; ln -s "$P3" "$ALST"
check "absent .somi/somi-state reached through an alias of the root: ask" "$(verdict "$HOOK" "$P3" "$(wr "$ALST/.somi/somi-state/ceiling.json" '{}')")" "ask"
check "other files in somi-state: silent" "$(verdict "$HOOK" "$P" "$(wr "$P/.somi/somi-state/other.json" '{}')")" "silent"
rs() { node -e "console.log(JSON.stringify({tool_name:process.argv[1],tool_input:process.argv[2]===''?{agent:'somi-coder'}:{agent:'somi-coder',ceiling:process.argv[2],...(process.argv[3]?{project_dir:process.argv[3]}:{})}}))" "$1" "${2:-}" "${3:-}"; }
R=mcp__plugin_somi_somi__somi_resolve
P="$(proj)"
check "somi_resolve with a ceiling below the current one (config medium): ask" "$(verdict "$HOOK" "$P" "$(rs $R low)")" "ask"
check "a ceiling at or above it, an invalid one, or none: silent" "$(verdict "$HOOK" "$P" "$(rs $R medium)")|$(verdict "$HOOK" "$P" "$(rs $R high)")|$(verdict "$HOOK" "$P" "$(rs $R turbo)")|$(verdict "$HOOK" "$P" "$(rs $R '')")" "silent|silent|silent|silent"
check "the bare name somi_resolve is handled too" "$(verdict "$HOOK" "$P" "$(rs somi_resolve low)")" "ask"
P2="$(proj)"; printf '{}' > "$P2/.somi/config.json"; persist_low "$P2"
check "with no config ceiling and a persisted low one, ceiling low is not a lowering: silent" "$(verdict "$HOOK" "$P2" "$(rs $R low)")" "silent"
P2="$(proj)"; printf '{}' > "$P2/.somi/config.json"
check "with no config ceiling and none persisted (default medium), ceiling low asks" "$(verdict "$HOOK" "$P2" "$(rs $R low)")" "ask"
check "somi_resolve naming a project_dir outside the root: ask" "$(verdict "$HOOK" "$P" "$(rs $R high "$(proj)")")" "ask"
printf '%s' '{ nope' > "$P/.somi/config.json"
check "somi_resolve with a ceiling when the config cannot be read: ask (fail closed)" "$(verdict "$HOOK" "$P" "$(rs $R high)")" "ask"

# --- which paths are the config -----------------------------------------------------------------------------------
P="$(proj)"; rm "$P/.somi/config.json"
check "Write to an absent config (the file does not exist yet) with a lowering content: ask" "$(verdict "$HOOK" "$P" "$(wr "$P/.somi/config.json" "$LOWCONTENT")")" "ask"
check "case variants of the path: ask" "$(verdict "$HOOK" "$P" "$(wr "$P/.SOMI/Config.json" "$LOWCONTENT")")|$(verdict "$HOOK" "$P" "$(wr "$P/.somi/CONFIG.JSON" "$LOWCONTENT")")" "ask|ask"
P3="$(proj)"; rm -rf "$P3/.somi"
check "absent .somi: a Write of .somi/config.json is still the config" "$(verdict "$HOOK" "$P3" "$(wr "$P3/.somi/config.json" "$LOWCONTENT")")" "ask"
ALIAS="$TMP/alias-root"; ln -s "$P" "$ALIAS"
check "the project root reached through a symlink alias, config absent: ask" "$(verdict "$HOOK" "$P" "$(wr "$ALIAS/.somi/config.json" "$LOWCONTENT")")" "ask"
P4="$(proj)"; ALIAS4="$TMP/alias-root4"; ln -s "$P4" "$ALIAS4"
check "the project root reached through a symlink alias, config present: ask" "$(verdict "$HOOK" "$P4" "$(wr "$ALIAS4/.somi/config.json" "$LOWCONTENT")")" "ask"
P5="$(mktemp -d -p "$TMP")"; rm -rf "$P5/x"; ALIAS5="$TMP/alias-root5"; ln -s "$P5" "$ALIAS5"
check "alias and absent .somi: ask" "$(verdict "$HOOK" "$P5" "$(wr "$ALIAS5/.somi/config.json" "$LOWCONTENT")")" "ask"
OUT2="$(mktemp -d -p "$TMP")"; mkdir "$OUT2/.somi"; PL2="$(mktemp -d -p "$TMP")"; ln -s "$OUT2/.somi" "$PL2/.somi"
check "symlinked .somi with an absent config file: ask" "$(verdict "$HOOK" "$PL2" "$(wr "$PL2/.somi/config.json" "$LOWCONTENT")")" "ask"
check "a config.json elsewhere and a file in .somi with another name: silent" "$(verdict "$HOOK" "$P4" "$(wr "$P4/sub/config.json" "$LOWCONTENT")")|$(verdict "$HOOK" "$P4" "$(wr "$P4/.somi/config.json.bak" "$LOWCONTENT")")" "silent|silent"
P6="$(proj)"; ln -s "$P6/.somi/config.json" "$P6/link.json"
check "a symlink elsewhere that points at the config: ask" "$(verdict "$HOOK" "$P6" "$(wr "$P6/link.json" "$LOWCONTENT")")" "ask"

# --- project_dir narrowing --------------------------------------------------------------------------------------------
P="$(proj)"; mkdir "$P/sub"; node "$CLI" set cost.ceiling high --project-dir "$P" > /dev/null; node "$CLI" init --project-dir "$P/sub" > /dev/null
node "$CLI" set cost.ceiling high --project-dir "$P/sub" > /dev/null
pd() { node -e "console.log(JSON.stringify({tool_name:process.argv[1],tool_input:{action:'set',key:'cost.ceiling',value:'medium',project_dir:process.argv[2]}}))" "$T" "$1"; }
OTHER="$(proj)"
check "project_dir outside the project root: ask (cannot evaluate)" "$(verdict "$HOOK" "$P" "$(pd "$OTHER")")" "ask"
check "a relative project_dir: ask" "$(verdict "$HOOK" "$P" "$(pd sub)")" "ask"
check "project_dir inside the root is evaluated: lowering THAT directory's ceiling asks" "$(verdict "$HOOK" "$P" "$(pd "$P/sub")")" "ask"
node "$CLI" set cost.ceiling low --project-dir "$P" > /dev/null
check "... and it is that directory's config that counts (the root's is lower, the sub's is high)" "$(verdict "$HOOK" "$P" "$(pd "$P/sub")")" "ask"
check "project_dir equal to the root: a raise is silent" "$(verdict "$HOOK" "$P" "$(node -e "console.log(JSON.stringify({tool_name:process.argv[1],tool_input:{action:'set',key:'cost.ceiling',value:'high',project_dir:process.argv[2]}}))" "$T" "$P")")" "silent"
node "$CLI" set cost.ceiling low --project-dir "$P/sub" > /dev/null
check "project_dir inside the root whose own ceiling is low: setting medium is a raise there, silent" "$(verdict "$HOOK" "$P" "$(pd "$P/sub")")" "silent"

# --- wording ------------------------------------------------------------------------------------------------------------
P="$(proj)"; printf '%s' '{"cost":{"ceiling":"medium"}}' > "$P/.somi/config.json"
check "a raise that only trips the security-reviewer rule gets its own wording (it does not claim a lowering)" "$(reason_of "$P" "$(mcp $T set cost.agents.somi-coder high)")" "SoMi: after this change security-reviewer would run below high (it is not pinned to high). Confirm only if you intend that."
check "the vendored hooks list names the hook" "$(grep -c guard-cost-lowering "$ROOT_REPO/.claude/settings.json" | tr -d ' ')" "1"

# --- red proofs on a mutated copy of the plugin tree --------------------------------------------------------
tree() { # $1 = name -> $TMP/$1 holding hooks/ and scripts/ copies
  local d="$TMP/$1"; mkdir -p "$d"; cp -r "$ROOT_REPO/hooks" "$ROOT_REPO/scripts" "$d/"
}
mutate() { M_FILE="$TMP/$1/$2" M_FROM="$3" M_TO="$4" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))" || bad "mutant $1 did not apply"; }
tree no-security; mutate no-security scripts/lib/cost-lowering.mjs "reasons.add(REASONS.security);" ""
r="$(rules "$TMP/no-security/scripts/lib" | grep -c '^FAIL')"
if [ "$r" -gt 0 ]; then ok "red proof: without the security-reviewer rule the rule table fails ($r)"; else bad "red proof: security rule mutant survived"; fi
tree no-ceiling; mutate no-ceiling scripts/lib/cost-lowering.mjs "if (rank(a.ceiling) < rank(b.ceiling) || (ceilingGone && rank(b.ceiling) > rank('low'))) reasons.add(REASONS.ceiling);" ""
r="$(rules "$TMP/no-ceiling/scripts/lib" | grep -c '^FAIL')"
if [ "$r" -gt 0 ]; then ok "red proof: without the ceiling rule the rule table fails ($r)"; else bad "red proof: ceiling rule mutant survived"; fi
tree open; mutate open hooks/pre-tool/guard-cost-lowering.mjs "askPretool(payload, UNEVALUABLE);" "return;"
P="$(proj)"
check "red proof: a hook that fails open stays silent on an edit that cannot apply" "$(verdict "$TMP/open/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(ed Edit "$(node -e "console.log(JSON.stringify({file_path:'$P/.somi/config.json',old_string:'NOT-THERE',new_string:'x'}))")")")" "silent"
tree nolower; mutate nolower hooks/pre-tool/guard-cost-lowering.mjs "if (verdict.lowers) askPretool(" "if (false) askPretool("
check "red proof: without the lowers check nothing is asked" "$(verdict "$TMP/nolower/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(mcp $T set cost.ceiling low)")" "silent"

tree noworst; mutate noworst scripts/lib/cost-lowering.mjs " || (ceilingGone && rank(b.ceiling) > rank('low'))" ""
P="$(proj)"
check "red proof: without the worst-case rule deleting cost.ceiling goes unnoticed" "$(verdict "$TMP/noworst/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(wr "$P/.somi/config.json" "$NOCEIL")")" "silent"
tree nounpin; mutate nounpin scripts/lib/cost-lowering.mjs "const aTier = removedPin && noCeiling ? worst(name) : a.tier(name);" "const aTier = a.tier(name);"
P="$(proj)"; printf '%s' "$NOCEIL" > "$P/.somi/config.json"
check "red proof: without the unpin worst case the reorder's second step goes unnoticed (hook and CLI)" "$(verdict "$TMP/nounpin/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(mcp $T unset cost.agents.somi-coder)")|$(node "$TMP/nounpin/scripts/somi-config.mjs" unset cost.agents.somi-coder --refuse-lowering --project-dir "$P" > /dev/null 2>&1; echo $?)" "silent|0"
tree nostatewr; mutate nostatewr hooks/pre-tool/guard-cost-lowering.mjs "askPretool(payload, STATE_WRITE);" "void 0;"
P="$(proj)"; mkdir -p "$P/.somi/somi-state"
check "red proof: without the state-file rule a Write that plants a ceiling is not asked about" "$(verdict "$TMP/nostatewr/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(wr "$P/.somi/somi-state/ceiling.json" '{"ceiling":"low","ceiling_origin":"cli"}')")" "silent"
tree noresolve; mutate noresolve hooks/pre-tool/guard-cost-lowering.mjs "if (VALID_COSTS.indexOf(input.ceiling) < VALID_COSTS.indexOf(effective)) askPretool(payload, RESOLVE_LOWER);" ""
check "red proof: without the somi_resolve rule a lower ceiling is not asked about" "$(verdict "$TMP/noresolve/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(rs $R low)")" "silent"
tree stringpath; mutate stringpath hooks/pre-tool/guard-cost-lowering.mjs "const lexical = path.resolve(root, target);" "const lexical = path.resolve(root, target); return lexical === path.join(root, '.somi', 'config.json');"
P="$(proj)"; rm "$P/.somi/config.json"; ALIASX="$TMP/alias-x"; ln -s "$P" "$ALIASX"
check "red proof: with a plain string comparison an aliased path, a case variant slip through" "$(verdict "$TMP/stringpath/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(wr "$ALIASX/.somi/config.json" "$LOWCONTENT")")|$(verdict "$TMP/stringpath/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(wr "$P/.SOMI/Config.json" "$LOWCONTENT")")" "silent|silent"
tree nooutside; mutate nooutside hooks/pre-tool/guard-cost-lowering.mjs "askPretool(payload, OUTSIDE);" "return;"
P="$(proj)"; OTHER="$(proj)"
check "red proof: without the project_dir check an outside directory is not asked about" "$(verdict "$TMP/nooutside/hooks/pre-tool/guard-cost-lowering.mjs" "$P" "$(pd "$OTHER")")" "silent"

# An audit log path under /proc used to make fs.mkdirSync({recursive}) spin forever, which hung every hook that
# writes an audit line. The hook must now finish (with an error or not) well inside the timeout.
P="$(proj)"
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | CLAUDE_PROJECT_DIR="$P" SOMI_AUDIT_LOG=/proc/nope/x.log timeout 20 node "$ROOT_REPO/hooks/pre-tool/block-dangerous-bash.mjs" >/dev/null 2>&1; rc=$?
if [ "$rc" -ne 124 ]; then ok "an audit log path that cannot be created fails fast instead of hanging the hook (exit $rc)"; else bad "a hook hung on an audit log path under /proc"; fi

echo "cost lowering tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
