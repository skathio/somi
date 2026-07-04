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
#         "expect_reason": "rm -rf /",
#         "payload": { "tool_name": "Bash", "tool_input": { "command": "rm -rf /" } } },
#       { "name": "opted-in", "expect": "allow",
#         "env": { "SOMI_ALLOW_DEP_INSTALL": "1" },
#         "payload": { ... } },
#       { "name": "config-allowlisted", "expect": "allow",
#         "config": { "dep_install": { "allow": ["@types/"] } },
#         "payload": { ... } },
#       { "name": "surfaces-context", "expect_context": "somi repo-awareness",
#         "files": { "AGENTS.md": "# repo instructions\n" },
#         "payload": { ... } }
#     ]
#   }
#
# Case fields beyond "expect" (PreToolUse allow/deny):
#   - "files": an object mapping a path (relative to the case's throwaway
#     CLAUDE_PROJECT_DIR) to file content, written before the hook runs — for
#     hooks that read repo-local files (e.g. detect-repo-instructions.sh's
#     AGENTS.md/CLAUDE.md scan). Mirrors the "config" → .somi/config.json
#     staging below, generalized to arbitrary relative paths. Keys are
#     rejected (case FAILS loudly) if they contain a ".." path segment or a
#     leading "/" — such a key would otherwise escape the case dir.
#   - A payload may reference the literal token "{{CASE_DIR}}", substituted
#     with the case's absolute throwaway-dir path before the hook runs — for
#     hooks that check real absolute paths (e.g. lint-changed-files.sh's
#     `[[ -f "$PATH_INPUT" ]]`), so a case can point at a file staged via
#     "files" without hardcoding a path the hook's own CWD wouldn't resolve.
#   - "expect_context": asserted as a substring of
#     `.hookSpecificOutput.additionalContext` — for PostToolUse/UserPromptSubmit/
#     SessionStart hooks that surface context instead of a permission decision.
#     Independent of "expect"; a case may declare either, both, or (paired with
#     "expect": "deny") "expect_reason" as well. There is deliberately no
#     Stop-event (`decision`-shape) assertion path — no Stop hooks are wired in
#     hooks.json today, so that shape would be untested speculative scope.
#   - "expect_no_context": true — asserts `.hookSpecificOutput.additionalContext`
#     is absent/empty — for PostToolUse hooks whose current behavior is a
#     documented no-op (e.g. lint-changed-files.sh with no configured linter).
#   - "expect_reason": asserted as a substring of
#     `.hookSpecificOutput.permissionDecisionReason` on deny cases — catches a
#     hook that still denies (so `expect: deny` alone would pass) but whose
#     matched/interpolated text drifted, e.g. an ERE→RegExp port that shifts
#     *which* substring a pattern captures.
#   - "expect_audit_log": asserted as a substring of the case's audit-log file
#     (see below) — for hooks whose only observable effect is the audit-log
#     side-effect (audit-log.sh emits no stdout decision at all).
#   - "expect_no_audit_log": true — asserts the case's audit-log file was never
#     created (e.g. audit-log.sh's no-tool_name early exit).
#
# A case that declares none of the six recognized assertion fields above runs
# the hook and passes vacuously (a typo'd field name would silently produce a
# meaningless green case) — the runner fails such a case loudly instead.
#
# The runner pipes each payload into the script under a sanitized environment
# (session opt-ins unset unless the case sets them; SOMI_AUDIT_LOG defaults to
# a per-case throwaway file, "$case_dir/audit.log", so audit writes never leak
# across cases; CLAUDE_PROJECT_DIR points at the same throwaway per-case dir,
# into which the optional `config` object is written as .somi/config.json)
# and asserts every expectation the case declares.
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

# Reject "files" staging keys that could escape the per-case throwaway dir: a
# ".." path segment (anywhere in the path, not just a bare prefix) or a
# leading "/". Fixture keys are maintainer-committed, not attacker-controlled,
# but a typo should fail the case loudly rather than silently write outside
# case_dir.
is_unsafe_staging_key() {
  local key="$1"
  [[ "$key" == /* ]] && return 0
  local part
  local IFS='/'
  for part in $key; do
    [[ "$part" == ".." ]] && return 0
  done
  return 1
}

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
    expect="$(jq -r ".cases[$i].expect // empty" "$case_file")"
    expect_context="$(jq -r ".cases[$i].expect_context // empty" "$case_file")"
    expect_reason="$(jq -r ".cases[$i].expect_reason // empty" "$case_file")"
    expect_no_context="$(jq -r ".cases[$i].expect_no_context // false" "$case_file")"
    expect_audit_log="$(jq -r ".cases[$i].expect_audit_log // empty" "$case_file")"
    expect_no_audit_log="$(jq -r ".cases[$i].expect_no_audit_log // false" "$case_file")"
    has_assertion="$(jq -r ".cases[$i] | (has(\"expect\") or has(\"expect_context\") or has(\"expect_reason\") or has(\"expect_no_context\") or has(\"expect_audit_log\") or has(\"expect_no_audit_log\"))" "$case_file")"
    payload="$(jq -c ".cases[$i].payload" "$case_file")"

    # Sanitized environment: session opt-ins never leak in from the caller;
    # audit-log writes land in a per-case throwaway file, not the repo's
    # .claude/; the project root is a per-case temp dir so .somi/config.json
    # is case-controlled.
    case_dir="$TMP/case-$total"
    mkdir -p "$case_dir"
    # {{CASE_DIR}} in the payload resolves to this case's absolute throwaway
    # dir, for hooks that check real absolute paths (see header comment).
    payload="${payload//\{\{CASE_DIR\}\}/$case_dir}"
    config="$(jq -c ".cases[$i].config // empty" "$case_file")"
    if [[ -n "$config" ]]; then
      mkdir -p "$case_dir/.somi"
      printf '%s' "$config" > "$case_dir/.somi/config.json"
    fi
    # Arbitrary file staging: a case may declare "files": { "rel/path": "content" }
    # to be written into the case dir before the hook runs (e.g. AGENTS.md for
    # detect-repo-instructions.sh). Generalizes the config staging above.
    # Keys are validated (no ".." segment, no leading "/") before any write.
    bad_key=""
    while IFS= read -r rel_path; do
      [[ -z "$rel_path" ]] && continue
      if is_unsafe_staging_key "$rel_path"; then
        bad_key="$rel_path"
        break
      fi
      mkdir -p "$case_dir/$(dirname "$rel_path")"
      jq -r --argjson idx "$i" --arg key "$rel_path" '.cases[$idx].files[$key]' "$case_file" \
        > "$case_dir/$rel_path"
    done < <(jq -r ".cases[$i].files // {} | keys[]" "$case_file")
    if [[ -n "$bad_key" ]]; then
      echo "FAIL: [$script_rel] $name — unsafe \"files\" key escapes the case dir: $bad_key" >&2
      failures=$((failures + 1))
      continue
    fi
    env_args=("SOMI_AUDIT_LOG=$case_dir/audit.log" "CLAUDE_PROJECT_DIR=$case_dir")
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

    if [[ -n "$expect" ]] && [[ "$decision" != "$expect" ]]; then
      echo "FAIL: [$script_rel] $name — expected $expect, got $decision" >&2
      [[ -n "$out" ]] && echo "        output: $out" >&2
      failures=$((failures + 1))
    fi

    if [[ -n "$expect_reason" ]]; then
      reason=""
      [[ -n "$out" ]] && reason="$(jq -r '.hookSpecificOutput.permissionDecisionReason // empty' <<<"$out")"
      if [[ "$reason" != *"$expect_reason"* ]]; then
        echo "FAIL: [$script_rel] $name — permissionDecisionReason did not contain expected substring" >&2
        echo "        expected substring: $expect_reason" >&2
        echo "        actual reason: $reason" >&2
        failures=$((failures + 1))
      fi
    fi

    if [[ -n "$expect_context" ]]; then
      context=""
      [[ -n "$out" ]] && context="$(jq -r '.hookSpecificOutput.additionalContext // empty' <<<"$out")"
      if [[ "$context" != *"$expect_context"* ]]; then
        echo "FAIL: [$script_rel] $name — additionalContext did not contain expected substring" >&2
        echo "        expected substring: $expect_context" >&2
        echo "        actual context: $context" >&2
        failures=$((failures + 1))
      fi
    fi

    if [[ "$expect_no_context" == "true" ]]; then
      context=""
      [[ -n "$out" ]] && context="$(jq -r '.hookSpecificOutput.additionalContext // empty' <<<"$out")"
      if [[ -n "$context" ]]; then
        echo "FAIL: [$script_rel] $name — expected no additionalContext, got one" >&2
        echo "        actual context: $context" >&2
        failures=$((failures + 1))
      fi
    fi

    if [[ -n "$expect_audit_log" ]]; then
      audit_log_content=""
      [[ -f "$case_dir/audit.log" ]] && audit_log_content="$(cat "$case_dir/audit.log")"
      if [[ "$audit_log_content" != *"$expect_audit_log"* ]]; then
        echo "FAIL: [$script_rel] $name — audit log did not contain expected substring" >&2
        echo "        expected substring: $expect_audit_log" >&2
        echo "        actual audit log: $audit_log_content" >&2
        failures=$((failures + 1))
      fi
    fi

    if [[ "$expect_no_audit_log" == "true" ]] && [[ -f "$case_dir/audit.log" ]]; then
      echo "FAIL: [$script_rel] $name — expected no audit-log write, but one occurred" >&2
      echo "        actual audit log: $(cat "$case_dir/audit.log")" >&2
      failures=$((failures + 1))
    fi

    if [[ "$has_assertion" != "true" ]]; then
      echo "FAIL: [$script_rel] $name — case declares no recognized assertion field (expect/expect_context/expect_reason/expect_no_context/expect_audit_log/expect_no_audit_log); it would pass vacuously" >&2
      failures=$((failures + 1))
    fi
  done
done

if (( failures > 0 )); then
  echo "hook fixtures: $failures of $total cases FAILED" >&2
  exit 1
fi
echo "hook fixtures: all $total cases passed."
