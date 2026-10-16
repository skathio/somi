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
  cp "$LIB_SRC/cost-ceiling.mjs" "$LIB_SRC/cost-model.mjs" "$LIB_SRC/cost-config.mjs" "$TMP/$1/"
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
reject_case "a bad tier"                '{"cost":{"agents":{"coder":"turbo"}}}'     tier        'cost.agents.coder expected one of'
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

case "$(verdict "$LIB_SRC" '{"cost":{"ceiling":"medium","mapping":{},"agents":{"coder":"medium","security-reviewer":"high"}}}')" in
  ok) ok "accepts ceiling, mapping and an agents map together" ;; *) bad "accepts ceiling, mapping and an agents map together" ;; esac
case "$(verdict "$LIB_SRC" '{"cost":{"agents":{}}}')" in ok) ok "accepts an empty agents map" ;; *) bad "accepts an empty agents map" ;; esac

echo "cost hardcap tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ] || exit 1
