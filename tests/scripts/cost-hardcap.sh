#!/usr/bin/env bash
# Guard for the shared `cost.*` config validator (scripts/lib/cost-config.mjs), read through
# readCostConfig. Each rejection case is also proven red: the check is deleted from a COPY of the
# lib and the same case must then be accepted, so a passing run means the check is what rejects it.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB_SRC="$ROOT_REPO/scripts/lib"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

echo "== cost config validator =="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# $1 = lib dir, $2 = config.json body. Prints "ok" or "reject: <message>".
verdict() {
  local root; root="$(mktemp -d -p "$TMP")"; mkdir -p "$root/.somi"
  printf '%s' "$2" > "$root/.somi/config.json"
  node --input-type=module -e "
    const { readCostConfig } = await import('$1/cost-ceiling.mjs');
    try { readCostConfig('$root'); console.log('ok'); } catch (e) { console.log('reject: ' + e.message); }"
}

mutant() { # $1 = name, $2 = sed expression deleting one check; builds $TMP/$1 from the real lib
  mkdir -p "$TMP/$1"
  cp "$LIB_SRC/cost-ceiling.mjs" "$LIB_SRC/cost-model.mjs" "$LIB_SRC/cost-config.mjs" "$LIB_SRC/config-files.mjs" "$TMP/$1/"
  sed -i "$2" "$TMP/$1/cost-config.mjs"
  cmp -s "$LIB_SRC/cost-config.mjs" "$TMP/$1/cost-config.mjs" && { bad "mutant $1 did not change the file"; return 1; }
  return 0
}

# name | config body | mutant that must make it pass | substring of the real error
reject_case() {
  local name="$1" body="$2" mut="$3" want="$4" got red
  got="$(verdict "$LIB_SRC" "$body")"
  case "$got" in "reject: "*"$want"*) ok "rejects $name" ;; *) bad "rejects $name (got: $got)" ;; esac
  red="$(verdict "$TMP/$mut" "$body")"
  if [ "$red" = "ok" ]; then ok "red proof: $name is accepted once its check is removed"; else bad "red proof: $name still rejected without its check ($red)"; fi
}

mutant unknown-key 's/!COST_CONFIG_KEYS.includes(key)/false/' &&
mutant forbidden   's/FORBIDDEN_KEYS.includes(name)/false/' &&
mutant name        's/!AGENT_NAME_RE.test(name)/false/' &&
mutant tier        's/!VALID_COSTS.includes(tier)/false/' &&
mutant agents-type 's/agents === null || typeof agents !== .object. || Array.isArray(agents)/false/' || exit 1

reject_case "an unknown cost key"       '{"cost":{"cieling":"low"}}'              unknown-key 'unrecognized key "cieling"'
reject_case "a constructor agent name"  '{"cost":{"agents":{"constructor":"low"}}}' forbidden   'forbidden agent name "constructor"'
reject_case "a prototype agent name"    '{"cost":{"agents":{"prototype":"low"}}}'   forbidden   'forbidden agent name "prototype"'
reject_case "a malformed agent name"    '{"cost":{"agents":{"Bad_Name":"low"}}}'    name        'invalid agent name'
reject_case "a bad tier"                '{"cost":{"agents":{"somi-coder":"turbo"}}}'     tier        'cost.agents.somi-coder expected one of'
reject_case "a non-object agents map"   '{"cost":{"agents":5}}'             agents-type 'cost.agents'

# __proto__ is an own key after JSON.parse. Both the allowlist and the name regex already reject it,
# so no single-check mutant can turn it green; assert the real behaviour only.
for body in '{"cost":{"__proto__":{"ceiling":"low"}}}' '{"cost":{"agents":{"__proto__":"low"}}}'; do
  case "$(verdict "$LIB_SRC" "$body")" in reject:*) ok "rejects __proto__ ($body)" ;; *) bad "rejects __proto__ ($body)" ;; esac
done

reject_msg() { # $1 = label, $2 = body, $3 = message fragment
  case "$(verdict "$LIB_SRC" "$2")" in *"$3"*) ok "$1" ;; *) bad "$1" ;; esac
}
reject_msg "__proto__ at the top level names the key"  '{"cost":{"__proto__":{"ceiling":"low"}}}' 'unrecognized key "__proto__"'
reject_msg "__proto__ as an agent name is forbidden"   '{"cost":{"agents":{"__proto__":"low"}}}'   'forbidden agent name "__proto__"'
reject_msg "agents: null is rejected"                  '{"cost":{"agents":null}}'                 'cost.agents'
reject_msg "agents: [] is rejected"                    '{"cost":{"agents":[]}}'                   'cost.agents'
case "$(verdict "$LIB_SRC" "{\"cost\":{\"$(printf 'x%.0s' $(seq 1 300))\":1}}")" in
  *"..."*) ok "a long unknown key is truncated in the message" ;; *) bad "a long unknown key is truncated in the message" ;; esac

case "$(verdict "$LIB_SRC" '{"cost":{"ceiling":"medium","mapping":{},"agents":{"somi-coder":"medium","somi-security-reviewer":"high"}}}')" in
  ok) ok "accepts ceiling, mapping and an agents map together" ;; *) bad "accepts ceiling, mapping and an agents map together" ;; esac
case "$(verdict "$LIB_SRC" '{"cost":{"agents":{}}}')" in ok) ok "accepts an empty agents map" ;; *) bad "accepts an empty agents map" ;; esac

# ---- clamp, override-wins, tier_source/degraded/declared (decideDispatch + resolver + CLI) ----------
echo "== hard cap / override =="
CLI="$ROOT_REPO/scripts/somi-dispatch.mjs"

dd() { # $1 = lib dir, $2 = decideDispatch args -> selected,degraded,tier_source
  node --input-type=module -e "
    const C = await import('$1/cost-ceiling.mjs');
    const d = C.decideDispatch($2); process.stdout.write([d.selected, d.degraded, d.tier_source].join(','))"
}
eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# Red proofs: each mutant breaks exactly one rule in a COPY of the lib; the real case must then fail.
mutant_sel() { # $1 = name, $2 = replacement for the selection expression
  mkdir -p "$TMP/$1"; cp "$LIB_SRC/cost-ceiling.mjs" "$LIB_SRC/cost-model.mjs" "$LIB_SRC/cost-config.mjs" "$LIB_SRC/config-files.mjs" "$TMP/$1/"
  sed -i "s/const selected = override === undefined ? ceiling : override;/const selected = $2;/" "$TMP/$1/cost-ceiling.mjs"
  cmp -s "$LIB_SRC/cost-ceiling.mjs" "$TMP/$1/cost-ceiling.mjs" && bad "mutant $1 did not change the file"
}
mutant_sel no-clamp   'override === undefined ? supported[0] : override'   # old never-degrade: ignore the ceiling
mutant_sel no-override 'ceiling'                                           # override ignored

eq "clamp: high-only agent under ceiling low -> low, degraded, from the ceiling" \
  "$(dd "$LIB_SRC" '["high"], "low"')" "low,true,ceiling"
eq "red proof (clamp): without the clamp the same case runs at high" \
  "$(dd "$TMP/no-clamp" '["high"], "low"')" "high,false,ceiling"
eq "override wins: designer-style high override under ceiling low -> high, source override" \
  "$(dd "$LIB_SRC" '["high"], "low", "high"')" "high,false,override"
eq "red proof (override-wins): with overrides ignored the same case stays at low" \
  "$(dd "$TMP/no-override" '["high"], "low", "high"')" "low,true,override"
eq "an override below the ceiling also wins" \
  "$(dd "$LIB_SRC" '["low","medium","high"], "high", "low"')" "low,true,override"
eq "an override at the declared top is not degraded" \
  "$(dd "$LIB_SRC" '["medium","high"], "low", "high"')" "high,false,override"
case "$(node --input-type=module -e "
  const C = await import('$LIB_SRC/cost-ceiling.mjs');
  try { C.decideDispatch(['high'], 'low', 'turbo'); console.log('ok'); } catch (e) { console.log('reject'); }")" in
  reject) ok "decideDispatch rejects an override that is not a tier" ;; *) bad "decideDispatch rejects an override that is not a tier" ;; esac

# Resolver + CLI against a throwaway project; CLI agents come from the real agents/ directory.
proj() { local r; r="$(mktemp -d -p "$TMP")"; mkdir -p "$r/.somi"; [ -n "${1:-}" ] && printf '%s' "$1" > "$r/.somi/config.json"; echo "$r"; }
cli() { local r="$1"; shift; CLAUDE_PROJECT_DIR="$r" env -u SOMI_COST_CEILING node "$CLI" resolve "$@"; }
field() { node -e "const r=JSON.parse(process.argv[1]); const v=r[process.argv[2]]; process.stdout.write(Array.isArray(v)?v.join('|'):String(v))" "$1" "$2"; }

P="$(proj '{"cost":{"ceiling":"low"}}')"
out="$(cli "$P" --agent somi-designer)"
eq "CLI: high-only designer, ceiling low, no override -> tier low" "$(field "$out" tier)" "low"
eq "CLI: ... degraded true"  "$(field "$out" degraded)" "true"
eq "CLI: ... declared [high]" "$(field "$out" declared)" "high"
eq "CLI: ... tier_source ceiling" "$(field "$out" tier_source)" "ceiling"
eq "CLI: ... supported still reported" "$(field "$out" supported)" "high"

P="$(proj '{"cost":{"ceiling":"low","agents":{"somi-designer":"high"}}}')"
out="$(cli "$P" --agent somi-designer)"
eq "CLI: cost.agents.somi-designer=high beats ceiling low -> tier high" "$(field "$out" tier)" "high"
eq "CLI: ... tier_source override" "$(field "$out" tier_source)" "override"
eq "CLI: ... not degraded" "$(field "$out" degraded)" "false"
out="$(cli "$P" --agent somi-coder)"
eq "CLI: an agent with no override (coder, declared low|medium) resolves to the ceiling" "$(field "$out" tier)" "low"
eq "CLI: ... tier_source ceiling" "$(field "$out" tier_source)" "ceiling"

P="$(proj '{"cost":{"ceiling":"high"}}')"
out="$(cli "$P" --agent somi-coder)"
eq "CLI: ceiling above the declared set -> the ceiling (high), not degraded" "$(field "$out" tier)/$(field "$out" degraded)" "high/false"

P="$(proj '{"cost":{"agents":{"somi-designer":"turbo"}}}')"; rc=0
cli "$P" --agent somi-designer >/dev/null 2>&1 || rc=$?
eq "CLI: a bad override value exits 67" "$rc" "67"
P="$(proj '{"cost":{"agents":{"nonexistent-agent":"high"}}}')"; rc=0
cli "$P" --agent somi-coder >/dev/null 2>&1 || rc=$?
eq "CLI: an unknown agent name in cost.agents is not an error" "$rc" "0"

# An agent file literally named "constructor" has no default-tier table entry, so it is 66: the null-prototype
# table must not hand back an inherited value. (The cost.agents hasOwn guard is now unreachable from
# resolveDispatch by construction: the table lookup fails first.)
INST="$TMP/inst"; mkdir -p "$INST/agents"
printf -- '---\nname: constructor\n---\n' > "$INST/agents/constructor.md"
P="$(proj '{"cost":{"ceiling":"low","agents":{"somi-coder":"high"}}}')"
eq "resolver: --agent constructor (no table entry) is 66 and names the default tier table, not an inherited value" \
  "$(node --input-type=module -e "
    const R = await import('$LIB_SRC/dispatch-resolver.mjs');
    const o = R.resolveDispatch({ agent: 'constructor', projectRoot: '$P', installRoot: '$INST' });
    process.stdout.write(o.ok ? o.result.tier + ',' + o.result.tier_source : 'code ' + o.code + ' ' + o.message)")" "code 66 agent \"constructor\" has no entry in the default tier table (scripts/lib/cost-defaults.mjs)"

eq "resolver re-exports the one AGENT_NAME_RE from cost-config" \
  "$(node --input-type=module -e "
    const R = await import('$LIB_SRC/dispatch-resolver.mjs'); const K = await import('$LIB_SRC/cost-config.mjs');
    process.stdout.write(String(R.AGENT_NAME_RE === K.AGENT_NAME_RE))")" "true"
! grep -q 'AGENT_NAME_RE = /' "$LIB_SRC/dispatch-resolver.mjs" && ok "dispatch-resolver.mjs holds no AGENT_NAME_RE literal" || bad "dispatch-resolver.mjs holds no AGENT_NAME_RE literal"

# ---- size cap on .somi/config.json (spec section 8) --------------------------------------------
big() { printf '{"cost":{"ceiling":"low"},"pad":"'; head -c "$1" /dev/zero | tr '\0' 'x'; printf '"}'; }
P="$(proj)"; big 70000 > "$P/.somi/config.json"; rc=0
cli "$P" --agent somi-coder >/dev/null 2>&1 || rc=$?
eq "an oversize config.json (70000 bytes) exits 67 through the CLI" "$rc" "67"
eq "... and the message names the byte limit" \
  "$(cli "$P" --agent somi-coder 2>&1 | grep -c 'byte limit')" "1"
P="$(proj)"; big 60000 > "$P/.somi/config.json"; rc=0
cli "$P" --agent somi-coder >/dev/null 2>&1 || rc=$?
eq "a config.json under the cap (60000 bytes) is still read" "$rc" "0"
# Red proof: raise the cap in a copy and the oversize file is accepted.
mkdir -p "$TMP/nocap"; cp "$LIB_SRC"/cost-*.mjs "$LIB_SRC/config-files.mjs" "$TMP/nocap/"
sed -i 's/64 \* 1024/64 * 1024 * 1024/' "$TMP/nocap/config-files.mjs"
P="$(proj)"; big 70000 > "$P/.somi/config.json"
eq "red proof (size cap): without the cap the 70000-byte file is read" \
  "$(node --input-type=module -e "
    const C = await import('$TMP/nocap/cost-ceiling.mjs');
    try { C.readCostConfig('$P'); console.log('ok'); } catch (e) { console.log('reject'); }")" "ok"

# ---- the read is fd-based: boundary sizes, links followed, non-regular files refused ------------
exact() { local pre='{"cost":{"ceiling":"low"},"pad":"' suf='"}'; printf '%s' "$pre"; head -c "$(( $1 - ${#pre} - ${#suf} ))" /dev/zero | tr '\0' 'x'; printf '%s' "$suf"; }
P="$(proj)"; exact 65536 > "$P/.somi/config.json"; rc=0
cli "$P" --agent somi-coder >/dev/null 2>&1 || rc=$?
eq "a config.json of exactly 65536 bytes is accepted" "$rc" "0"
P="$(proj)"; exact 65537 > "$P/.somi/config.json"; rc=0
cli "$P" --agent somi-coder >/dev/null 2>&1 || rc=$?
eq "a config.json of 65537 bytes is rejected with 67" "$rc" "67"

# Config reads follow links (a junction or symlinked .somi, a linked config file); what a link could
# abuse -- a device or FIFO that never ends, an endless read -- is refused on the open descriptor.
P="$(proj)"; ln -s /dev/zero "$P/.somi/config.json"; rc=0
timeout 10 env CLAUDE_PROJECT_DIR="$P" env -u SOMI_COST_CEILING node "$CLI" resolve --agent somi-coder >"$TMP/sym.out" 2>"$TMP/sym.err" || rc=$?
eq "a config.json symlink to /dev/zero is rejected quickly with 67 (no timeout)" "$rc" "67"
eq "... and the message says it is not a regular file" "$(grep -c 'not a regular file' "$TMP/sym.err")" "1"
P="$(proj)"; rm -f "$P/.somi/config.json"; mkfifo "$P/.somi/config.json"; rc=0
timeout 10 env CLAUDE_PROJECT_DIR="$P" env -u SOMI_COST_CEILING node "$CLI" resolve --agent somi-coder >/dev/null 2>"$TMP/fifo.err" || rc=$?
eq "a config.json that is a FIFO is rejected quickly with 67 (the open does not block)" "$rc" "67"
P="$(proj '{"cost":{"ceiling":"low"}}')"; mv "$P/.somi/config.json" "$P/real.json"; ln -s ../real.json "$P/.somi/config.json"; rc=0
out="$(cli "$P" --agent somi-coder 2>/dev/null)" || rc=$?
eq "a symlink to an ordinary valid config is read" "$rc|$(printf '%s' "$out" | grep -o '"tier":"[a-z]*"')" '0|"tier":"low"'
P="$(mktemp -d -p "$TMP")"; SHARED="$(mktemp -d -p "$TMP")"; printf '{"cost":{"ceiling":"low"}}' > "$SHARED/config.json"; ln -s "$SHARED" "$P/.somi"; rc=0
out="$(cli "$P" --agent somi-coder 2>/dev/null)" || rc=$?
eq "a .somi that is a link to another directory (a junction on Windows) is read through" "$rc|$(printf '%s' "$out" | grep -o '"tier":"[a-z]*"')" '0|"tier":"low"'
P="$(proj)"; mkdir "$P/.somi/config.json"; rc=0
cli "$P" --agent somi-coder >"$TMP/dir.out" 2>"$TMP/dir.err" || rc=$?
eq "a config.json that is a directory is rejected with 67" "$rc" "67"

verdict_file() { # $1 = lib dir, $2 = project root -> ok | reject: msg
  node --input-type=module -e "
    const C = await import('$1/cost-ceiling.mjs');
    try { C.readCostConfig('$2'); console.log('ok'); } catch (e) { console.log('reject: ' + e.message); }"
}
mkdir -p "$TMP/nofile" "$TMP/blocking"
cp "$LIB_SRC"/cost-*.mjs "$LIB_SRC/config-files.mjs" "$TMP/nofile/"; cp "$LIB_SRC"/cost-*.mjs "$LIB_SRC/config-files.mjs" "$TMP/blocking/"
sed -i 's/!fs.fstatSync(fd).isFile()/false/' "$TMP/nofile/config-files.mjs"
sed -i 's/fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0)/fs.constants.O_RDONLY/' "$TMP/blocking/config-files.mjs"
cmp -s "$LIB_SRC/config-files.mjs" "$TMP/nofile/config-files.mjs" && bad "mutant nofile did not change the file"
cmp -s "$LIB_SRC/config-files.mjs" "$TMP/blocking/config-files.mjs" && bad "mutant blocking did not change the file"
P="$(proj)"; rm -f "$P/.somi/config.json"; mkfifo "$P/.somi/config.json"; rc=0
timeout 5 node --input-type=module -e "const C = await import('$TMP/blocking/cost-ceiling.mjs'); try { C.readCostConfig('$P'); } catch {}" >/dev/null 2>&1 || rc=$?
eq "red proof (O_NONBLOCK): without it a FIFO config hangs the read (timeout)" "$rc" "124"
P="$(proj)"; mkdir "$P/.somi/config.json"
case "$(verdict_file "$LIB_SRC" "$P")" in *"not a regular file"*) ok "a directory config is rejected by the regular-file check" ;; *) bad "a directory config is rejected by the regular-file check" ;; esac
case "$(verdict_file "$TMP/nofile" "$P")" in *"not a regular file"*) bad "red proof (isFile): the regular-file message persists without the check" ;; *) ok "red proof (isFile): without the check the regular-file rejection is gone" ;; esac

# The JSON-parse error never echoes file text: only the error name and a position.
P="$(proj)"; printf '\n\x01\x1b[31mSECRET-TOKEN {not json' > "$P/.somi/config.json"
msg="$(verdict_file "$LIB_SRC" "$P")"
case "$msg" in *SECRET-TOKEN*|*$'\x1b'*|*$'\x01'*) bad "parse error leaked file text: $msg" ;; reject:*"not valid JSON"*) ok "a malformed config's parse error carries no file text or control characters" ;; *) bad "unexpected parse verdict: $msg" ;; esac
eq "... and the message is a single line" "$(printf '%s' "$msg" | wc -l)" "0"

# ---- ceiling precedence: explicit > live config > persisted CLI/env state > default (medium) -----
echo "== ceiling precedence =="
rc_() { # $1 = lib dir, $2 = project root -> ceiling,source,origin for a bare resolve
  node --input-type=module -e "
    const C = await import('$1/cost-ceiling.mjs');
    const r = C.resolveCeiling('$2', undefined); process.stdout.write([r.ceiling, r.source, r.ceiling_origin].join(','))"
}
pj() { # $1 = config body or '', $2 = state body or ''
  local r; r="$(mktemp -d -p "$TMP")"; mkdir -p "$r/.somi/somi-state"
  [ -n "$1" ] && printf '%s' "$1" > "$r/.somi/config.json"
  [ -n "$2" ] && printf '%s' "$2" > "$r/.somi/somi-state/ceiling.json"
  echo "$r"
}
mut_prec() { # $1 = name, $2 = sed expression
  mkdir -p "$TMP/$1"; cp "$LIB_SRC"/cost-*.mjs "$LIB_SRC/config-files.mjs" "$TMP/$1/"; sed -i "$2" "$TMP/$1/cost-ceiling.mjs"
  cmp -s "$LIB_SRC/cost-ceiling.mjs" "$TMP/$1/cost-ceiling.mjs" && bad "mutant $1 did not change the file"
}
mut_prec config-ignored   's/^    if (isConfigured) {$/    if (false) {/'
mut_prec state-outranks   's/if (state \&\& EXPLICIT_ORIGINS.includes(state.ceiling_origin)) {/if (state) {/'
mut_prec default-high     "s/export const DEFAULT_CEILING = 'medium';/export const DEFAULT_CEILING = 'high';/"

P="$(pj '{"cost":{"ceiling":"low"}}' '')"
eq "config alone sets the ceiling, source config" "$(rc_ "$LIB_SRC" "$P")" "low,config,config"
printf '{"cost":{"ceiling":"high"}}' > "$P/.somi/config.json"
eq "an edit between two resolves moves the ceiling (config is read live)" "$(rc_ "$LIB_SRC" "$P")" "high,config,config"
eq "red proof (config-live): with the config read removed the edit has no effect" "$(rc_ "$TMP/config-ignored" "$P")" "medium,default,default"

P="$(pj '{"cost":{"ceiling":"low"}}' '{"ceiling":"high","ceiling_origin":"cli"}')"
eq "config outranks a persisted cli ceiling (config > persisted state)" "$(rc_ "$LIB_SRC" "$P")" "low,config,config"
P="$(pj '' '{"ceiling":"low","ceiling_origin":"env"}')"
eq "a persisted env ceiling applies when config is silent" "$(rc_ "$LIB_SRC" "$P")" "low,state,env"

LEGACY='{"ceiling":"high"}' # a state file written before origins were recorded
P="$(pj '' "$LEGACY")"
[ "$(cat "$P/.somi/somi-state/ceiling.json")" = "$LEGACY" ] || bad "legacy fixture was not written"
eq "a legacy state file (no origin) yields to the medium default" "$(rc_ "$LIB_SRC" "$P")" "medium,default,default"
eq "red proof (state-yields): if any state outranked the default, the legacy file would win" "$(rc_ "$TMP/state-outranks" "$P")" "high,state,"
P="$(pj '' '{"ceiling":"high","ceiling_origin":"default"}')"
eq "a default-origin state yields to the default" "$(rc_ "$LIB_SRC" "$P")" "medium,default,default"
P="$(pj '' '')"
eq "no config and no state: medium" "$(rc_ "$LIB_SRC" "$P")" "medium,default,default"
eq "red proof (default medium): the mutant default is high" "$(rc_ "$TMP/default-high" "$P")" "high,default,default"

# ---- untrusted text never echoed; state writes are atomic and symlink-safe; raises recorded ------
echo "== ceiling hardening =="
nasty() { printf 'bad\n\033[31m'; head -c 100 /dev/zero | tr '\0' 'y'; printf 'SECRET-TOKEN'; head -c 3000 /dev/zero | tr '\0' 'y'; }
clean_msg() { # $1 = label, $2 = message
  case "$2" in
    reject:*SECRET-TOKEN*|*$'\033'*|*$'\n'*SECRET*) bad "$1 leaked untrusted text" ;;
    reject:*) if [ "${#2}" -lt 600 ]; then ok "$1 carries no file text, control characters or 3000-char echo"; else bad "$1 message is unbounded (${#2})"; fi ;;
    *) bad "$1 was not rejected ($2)" ;;
  esac
}
resolve_msg() { # $1 = project root -> reject: <message> | ok
  node --input-type=module -e "
    const C = await import('$LIB_SRC/cost-ceiling.mjs');
    try { C.resolveCeiling('$1', undefined); console.log('ok'); } catch (e) { console.log('reject: ' + e.message); }"
}
P="$(proj)"; node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({cost:{ceiling:process.argv[2]}}))" "$P/.somi/config.json" "$(nasty)"
clean_msg "a bad cost.ceiling value" "$(resolve_msg "$P")"
P="$(pj '' '')"; node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ceiling:process.argv[2]}))" "$P/.somi/somi-state/ceiling.json" "$(nasty)"
clean_msg "a bad state ceiling" "$(resolve_msg "$P")"
P="$(pj '' '')"; node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ceiling:'low',ceiling_origin:process.argv[2]}))" "$P/.somi/somi-state/ceiling.json" "$(nasty)"
clean_msg "a bad state ceiling_origin" "$(resolve_msg "$P")"
P="$(pj '' '')"; printf '\n\033[31mSECRET-TOKEN {not json' > "$P/.somi/somi-state/ceiling.json"
clean_msg "an unparsable state file" "$(resolve_msg "$P")"

# A symlink at ceiling.json is refused on read (67)...
P="$(pj '' '')"; echo KEEP > "$TMP/victim.txt"; ln -s "$TMP/victim.txt" "$P/.somi/somi-state/ceiling.json"
rc=0; CLAUDE_PROJECT_DIR="$P" env -u SOMI_COST_CEILING node "$CLI" resolve --agent somi-coder --ceiling low >/dev/null 2>&1 || rc=$?
eq "resolve --ceiling over a symlinked state path exits 67" "$rc" "67"
eq "... and the symlink target was never modified" "$(cat "$TMP/victim.txt")" "KEEP"
# ...and one planted between the read and the write is replaced by the atomic rename, not followed.
P="$(pj '' '')"
node --input-type=module -e "
  import fs from 'node:fs';
  const C = await import('$LIB_SRC/cost-ceiling.mjs');
  const f = C.ceilingStatePath('$P');
  const mk = fs.mkdirSync;
  fs.mkdirSync = (...a) => { const r = mk(...a); fs.symlinkSync('$TMP/victim.txt', f); return r; };
  C.resolveCeiling('$P', 'low');"
eq "a symlink planted before the write is replaced, never written through" "$(cat "$TMP/victim.txt")" "KEEP"
eq "... ceiling.json is now a regular file holding the new state, with no temp file left" \
  "$([ -f "$P/.somi/somi-state/ceiling.json" ] && [ ! -L "$P/.somi/somi-state/ceiling.json" ] && tr -d '\n' < "$P/.somi/somi-state/ceiling.json" | grep -c '"ceiling":"low"'; ls "$P/.somi/somi-state" | tr '\n' ' ')" "1
ceiling.json "

# A raise over a differing config is recorded even when persisted state already holds the value.
P="$(pj '{"cost":{"ceiling":"low"}}' '{"ceiling":"high","ceiling_origin":"cli"}')"
out="$(node --input-type=module -e "
  const C = await import('$LIB_SRC/cost-ceiling.mjs');
  const r = C.resolveCeiling('$P', 'high');
  const r2 = C.resolveCeiling('$P', 'high');
  const fs = await import('node:fs');
  const s = JSON.parse(fs.readFileSync(C.ceilingStatePath('$P'), 'utf8'));
  process.stdout.write([r.overridden, r.override?.from, r.override?.to, r2.overridden, s.ceiling_overrides.length].join(','))")"
eq "persisted high over config low: the raise is recorded (from the config value), a repeat is reported but not duplicated" "$out" "true,low,high,true,1"
P="$(pj '{"cost":{"ceiling":"high"}}' '{"ceiling":"high","ceiling_origin":"cli"}')"
eq "persisted high, config high, --ceiling high: nothing changes, nothing recorded" \
  "$(node --input-type=module -e "const C = await import('$LIB_SRC/cost-ceiling.mjs'); process.stdout.write(String(C.resolveCeiling('$P', 'high').overridden))")" "false"

echo "cost hardcap tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
