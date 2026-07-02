#!/usr/bin/env bash
# Behavioral fixture runner for the deterministic guardrail hooks.
#
# Each file in tests/hooks/cases/<name>.json declares the hook script it
# exercises plus a list of cases:
#
#   {
#     "script": "pre-tool/block-dangerous-bash.sh",
#     "cases": [
#       { "name": "rm-rf-root", "expect": "deny",
#         "payload": { "tool_name": "Bash", "tool_input": { "command": "rm -rf /" } } },
#       { "name": "opted-in", "expect": "allow",
#         "env": { "SOMI_ALLOW_DEP_INSTALL": "1" },
#         "payload": { ... } },
#       { "name": "config-allowlisted", "expect": "allow",
#         "config": { "dep_install": { "allow": ["@types/"] } },
#         "payload": { ... } }
#     ]
#   }
#
# The runner pipes each payload into the script under a sanitized environment
# (session opt-ins unset unless the case sets them; audit writes go to a temp
# file; CLAUDE_PROJECT_DIR points at a throwaway per-case dir, into which the
# optional `config` object is written as .somi/config.json) and asserts the
# PreToolUse decision matches `expect`.
#
# Wired into scripts/validate.sh (npm test) — CI fails when a pattern change
# weakens a guarantee. If you change a hook pattern, add or update a fixture.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CASES_DIR="$ROOT/tests/hooks/cases"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

total=0
failures=0

for case_file in "$CASES_DIR"/*.json; do
  script_rel="$(jq -r '.script' "$case_file")"
  script="$ROOT/hooks/$script_rel"
  if [[ ! -x "$script" ]]; then
    echo "FAIL: $(basename "$case_file") — hook script missing or not executable: hooks/$script_rel" >&2
    failures=$((failures + 1))
    continue
  fi

  count="$(jq '.cases | length' "$case_file")"
  for ((i = 0; i < count; i++)); do
    total=$((total + 1))
    name="$(jq -r ".cases[$i].name" "$case_file")"
    expect="$(jq -r ".cases[$i].expect" "$case_file")"
    payload="$(jq -c ".cases[$i].payload" "$case_file")"

    # Sanitized environment: session opt-ins never leak in from the caller;
    # audit-log writes land in a throwaway file, not the repo's .claude/; the
    # project root is a per-case temp dir so .somi/config.json is case-controlled.
    case_dir="$TMP/case-$total"
    mkdir -p "$case_dir"
    config="$(jq -c ".cases[$i].config // empty" "$case_file")"
    if [[ -n "$config" ]]; then
      mkdir -p "$case_dir/.somi"
      printf '%s' "$config" > "$case_dir/.somi/config.json"
    fi
    env_args=("SOMI_AUDIT_LOG=$TMP/audit.log" "CLAUDE_PROJECT_DIR=$case_dir")
    while IFS= read -r kv; do
      [[ -z "$kv" ]] && continue
      env_args+=("$kv")
    done < <(jq -r ".cases[$i].env // {} | to_entries[] | \"\(.key)=\(.value)\"" "$case_file")

    if ! out="$(printf '%s' "$payload" \
        | env -u SOMI_ALLOW_DEP_INSTALL -u SOMI_ALLOW_LOCKFILES "${env_args[@]}" "$script")"; then
      echo "FAIL: [$script_rel] $name — hook exited non-zero" >&2
      failures=$((failures + 1))
      continue
    fi

    decision="allow"
    if [[ -n "$out" ]] \
       && jq -e '.hookSpecificOutput.permissionDecision == "deny"' <<<"$out" >/dev/null 2>&1; then
      decision="deny"
    fi

    if [[ "$decision" != "$expect" ]]; then
      echo "FAIL: [$script_rel] $name — expected $expect, got $decision" >&2
      [[ -n "$out" ]] && echo "        output: $out" >&2
      failures=$((failures + 1))
    fi
  done
done

if (( failures > 0 )); then
  echo "hook fixtures: $failures of $total cases FAILED" >&2
  exit 1
fi
echo "hook fixtures: all $total cases passed."
