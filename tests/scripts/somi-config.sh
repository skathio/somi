#!/usr/bin/env bash
# Guard for scripts/somi-config.mjs: show/get/set/unset/init over a project's .somi/config.json.
# Checks every operation, byte-exact init, preservation of unrelated keys, the key allowlist, whole-block
# validation, exit codes (64 arguments / 67 the project's files), no-follow and atomic writes, and
# agreement with the resolver. The safety checks are also proven red on mutated copies of the script.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT_REPO/scripts/somi-config.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

echo "== somi-config =="

TMP="$(mktemp -d)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

proj() { mktemp -d -p "$TMP"; }
# $1 = cli, $2 = project, rest = args -> stdout in $TMP/out, stderr in $TMP/err, prints the exit code
cfg() { local cli=$1 p=$2; shift 2; node "$cli" "$@" --project-dir "$p" > "$TMP/out" 2> "$TMP/err"; echo $?; }
jf() { node -e "const o=JSON.parse(require('fs').readFileSync('$TMP/out','utf8')); const v=($1); process.stdout.write(typeof v==='string'?v:JSON.stringify(v))"; }
EXPECT="$TMP/expected.json"
node --input-type=module -e "const D = await import('$ROOT_REPO/scripts/lib/cost-defaults.mjs'); process.stdout.write(D.serializeDefaultConfig())" > "$EXPECT"
res() { CLAUDE_PROJECT_DIR="$1" env -u SOMI_COST_CEILING node "$ROOT_REPO/scripts/somi-dispatch.mjs" resolve --agent "$2"; }
fld() { node -e "process.stdout.write(String(JSON.parse(process.argv[1])[process.argv[2]]))" "$1" "$2"; }
ascii_only() { LC_ALL=C grep -q -P '[^\x09\x0a\x20-\x7e]' "$1" && echo no || echo yes; }

# --- init: byte-exact, no-op when present ---------------------------------------------------------
P="$(proj)"
check "init: exit 0" "$(cfg "$CLI" "$P" init)" "0"
check "init creates exactly the text the SessionStart hook writes" "$(cmp -s "$P/.somi/config.json" "$EXPECT" && echo same)" "same"
check "init output says created" "$(jf 'o.created')" "true"
check ".somi was created with mode 700" "$(stat -c %a "$P/.somi")" "700"
printf '{"mine":1}' > "$P/.somi/config.json"
check "init over an existing file: exit 0" "$(cfg "$CLI" "$P" init)" "0"
check "... a no-op, file untouched, reported created:false" "$(cat "$P/.somi/config.json")|$(jf 'o.created')" '{"mine":1}|false'

# --- show -----------------------------------------------------------------------------------------
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
check "show: exit 0" "$(cfg "$CLI" "$P" show)" "0"
check "show on a fresh default config: ceiling medium from config" "$(jf 'o.ceiling')" '{"value":"medium","source":"config"}'
check "show: every shipped agent is listed with default, tier, source" "$(jf 'o.agents.length === Object.keys(JSON.parse(require("fs").readFileSync("'"$EXPECT"'","utf8")).cost.agents).length && o.agents.every((a) => a.tier === a.default && a.source === "override")')" "true"
check "show: no warnings for a fresh default config" "$(jf 'o.warnings')" "[]"
check "show output is one ASCII line" "$(wc -l < "$TMP/out" | tr -d ' ')|$(ascii_only "$TMP/out")" "1|yes"
P="$(proj)"
check "show with no config file: exists false, ceiling default medium" "$(cfg "$CLI" "$P" show)|$(jf 'o.exists')|$(jf 'o.ceiling')" '0|false|{"value":"medium","source":"default"}'
check "show with no config: agents follow the ceiling, security-reviewer warning present" "$(jf 'o.agents.find((a) => a.name === "somi-security-reviewer").tier + "/" + o.agents.find((a) => a.name === "somi-security-reviewer").source')|$(jf 'o.warnings.length')" "medium/ceiling|1"
check "show created nothing" "$([ -e "$P/.somi" ] && echo made || echo none)" "none"

# --- cost.mapping.<host>.<tier>: the writer behind the Copilot model picker (#34, #35) ---------------
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
check "set cost.mapping.copilot.high to a preference list: stored as an array, parsed value echoed" \
  "$(cfg "$CLI" "$P" set cost.mapping.copilot.high 'big-a, big-b')|$(jf 'JSON.stringify(o.value)')|$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cost.mapping.copilot.high))' "$P/.somi/config.json")" \
  '0|["big-a","big-b"]|["big-a","big-b"]'
check "... with a warning naming the tiers the host map still lacks" "$(jf 'o.warnings.some((w) => w.startsWith("cost.mapping.copilot has no low, medium entry yet"))')" "true"
cfg "$CLI" "$P" set cost.mapping.copilot.low mini-x > /dev/null; cfg "$CLI" "$P" set cost.mapping.copilot.medium mid-x > /dev/null
check "a single id is stored as a string; a complete host map has no incomplete-map warning" "$(cfg "$CLI" "$P" get cost.mapping.copilot.low)|$(jf 'o.value')|$(cfg "$CLI" "$P" show)|$(jf 'o.warnings.some((w) => w.includes("cost.mapping"))')" "0|mini-x|0|false"
check "the resolver now enforces copilot's high tier with the first candidate" "$(CLAUDE_PROJECT_DIR="$P" env -u SOMI_COST_CEILING node "$ROOT_REPO/scripts/somi-dispatch.mjs" resolve --agent somi-designer --host copilot | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(o.model+"/"+o.enforced)')" "big-a/true"
check "a remap with --refuse-lowering is refused (64) with its own message" "$(cfg "$CLI" "$P" set cost.mapping.copilot.high cheap-x --refuse-lowering)|$(grep -c 'remaps a tier to a different model' "$TMP/err")" "64|1"
for v in 'bad id' 'a,a' ',' "$(printf 'm%d,' 1 2 3 4 5 6 7 8 9 | sed 's/,$//')"; do
  check "a bad model value is a usage error (64): $v" "$(cfg "$CLI" "$P" set cost.mapping.copilot.high "$v")" "64"
done
check "set on a whole host map (no tier) is a usage error (64)" "$(cfg "$CLI" "$P" set cost.mapping.copilot gpt-x)" "64"
check "unset cost.mapping.copilot removes the host map" "$(cfg "$CLI" "$P" unset cost.mapping.copilot)|$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cost.mapping))' "$P/.somi/config.json")" "0|undefined"

# --- show --host: the unmapped-host warning (#36) --------------------------------------------------
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
check "show --host copilot, default config (10 agents pinned high), no mapping: one unmapped warning naming the count" \
  "$(cfg "$CLI" "$P" show --host copilot)|$(jf 'o.warnings.filter((w) => w.startsWith("copilot has no model mapping, so 10 high-tier agent(s)")).length')" "0|1"
check "show --host claude-code: shipped mapping, no unmapped warning" "$(cfg "$CLI" "$P" show --host claude-code)|$(jf 'o.warnings')" "0|[]"
check "show without --host: no unmapped warning (the host is unknown)" "$(cfg "$CLI" "$P" show)|$(jf 'o.warnings')" "0|[]"
node -e 'const f=process.argv[1];const c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.cost.mapping={copilot:{low:"m-low",medium:"m-mid",high:"m-high"}};require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "$P/.somi/config.json"
check "show --host copilot with cost.mapping.copilot set: no unmapped warning" "$(cfg "$CLI" "$P" show --host copilot)|$(jf 'o.warnings')" "0|[]"
P="$(proj)"; mkdir -p "$P/.somi"
printf '{"cost":{"ceiling":"low"}}\n' > "$P/.somi/config.json"
check "show --host copilot where nothing resolves high: no unmapped warning" "$(cfg "$CLI" "$P" show --host copilot)|$(jf 'o.warnings.some((w) => w.includes("no model mapping"))')" "0|false"
check "--host on set is a usage error (64)" "$(cfg "$CLI" "$P" set cost.ceiling high --host copilot)" "64"
check "--host with a bad name is a usage error (64)" "$(cfg "$CLI" "$P" show --host 'Co pilot')" "64"

# --- get / set / unset ----------------------------------------------------------------------------
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
check "get cost.ceiling" "$(cfg "$CLI" "$P" get cost.ceiling)|$(jf 'o.value + "/" + o.source')" "0|medium/config"
check "get cost.agents.somi-coder" "$(cfg "$CLI" "$P" get cost.agents.somi-coder)|$(jf 'o.value + "/" + o.source')" "0|medium/override"
check "get cost.agents.nobody -> null" "$(cfg "$CLI" "$P" get cost.agents.nobody)|$(jf 'o.value + "/" + o.source')" "0|null/none"
check "set cost.ceiling low" "$(cfg "$CLI" "$P" set cost.ceiling low)|$(jf 'o.changed')" "0|true"
out="$(res "$P" somi-coder)"
check "resolver agrees: the new ceiling is live, coder (pinned medium) stays medium" "$(fld "$out" ceiling)/$(fld "$out" tier)" "low/medium"
cfg "$CLI" "$P" set cost.agents.somi-designer low > /dev/null
out="$(res "$P" somi-designer)"
check "resolver agrees: set cost.agents.somi-designer low -> low/override" "$(fld "$out" tier)/$(fld "$out" tier_source)" "low/override"
cfg "$CLI" "$P" set cost.agents.somi-designer high > /dev/null
out="$(res "$P" somi-designer)"
check "resolver agrees: set cost.agents.somi-designer high -> high/override (above the low ceiling)" "$(fld "$out" tier)/$(fld "$out" tier_source)" "high/override"
check "set to the same value is a no-op (changed false)" "$(cfg "$CLI" "$P" set cost.agents.somi-designer high)|$(jf 'o.changed')" "0|false"
cfg "$CLI" "$P" unset cost.agents.somi-designer > /dev/null
out="$(res "$P" somi-designer)"
check "unset removes the pin: designer follows the ceiling" "$(fld "$out" tier)/$(fld "$out" tier_source)" "low/ceiling"
check "unset of an absent entry succeeds with changed:false" "$(cfg "$CLI" "$P" unset cost.agents.somi-designer)|$(jf 'o.changed')" "0|false"
check "no temp file is left behind" "$(ls -A "$P/.somi" | tr '\n' ' ')" "config.json "
P2="$(proj)"; cfg "$CLI" "$P2" set cost.ceiling high > /dev/null
check "set on an absent config starts from the default file (pins exist) with the change applied" "$(node -e "const a=JSON.parse(require('fs').readFileSync('$P2/.somi/config.json','utf8')), d=JSON.parse(require('fs').readFileSync('$EXPECT','utf8')); d.cost.ceiling='high'; process.stdout.write(String(JSON.stringify(a)===JSON.stringify(d)))")" "true"
P2="$(proj)"
check "unset on an absent config is a no-op: changed false, nothing created" "$(cfg "$CLI" "$P2" unset cost.agents.somi-coder)|$(jf 'o.changed')|$([ -e "$P2/.somi" ] && echo made || echo none)" "0|false|none"
P2="$(proj)"; cfg "$CLI" "$P2" init > /dev/null; sleep 1; before="$(stat -c '%i %Y' "$P2/.somi/config.json")"
check "unset of an absent entry writes nothing (inode and mtime unchanged)" "$(cfg "$CLI" "$P2" unset cost.agents.nobody)|$(jf 'o.changed')|$(stat -c '%i %Y' "$P2/.somi/config.json")" "0|false|$before"

# --- preservation and ordering --------------------------------------------------------------------
P="$(proj)"; mkdir "$P/.somi"
printf '%s' '{"zeta":{"keep":[1,2,{"a":null}]},"loop":{"max":3},"cost":{"mapping":{},"ceiling":"high","agents":{"somi-coder":"low"}},"alpha":"x"}' > "$P/.somi/config.json"
cfg "$CLI" "$P" set cost.agents.somi-planner medium > /dev/null
check "unrelated and unknown top-level keys are preserved, key order is stable, new entry appended" \
  "$(node -e "const o=JSON.parse(require('fs').readFileSync('$P/.somi/config.json','utf8')); process.stdout.write(Object.keys(o).join()+'|'+Object.keys(o.cost).join()+'|'+Object.keys(o.cost.agents).join()+'|'+JSON.stringify(o.zeta)+o.alpha+o.loop.max)")" \
  'zeta,loop,cost,alpha|mapping,ceiling,agents|somi-coder,somi-planner|{"keep":[1,2,{"a":null}]}x3'
check "file is 2-space JSON with a trailing newline" "$(head -c 3 "$P/.somi/config.json" | tr '\n' '$')|$(tail -c 2 "$P/.somi/config.json" | od -An -c | tr -d ' ')" '{$ |}\n'
printf '%s' '{"cost":{"ceiling":"high"}}' > "$P/.somi/config.json"; chmod 600 "$P/.somi/config.json"
cfg "$CLI" "$P" set cost.ceiling low > /dev/null
check "an existing file's mode is kept" "$(stat -c %a "$P/.somi/config.json")" "600"

# --- warnings --------------------------------------------------------------------------------------
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
check "set security-reviewer low: succeeds with the fixed warning" "$(cfg "$CLI" "$P" set cost.agents.somi-security-reviewer low)|$(jf 'o.warnings')" '0|["somi-security-reviewer runs below high; pin it with: set cost.agents.somi-security-reviewer high"]'
check "show carries the same warning" "$(cfg "$CLI" "$P" show)|$(jf 'o.warnings.length')" "0|1"
check "set security-reviewer back to high clears it" "$(cfg "$CLI" "$P" set cost.agents.somi-security-reviewer high)|$(jf 'o.warnings')" "0|[]"
check "set an agent not in the default table: accepted, unknown warning" "$(cfg "$CLI" "$P" set cost.agents.my-agent high)|$(jf 'o.warnings.length')" "0|1"
cfg "$CLI" "$P" show > /dev/null
check "show flags the extra name unknown:true with no default" "$(jf 'JSON.stringify(o.agents.find((a) => a.name === "my-agent"))')" '{"name":"my-agent","tier":"high","source":"override","default":null,"unknown":true}'

# --- 64: arguments ---------------------------------------------------------------------------------
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null; cp "$P/.somi/config.json" "$TMP/before"
for args in "set cost.mapping.x low" "set cost.foo low" "set loop.max 3" "set cost.ceiling turbo" "set cost.agents.somi-coder turbo" "set cost.agents.Bad_Name low" "set cost.agents.constructor low" "set cost.agents.__proto__ low" "unset cost.ceiling" "unset loop" "get loop.max" "set cost.ceiling" "frobnicate" "show extra" "set cost.ceiling low --bogus x"; do
  # shellcheck disable=SC2086
  rc="$(cfg "$CLI" "$P" $args)"
  check "bad input exits 64 and prints nothing on stdout: $args" "$rc|$(wc -c < "$TMP/out" | tr -d ' ')" "64|0"
done
check "none of those changed the file" "$(cmp -s "$P/.somi/config.json" "$TMP/before" && echo same)" "same"
check "a project dir that is not a directory exits 64" "$(node "$CLI" show --project-dir "$TMP/no-such-dir" > /dev/null 2>&1; echo $?)" "64"
check "error output is ASCII and does not echo a raw hostile key" "$(cfg "$CLI" "$P" set "$(printf 'cost.\xe2\x80\xaeevil\nx')" low)|$(ascii_only "$TMP/err")" "64|yes"

# --- 67: the project's files -----------------------------------------------------------------------
bad_cfg() { # $1 = label, $2 = body
  P="$(proj)"; mkdir "$P/.somi"; printf '%s' "$2" > "$P/.somi/config.json"
  rc="$(cfg "$CLI" "$P" set cost.ceiling low)"
  check "$1: set exits 67, file untouched" "$rc|$(cat "$P/.somi/config.json")" "67|$2"
  check "$1: show exits 67 too" "$(cfg "$CLI" "$P" show)" "67"
}
bad_cfg "invalid JSON" '{ not json'
bad_cfg "a JSON array" '[1]'
bad_cfg "an unknown cost key" '{"cost":{"cieling":"low"}}'
bad_cfg "a bad tier in the existing file" '{"cost":{"agents":{"somi-coder":"turbo"}}}'
bad_cfg "a bad ceiling value in the existing file" '{"cost":{"ceiling":"turbo"}}'
bad_cfg "a top-level ceiling" '{"ceiling":"low"}'
P="$(proj)"; mkdir "$P/.somi"; head -c 70000 /dev/zero | tr '\0' ' ' > "$P/.somi/config.json"; printf '{}' >> "$P/.somi/config.json"; cp "$P/.somi/config.json" "$TMP/big.before"
check "an oversize config exits 67, untouched" "$(cfg "$CLI" "$P" set cost.ceiling low)|$(cmp -s "$P/.somi/config.json" "$TMP/big.before" && echo same)" "67|same"
check "error text does not echo file text" "$(P="$(proj)"; mkdir "$P/.somi"; printf '{"cost":{"cieling":"SECRET-VALUE"}}' > "$P/.somi/config.json"; cfg "$CLI" "$P" show > /dev/null; grep -c SECRET-VALUE "$TMP/err" | tr -d ' ')" "0"

# --- no-follow ---------------------------------------------------------------------------------------
echo KEEP > "$TMP/victim.txt"; OUTSIDE="$(mktemp -d -p "$TMP")"
P="$(proj)"; ln -s "$OUTSIDE" "$P/.somi"
for op in "set cost.ceiling low" init show; do
  # shellcheck disable=SC2086
  check "a symlinked .somi: $op exits 67" "$(cfg "$CLI" "$P" $op)" "67"
done
check "... nothing was written outside" "$(ls -A "$OUTSIDE" | wc -l | tr -d ' ')" "0"
P="$(proj)"; mkdir "$P/.somi"; printf '{"cost":{"ceiling":"high"}}' > "$TMP/real.json"; ln -s "$TMP/real.json" "$P/.somi/config.json"
check "a symlinked config.json: set exits 67" "$(cfg "$CLI" "$P" set cost.ceiling low)" "67"
check "... the link target is untouched" "$(cat "$TMP/real.json")" '{"cost":{"ceiling":"high"}}'
check "init over a symlinked config.json is a no-op (it exists)" "$(cfg "$CLI" "$P" init)|$(jf 'o.created')" "0|false"
P="$(proj)"; mkdir "$P/.somi"; ln -s "$TMP/not-there.json" "$P/.somi/config.json"
check "init over a dangling symlink is a no-op, nothing created through it" "$(cfg "$CLI" "$P" init)|$([ -e "$TMP/not-there.json" ] && echo made || echo none)" "0|none"
P="$(proj)"; mkdir -p "$P/.somi/config.json"
check "config.json as a directory: set exits 67" "$(cfg "$CLI" "$P" set cost.ceiling low)" "67"

# --- atomic: a failing write leaves the original and no temp file -----------------------------------
if [ "$(id -u)" -eq 0 ]; then
  echo "  skip read-only .somi cases: running as root, chmod does not stop root"
else
  P="$(proj)"; mkdir "$P/.somi"; printf '{"cost":{"ceiling":"high"}}' > "$P/.somi/config.json"; chmod 555 "$P/.somi"
  check "an unwritable .somi: set exits 67" "$(cfg "$CLI" "$P" set cost.ceiling low)" "67"
  check "... the original is intact and no temp file exists" "$(cat "$P/.somi/config.json")|$(ls -A "$P/.somi" | tr '\n' ' ')" '{"cost":{"ceiling":"high"}}|config.json '
  chmod 755 "$P/.somi"
fi

# --- a rewrite must not lose data or exceed what the reader accepts ------------------------------------
exact() { # $1 = total bytes of a 2-space config {pad, cost.ceiling low}
  node -e "const mk=(n)=>JSON.stringify({pad:'x'.repeat(n),cost:{ceiling:'low'}},null,2)+'\n'; const base=mk(0).length; process.stdout.write(mk($1-base))"
}
P="$(proj)"; mkdir "$P/.somi"; exact 65535 > "$P/.somi/config.json"
check "a rewrite that lands exactly on the 64 KiB limit succeeds and the result is readable" "$(cfg "$CLI" "$P" set cost.ceiling high)|$(stat -c %s "$P/.somi/config.json")|$(cfg "$CLI" "$P" show)" "0|65536|0"
P="$(proj)"; mkdir "$P/.somi"; exact 65536 > "$P/.somi/config.json"; cp "$P/.somi/config.json" "$TMP/lim.before"
check "a rewrite one byte over the limit is refused (67), file untouched" "$(cfg "$CLI" "$P" set cost.ceiling high)|$(cmp -s "$P/.somi/config.json" "$TMP/lim.before" && echo same)" "67|same"
P="$(proj)"; mkdir "$P/.somi"; node -e "const n=20000; require('fs').writeFileSync('$P/.somi/config.json', '{\"deep\":'+'['.repeat(n)+']'.repeat(n)+',\"cost\":{\"ceiling\":\"low\"}}')"; cp "$P/.somi/config.json" "$TMP/deep.before"
check "20000-deep unrelated nesting: set exits 67 with one line, no stack trace, file untouched" "$(cfg "$CLI" "$P" set cost.ceiling high)|$(wc -l < "$TMP/err" | tr -d ' ')|$(grep -c ' at ' "$TMP/err" | tr -d ' ')|$(cmp -s "$P/.somi/config.json" "$TMP/deep.before" && echo same)" "67|1|0|same"
for spec in 'big integer|{"big":12345678901234567890,"cost":{"ceiling":"low"}}' 'out-of-range number|{"f":1e400,"cost":{"ceiling":"low"}}' 'duplicate key|{"a":1,"a":2,"cost":{"ceiling":"low"}}' 'nested duplicate key|{"o":{"k":1,"k":2},"cost":{"ceiling":"low"}}' 'duplicate inside cost|{"cost":{"ceiling":"low","ceiling":"high"}}'; do
  label="${spec%%|*}"; body="${spec#*|}"
  P="$(proj)"; mkdir "$P/.somi"; printf '%s' "$body" > "$P/.somi/config.json"
  check "$label: set exits 67 and the file is untouched" "$(cfg "$CLI" "$P" set cost.ceiling high)|$(cat "$P/.somi/config.json")" "67|$body"
  check "$label: show still works (read-only)" "$(cfg "$CLI" "$P" show)" "0"
done
P="$(proj)"; mkdir "$P/.somi"; printf '%s' '{"s":"a,\"k\": 12345678901234567890 {","n":1.0,"safe":9007199254740991,"cost":{"ceiling":"low"}}' > "$P/.somi/config.json"
check "numbers and duplicates inside strings, safe integers and 1.0 do not trigger the refusal" "$(cfg "$CLI" "$P" set cost.ceiling high)|$(node -e "const o=JSON.parse(require('fs').readFileSync('$P/.somi/config.json','utf8')); process.stdout.write(o.s+'|'+o.safe+'|'+o.n+'|'+o.cost.ceiling)")" '0|a,"k": 12345678901234567890 {|9007199254740991|1|high'

# --- the ceiling the resolver would use ---------------------------------------------------------------------
envcfg() { local p=$1; shift; env SOMI_COST_CEILING="$ENVV" node "$CLI" "$@" --project-dir "$p" > "$TMP/out" 2> "$TMP/err"; echo $?; }
P="$(proj)"; mkdir "$P/.somi"; printf '%s' '{"cost":{"ceiling":"high"}}' > "$P/.somi/config.json"
ENVV=low
check "SOMI_COST_CEILING outranks the config: effective ceiling low from env, tiers follow it, warnings say why" "$(envcfg "$P" show)|$(jf 'JSON.stringify(o.effective_ceiling)')|$(jf 'o.agents.find((a) => a.name === "somi-coder").tier')|$(jf 'o.warnings.length')|$(jf 'o.ceiling.value')" '0|{"value":"low","source":"env"}|low|2|high'
check "set reports the effective ceiling too" "$(envcfg "$P" set cost.agents.somi-coder medium)|$(jf 'o.effective_ceiling.source')|$(jf 'o.warnings.length')" "0|env|2"
ENVV=turbo
check "an invalid SOMI_COST_CEILING is exit 64" "$(envcfg "$P" show)" "64"
P="$(proj)"; mkdir -p "$P/.somi/somi-state"; printf '%s' '{}' > "$P/.somi/config.json"; printf '%s' '{"ceiling":"low","ceiling_origin":"cli"}' > "$P/.somi/somi-state/ceiling.json"
check "a persisted cli ceiling is in force when the config sets none: source state, with its warning" "$(cfg "$CLI" "$P" show)|$(jf 'JSON.stringify(o.effective_ceiling)')|$(jf 'o.warnings.length')" '0|{"value":"low","source":"state"}|2'
printf '%s' '{"ceiling":"low","ceiling_origin":"config"}' > "$P/.somi/somi-state/ceiling.json"
check "a persisted ceiling that was not set by a flag or env is ignored: default medium" "$(cfg "$CLI" "$P" show)|$(jf 'JSON.stringify(o.effective_ceiling)')" '0|{"value":"medium","source":"default"}'
printf '%s' '{"cost":{"ceiling":"high"}}' > "$P/.somi/config.json"; printf '%s' '{"ceiling":"low","ceiling_origin":"cli"}' > "$P/.somi/somi-state/ceiling.json"
check "the config outranks a persisted ceiling" "$(cfg "$CLI" "$P" show)|$(jf 'JSON.stringify(o.effective_ceiling)')" '0|{"value":"high","source":"config"}'
out="$(CLAUDE_PROJECT_DIR="$P" env -u SOMI_COST_CEILING node "$ROOT_REPO/scripts/somi-dispatch.mjs" resolve --agent somi-coder)"
check "and the resolver agrees with that" "$(fld "$out" ceiling)/$(fld "$out" ceiling_source)" "high/config"
P="$(proj)"; mkdir -p "$P/.somi/somi-state"; printf '%s' '{}' > "$P/.somi/config.json"; printf '{ bad' > "$P/.somi/somi-state/ceiling.json"
check "a corrupt state file is exit 67 for show" "$(cfg "$CLI" "$P" show)" "67"

# --- small behaviours ------------------------------------------------------------------------------------------
P="$(proj)"
check "a new file honours the umask (umask 077 -> mode 600)" "$( (umask 077; node "$CLI" init --project-dir "$P" > /dev/null 2>&1); stat -c %a "$P/.somi/config.json")" "600"
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
check "the agent name somi is accepted without the not-a-shipped-agent warning" "$(cfg "$CLI" "$P" set cost.agents.somi low)|$(jf 'o.warnings.filter((w) => /not a shipped/.test(w)).length')" "0|0"
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
check "no temp file is left behind after many writes" "$(for t in low medium high low; do cfg "$CLI" "$P" set cost.ceiling $t > /dev/null; done; ls -A "$P/.somi" | tr '\n' ' ')" "config.json "

# --- red proofs on mutated copies --------------------------------------------------------------------
mut() { # $1 = name, $2 = file (relative to scripts/), $3 = exact text, $4 = replacement
  local d="$TMP/$1"; mkdir -p "$d/scripts"; [ -d "$d/scripts/lib" ] || cp -r "$ROOT_REPO/scripts/lib" "$d/scripts/lib"; cp "$CLI" "$d/scripts/"
  M_FILE="$d/scripts/$2" M_FROM="$3" M_TO="$4" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))" || bad "mutant $1 did not apply"
}
mut_more() { M_FILE="$TMP/$1/scripts/$2" M_FROM="$3" M_TO="$4" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))" || bad "mutant $1 (second edit) did not apply"; }
mut allowlist lib/cost-config-edit.mjs "if (!m) throw new EditError(" "if (false) throw new EditError("
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
rc="$(cfg "$TMP/allowlist/scripts/somi-config.mjs" "$P" set cost.bogus.x low)"
if [ "$rc" != 64 ]; then ok "red proof: without the key allowlist a bad key is no longer a clean 64 (rc $rc)"; else bad "red proof: allowlist mutant still gives 64"; fi
mut wholeblock somi-config.mjs "checkCost(next.cost, (m) => usage(m));" ""
P="$(proj)"; cfg "$CLI" "$P" init > /dev/null
rc="$(cfg "$TMP/wholeblock/scripts/somi-config.mjs" "$P" set cost.agents.constructor low)"
if [ "$rc" = 0 ] && grep -q constructor "$P/.somi/config.json"; then ok "red proof: without whole-block validation a forbidden agent name is written"; else bad "red proof: whole-block mutant did not write (rc $rc)"; fi
mut nofollow-dir somi-config.mjs "if (d && !d.isDirectory()) project(" "if (false) project("
mut_more nofollow-dir somi-config.mjs "if (!loc.dirStat?.isDirectory()) project(" "if (false) project("
mut_more nofollow-dir somi-config.mjs "if (!now || !now.isDirectory() || now.dev !== loc.dirStat.dev || now.ino !== loc.dirStat.ino) project(" "if (false) project("
P="$(proj)"; OUTSIDE="$(mktemp -d -p "$TMP")"; ln -s "$OUTSIDE" "$P/.somi"
cfg "$TMP/nofollow-dir/scripts/somi-config.mjs" "$P" init > /dev/null
if [ -e "$OUTSIDE/config.json" ]; then ok "red proof: without the .somi link check init writes through the link"; else bad "red proof: no-follow (.somi) mutant wrote nothing"; fi
mut nofollow-cfg lib/cost-ceiling.mjs "| (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)" "| (fs.constants.O_NONBLOCK ?? 0)"
P="$(proj)"; mkdir "$P/.somi"; printf '{"cost":{"ceiling":"high"}}' > "$TMP/real2.json"; ln -s "$TMP/real2.json" "$P/.somi/config.json"
rc="$(cfg "$TMP/nofollow-cfg/scripts/somi-config.mjs" "$P" set cost.ceiling low)"
if [ "$rc" = 0 ]; then ok "red proof: without O_NOFOLLOW a symlinked config.json is read through (set succeeds instead of exit 67)"; else bad "red proof: no-follow (config.json) mutant still refused"; fi
mut sizecap somi-config.mjs "if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) project(" "if (false) project("
P="$(proj)"; mkdir "$P/.somi"; exact 65536 > "$P/.somi/config.json"
rc="$(cfg "$TMP/sizecap/scripts/somi-config.mjs" "$P" set cost.ceiling high)"
if [ "$rc" = 0 ] && [ "$(stat -c %s "$P/.somi/config.json")" -gt 65536 ]; then ok "red proof: without the size check a file its own reader rejects is written"; else bad "red proof: size-cap mutant (rc $rc)"; fi
mut hazard somi-config.mjs "if (why) project(" "if (false) project("
P="$(proj)"; mkdir "$P/.somi"; printf '%s' '{"big":12345678901234567890,"cost":{"ceiling":"low"}}' > "$P/.somi/config.json"
rc="$(cfg "$TMP/hazard/scripts/somi-config.mjs" "$P" set cost.ceiling high)"
if [ "$rc" = 0 ] && ! grep -q 12345678901234567890 "$P/.somi/config.json"; then ok "red proof: without the hazard check a big integer is silently rewritten"; else bad "red proof: hazard mutant (rc $rc)"; fi
mut absent lib/cost-config-edit.mjs "const next = absent ? buildDefaultConfig() : cfg;" "const next = cfg ?? {};"
P="$(proj)"; rc="$(cfg "$TMP/absent/scripts/somi-config.mjs" "$P" set cost.ceiling high)"
if [ "$rc" = 0 ] && [ "$(node -e "console.log(JSON.parse(require('fs').readFileSync('$P/.somi/config.json','utf8')).cost.agents === undefined)")" = true ]; then ok "red proof: without starting from the defaults a set on an absent file loses the pins"; else bad "red proof: absent mutant (rc $rc)"; fi
mut envrank somi-config.mjs "if (env !== undefined && env !== '') {" "if (false) {"
P="$(proj)"; mkdir "$P/.somi"; printf '%s' '{"cost":{"ceiling":"high"}}' > "$P/.somi/config.json"
ENVV=low; env SOMI_COST_CEILING=low node "$TMP/envrank/scripts/somi-config.mjs" show --project-dir "$P" > "$TMP/out" 2>/dev/null
if [ "$(jf 'o.effective_ceiling.source')" = config ]; then ok "red proof: without reading SOMI_COST_CEILING the effective ceiling ignores it"; else bad "red proof: env mutant"; fi
if [ "$(id -u)" -ne 0 ]; then
  mut atomic somi-config.mjs "fd = fs.openSync(tmp, WRITE_FLAGS, 0o644);" "fs.writeFileSync(loc.file, text); return true;"
  P="$(proj)"; mkdir "$P/.somi"; printf '{"cost":{"ceiling":"high"}}' > "$P/.somi/config.json"; chmod 555 "$P/.somi"
  rc="$(cfg "$TMP/atomic/scripts/somi-config.mjs" "$P" set cost.ceiling low)"
  if [ "$rc" = 0 ]; then ok "red proof: a direct (non-temp-file) write succeeds where the atomic one refuses"; else bad "red proof: atomic mutant still failed (rc $rc)"; fi
  chmod 755 "$P/.somi"
fi

echo "somi-config tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
node "$ROOT_REPO/tests/scripts/lib/somi-mcp-config-tests.mjs" || exit 1
