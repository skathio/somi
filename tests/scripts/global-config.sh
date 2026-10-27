#!/usr/bin/env bash
# Guard for the global config and the merge (scripts/lib/config-files.mjs) and for reads through links:
# the loader on its own, then every consumer that must see the merged config -- the resolver, the
# somi-config CLI, the SessionStart default-config hook, the cost-lowering hook and the hooks' config().
# Every case sets SOMI_GLOBAL_CONFIG itself, so a real global config on the machine never leaks in.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/config-files.mjs"
CLI="$ROOT/scripts/somi-config.mjs"
DISPATCH="$ROOT/scripts/somi-dispatch.mjs"
ENSURE="$ROOT/hooks/session-start/ensure-default-config.mjs"
GUARD="$ROOT/hooks/pre-tool/guard-cost-lowering.mjs"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
proj() { mktemp -d -p "$TMP"; }
node_lib() { SOMI_GLOBAL_CONFIG="${G:-}" node --input-type=module -e "import * as L from '$LIB'; $1"; }

echo "== global config: the loader =="

check "SOMI_GLOBAL_CONFIG names the file" "$(SOMI_GLOBAL_CONFIG=/x/y.json node --input-type=module -e "import {globalConfigPath} from '$LIB'; process.stdout.write(String(globalConfigPath()))")" "/x/y.json"
check "an empty SOMI_GLOBAL_CONFIG means no global config" "$(SOMI_GLOBAL_CONFIG= node --input-type=module -e "import {globalConfigPath} from '$LIB'; process.stdout.write(String(globalConfigPath()))")" "null"
check "platform defaults: XDG, ~/.config, %APPDATA%" "$(node --input-type=module -e "
  import {globalConfigPath as g} from '$LIB';
  process.stdout.write([g({XDG_CONFIG_HOME:'/xdg'},'linux','/h'), g({XDG_CONFIG_HOME:'rel'},'linux','/h'), g({},'darwin','/h'), g({APPDATA:'C:/A'},'win32','C:/h')].join('|'))")" \
  "/xdg/somi/config.json|/h/.config/somi/config.json|/h/.config/somi/config.json|C:/A/somi/config.json"

check "merge: the user's example (project changes only somi-coder and the medium mapping)" "$(node_lib "
  const g = {cost:{ceiling:'medium',agents:{'somi-coder':'medium','somi-reviewer':'high'},mapping:{'copilot-cli':{low:['a'],medium:['b','c'],high:['d']}}},dep_install:{allow:['x']}};
  const p = {cost:{agents:{'somi-coder':'high'},mapping:{'copilot-cli':{medium:['z']}}}};
  const m = L.mergeConfig(g, p);
  process.stdout.write(JSON.stringify(m) + '|' + g.cost.agents['somi-coder'] + '|' + JSON.stringify(p))")" \
  '{"cost":{"ceiling":"medium","agents":{"somi-coder":"high","somi-reviewer":"high"},"mapping":{"copilot-cli":{"low":["a"],"medium":["z"],"high":["d"]}}},"dep_install":{"allow":["x"]}}|medium|{"cost":{"agents":{"somi-coder":"high"},"mapping":{"copilot-cli":{"medium":["z"]}}}}'
check "merge: arrays, scalars and null replace; objects merge" "$(node_lib "
  process.stdout.write(JSON.stringify(L.mergeConfig({a:[1,2],b:{c:1,d:2},e:'x',f:{g:1}}, {a:[3],b:{d:3},e:null,f:5})))")" \
  '{"a":[3],"b":{"c":1,"d":3},"e":null,"f":5}'
check "merge: a __proto__ key stays data and pollutes nothing" "$(node_lib "
  const m = L.mergeConfig({}, JSON.parse('{\"__proto__\":{\"polluted\":1},\"cost\":{\"__proto__\":{\"x\":1}}}'));
  process.stdout.write([String(({}).polluted), Object.getPrototypeOf(m) === Object.prototype, Object.hasOwn(m, '__proto__'), Object.getPrototypeOf(m.cost) === Object.prototype].join(','))")" \
  "undefined,true,true,true"

P="$(proj)"; mkdir "$P/.somi"
check "absent files read as unconfigured" "$(G="$TMP/none.json" node_lib "const r = L.loadConfig('$P'); process.stdout.write(JSON.stringify([r.config, r.global.present, r.project.present]))")" '[{},false,false]'
printf '{"cost":{"ceiling":"high"}}' > "$TMP/g1.json"; printf '{"cost":{"agents":{"somi-coder":"low"}}}' > "$P/.somi/config.json"
check "global and project merge, each file reported" "$(G="$TMP/g1.json" node_lib "const r = L.loadConfig('$P'); process.stdout.write(JSON.stringify([r.config, r.global.present, r.project.present]))")" \
  '[{"cost":{"ceiling":"high","agents":{"somi-coder":"low"}}},true,true]'
P="$(proj)"; SHARED="$(mktemp -d -p "$TMP")"; printf '{"cost":{"ceiling":"low"}}' > "$SHARED/config.json"; ln -s "$SHARED" "$P/.somi"
check "a symlinked .somi (a junction on Windows) is read through" "$(G= node_lib "process.stdout.write(L.loadConfig('$P').config.cost.ceiling)")" "low"
ln -s "$SHARED/config.json" "$TMP/linked.json"
check "a symlinked global config is read through" "$(G="$TMP/linked.json" node_lib "process.stdout.write(L.loadConfig('$(proj)').config.cost.ceiling)")" "low"
ln -s "$TMP/gone.json" "$TMP/dangling.json"
check "a dangling link is an error, not 'no config'" "$(G="$TMP/dangling.json" node_lib "try { L.loadConfig('$(proj)'); console.log('read'); } catch (e) { console.log(e instanceof L.ConfigFileError && /link to a missing file/.test(e.message) ? 'refused' : e.message); }")" "refused"
mkdir "$TMP/dir.json"
check "a directory is not a config" "$(G="$TMP/dir.json" node_lib "try { L.loadConfig('$(proj)'); console.log('read'); } catch (e) { console.log(/not a regular file/.test(e.message) ? 'refused' : e.message); }")" "refused"
mkfifo "$TMP/fifo.json"; rc=0
out="$(G="$TMP/fifo.json" timeout 5 node --input-type=module -e "import * as L from '$LIB'; process.env.SOMI_GLOBAL_CONFIG='$TMP/fifo.json'; try { L.loadConfig('$(proj)'); console.log('read'); } catch (e) { console.log(/not a regular file/.test(e.message) ? 'refused' : e.message); }")" || rc=$?
check "a FIFO is refused without blocking" "$rc|$out" "0|refused"
{ printf '{"pad":"'; head -c 70000 /dev/zero | tr '\0' x; printf '"}'; } > "$TMP/big.json"
check "an oversize global config is refused" "$(G="$TMP/big.json" node_lib "try { L.loadConfig('$(proj)'); console.log('read'); } catch (e) { console.log(/byte limit/.test(e.message) ? 'refused' : e.message); }")" "refused"
printf '\x1b[31mSECRET {nope' > "$TMP/bad.json"
msg="$(G="$TMP/bad.json" node_lib "try { L.loadConfig('$(proj)'); } catch (e) { console.log(e.message); }")"
case "$msg" in *SECRET*|*$'\x1b'*) bad "a parse error leaks file text: $msg" ;; *"not valid JSON"*) ok "a parse error names the file and leaks no text" ;; *) bad "unexpected parse error: $msg" ;; esac

node -e "const n=20000; require('fs').writeFileSync('$TMP/deep.json', '{\"deep\":'+'['.repeat(n)+']'.repeat(n)+'}')"
out="$(SOMI_GLOBAL_CONFIG="$TMP/deep.json" node --stack-size=200 --input-type=module -e "import * as L from '$LIB'; try { L.loadConfig('$(proj)'); console.log('read'); } catch (e) { console.log(e instanceof L.ConfigFileError && /nested deeper/.test(e.message) ? 'refused' : 'crash'); }" 2>&1)"
check "a config nested 20000 deep is refused cleanly, even on a small stack (CI's Node)" "$out" "refused"

echo "== global config: the resolver =="
resolve() { # $1 = global file, $2 = project, $3.. = resolve args -> stdout JSON
  local g="$1" p="$2"; shift 2
  (cd "$p" && SOMI_GLOBAL_CONFIG="$g" CLAUDE_PROJECT_DIR="$p" env -u SOMI_COST_CEILING node "$DISPATCH" resolve "$@" 2>&1)
}
jget() { node -e "const o = JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String($1))"; }
GF="$TMP/global.json"
printf '%s' '{"cost":{"ceiling":"medium","agents":{"somi-coder":"medium","somi-planner":"high"},"mapping":{"copilot-cli":{"low":["g-low"],"medium":["g-med"],"high":["g-high"]}}}}' > "$GF"
P="$(proj)"; mkdir "$P/.somi"; printf '%s' '{"cost":{"agents":{"somi-coder":"high"},"mapping":{"copilot-cli":{"medium":["p-med"]}}}}' > "$P/.somi/config.json"
check "the project overrides somi-coder" "$(resolve "$GF" "$P" --agent somi-coder --host copilot-cli | jget 'o.tier + "," + o.tier_source + "," + o.model')" "high,override,g-high"
check "an agent the project does not name keeps the global pin" "$(resolve "$GF" "$P" --agent somi-planner --host copilot-cli | jget 'o.tier + "," + o.model')" "high,g-high"
check "the project's medium mapping replaces the global one; other tiers stay" "$(resolve "$GF" "$P" --agent somi-impact --host copilot-cli | jget 'o.tier + "," + o.model')" "medium,p-med"
check "the ceiling comes from the global file" "$(resolve "$GF" "$P" --agent somi-impact --host copilot-cli | jget 'o.ceiling + "," + o.ceiling_source')" "medium,config"
printf '%s' '{"cost":{"celing":"low"}}' > "$TMP/typo.json"; rc=0
resolve "$TMP/typo.json" "$(proj)" --agent somi-coder > "$TMP/typo.out" || rc=$?
check "a typo in the global file exits 67 and names that file" "$rc|$(grep -c 'typo.json' "$TMP/typo.out")" "67|1"

echo "== global config: somi-config =="
cfg() { # $1 = global file, $2 = project, $3.. = args -> exit code; stdout in $TMP/out
  local g="$1" p="$2"; shift 2
  SOMI_GLOBAL_CONFIG="$g" env -u SOMI_COST_CEILING node "$CLI" "$@" --project-dir "$p" > "$TMP/out" 2> "$TMP/err"; echo $?
}
jf() { node -e "const o = JSON.parse(require('fs').readFileSync('$TMP/out','utf8')); process.stdout.write(typeof ($1) === 'string' ? ($1) : JSON.stringify($1))"; }
check "show merges both files and says where each value came from" \
  "$(cfg "$GF" "$P" show)|$(jf 'o.global.exists')|$(jf 'o.ceiling.from')|$(jf 'o.agents.find((a) => a.name === "somi-coder").from')|$(jf 'o.agents.find((a) => a.name === "somi-planner").from')" \
  "0|true|global|project|global"
check "get reads the merged value" "$(cfg "$GF" "$P" get cost.mapping.copilot-cli.medium)|$(jf 'o.value')" '0|["p-med"]'

H="$TMP/home"; NG="$H/.config/somi/config.json"
check "init --global creates the default global file, parents included" "$(cfg "$NG" "$(proj)" init --global)|$(jf 'o.created')|$([ -f "$NG" ] && echo file)" "0|true|file"
P="$(proj)"
check "init in a project is a no-op while a global config exists" "$(cfg "$NG" "$P" init)|$(jf 'o.created')|$([ -e "$P/.somi/config.json" ] && echo made || echo none)" "0|false|none"
check "set --global changes the global file" "$(cfg "$NG" "$P" set cost.agents.somi-coder high --global)|$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$NG','utf8')).cost.agents['somi-coder'])")" "0|high"
check "a first project set over a global config writes only that key" "$(cfg "$NG" "$P" set cost.agents.somi-pr high)|$(cat "$P/.somi/config.json" | tr -d ' \n')" '0|{"cost":{"agents":{"somi-pr":"high"}}}'
check "unset of a value only the global file sets changes nothing and says where it lives" "$(cfg "$NG" "$P" unset cost.agents.somi-coder)|$(jf 'o.changed')|$(jf 'String(o.warnings[0].startsWith("that value is set in your global config"))')" "0|false|true"
check "--global is refused on show" "$(cfg "$NG" "$P" show --global)" "64"
check "--refuse-lowering judges a project change merged over the global file" "$(cfg "$NG" "$P" set cost.agents.somi-coder low --refuse-lowering)|$(cat "$P/.somi/config.json" | tr -d ' \n')" '64|{"cost":{"agents":{"somi-pr":"high"}}}'
DOT="$TMP/dotfiles"; mkdir -p "$DOT" "$H/.config/linked"; printf '{"cost":{"ceiling":"medium"}}' > "$DOT/somi.json"; ln -s "$DOT/somi.json" "$H/.config/linked/config.json"
check "set --global through a dotfiles link writes the real file and keeps the link" \
  "$(cfg "$H/.config/linked/config.json" "$P" set cost.ceiling high --global)|$([ -L "$H/.config/linked/config.json" ] && echo link)|$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$DOT/somi.json','utf8')).cost.ceiling)")" \
  "0|link|high"
check "with SOMI_GLOBAL_CONFIG empty, --global is a usage error" "$(cfg "" "$P" set cost.ceiling high --global)" "64"

echo "== global config: hooks =="
runhook() { # $1 = hook, $2 = global file, $3 = project; payload on stdin -> stdout
  (cd "$3" && SOMI_GLOBAL_CONFIG="$2" CLAUDE_PROJECT_DIR="$3" node "$1")
}
P="$(proj)"
out="$(printf '{}' | runhook "$ENSURE" "$NG" "$P")"
check "SessionStart writes no project default while a global config exists" "$([ -e "$P/.somi/config.json" ] && echo made || echo none)" "none"
printf '{"cost":{"ceiling":"medium","agents":{}}}' > "$TMP/nopin.json"
out="$(printf '{}' | runhook "$ENSURE" "$TMP/nopin.json" "$(proj)")"
case "$out" in *"your global config"*"no cost.agents pin for somi-security-reviewer"*) ok "the pin notice reads the merged config and names the global file" ;; *) bad "the pin notice reads the merged config and names the global file ($out)" ;; esac
P="$(proj)"; mkdir "$P/.somi"; printf '{"cost":{"agents":{"somi-security-reviewer":"high"}}}' > "$P/.somi/config.json"
check "... and a project pin satisfies it" "$(printf '{}' | runhook "$ENSURE" "$TMP/nopin.json" "$P")" ""

verdict() { # $1 = global file, $2 = project, $3 = payload -> ask | allow
  local out; out="$(printf '%s' "$3" | runhook "$GUARD" "$1" "$2")"
  case "$out" in *'"permissionDecision":"ask"'*) echo ask ;; *) echo allow ;; esac
}
wr() { node -e "process.stdout.write(JSON.stringify({tool_name:'Write',tool_input:{file_path:process.argv[1],content:process.argv[2]}}))" "$1" "$2"; }
GP="$TMP/gp.json"; printf '{"cost":{"ceiling":"medium","agents":{"somi-security-reviewer":"high","somi-coder":"high"}}}' > "$GP"
P="$(proj)"; mkdir "$P/.somi"; printf '{}' > "$P/.somi/config.json"
check "a tool write to the global config always asks" "$(verdict "$GP" "$P" "$(wr "$GP" '{"cost":{"ceiling":"high"}}')")" "ask"
check "... also when the global file does not exist yet" "$(verdict "$TMP/new/somi/config.json" "$P" "$(wr "$TMP/new/somi/config.json" '{}')")" "ask"
check "a project write that drops below a global pin asks" "$(verdict "$GP" "$P" "$(wr "$P/.somi/config.json" '{"cost":{"agents":{"somi-coder":"low"}}}')")" "ask"
check "a project write that raises over the global file passes" "$(verdict "$GP" "$P" "$(wr "$P/.somi/config.json" '{"cost":{"ceiling":"high"}}')")" "allow"
check "an unrelated write passes" "$(verdict "$GP" "$P" "$(wr "$P/notes.txt" 'hi')")" "allow"

printf '{"dep_install":{"allow":["left-pad"]},"lockfiles":{"allow_edit":true}}' > "$TMP/policy.json"
P="$(proj)"; mkdir "$P/.somi"; printf '{"dep_install":{"allow":["is-odd"]}}' > "$P/.somi/config.json"
check "the hooks' config() sees the merge (project array replaces, global key stays)" "$(cd "$P" && SOMI_GLOBAL_CONFIG="$TMP/policy.json" CLAUDE_PROJECT_DIR="$P" node --input-type=module -e "
  import { config } from '$ROOT/hooks/lib/common.mjs';
  process.stdout.write(JSON.stringify([config('.dep_install.allow[]?'), config('.lockfiles.allow_edit')]))")" '[["is-odd"],"true"]'

echo "== global config: red proofs =="
# Each mutant removes one rule from a copy of the plugin's scripts/ and hooks/; the case it guards must flip.
mutant() { # $1 = name, $2 = file below the copy, $3 = sed expression
  local d="$TMP/mut-$1"; mkdir -p "$d"; cp -r "$ROOT/scripts" "$ROOT/hooks" "$d/"
  sed -i "$3" "$d/$2"
  cmp -s "$ROOT/$2" "$d/$2" && bad "mutant $1 did not change $2"
}
mutant shallow scripts/lib/config-files.mjs 's/isObj(v) \&\& isObj(prev) ? mergeConfig(prev, v) : copy(v)/copy(v)/'
check "red proof: a shallow merge loses the global pins the project does not name" "$(node --input-type=module -e "
  import * as L from '$TMP/mut-shallow/scripts/lib/config-files.mjs';
  process.stdout.write(String(L.mergeConfig({cost:{agents:{a:'high',b:'high'}}}, {cost:{agents:{a:'low'}}}).cost.agents.b))")" "undefined"
mutant no-global-ask hooks/pre-tool/guard-cost-lowering.mjs 's/askPretool(payload, GLOBAL_WRITE)/void 0/'
check "red proof: without its rule a global write is not asked about" "$(out="$(wr "$GP" '{"cost":{"ceiling":"high"}}' | (cd "$P" && SOMI_GLOBAL_CONFIG="$GP" CLAUDE_PROJECT_DIR="$P" node "$TMP/mut-no-global-ask/hooks/pre-tool/guard-cost-lowering.mjs"))"; case "$out" in *ask*) echo ask ;; *) echo allow ;; esac)" "allow"
mutant no-global-skip hooks/session-start/ensure-default-config.mjs 's/if (existing || hasGlobal) {/if (existing) {/'
P="$(proj)"; printf '{}' | runhook "$TMP/mut-no-global-skip/hooks/session-start/ensure-default-config.mjs" "$NG" "$P" > /dev/null
check "red proof: without the global check SessionStart writes a project default that masks it" "$([ -e "$P/.somi/config.json" ] && echo made || echo none)" "made"

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
