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
#   - "setup_git": true — initializes a real git repo in the case dir (`git
#     init -b main`, a throwaway commit identity, `git add -A` + an
#     `--allow-empty` commit of whatever "files" staged) before the hook
#     runs — for hooks that shell out to `git diff`/`git status` (e.g.
#     inject-workflow-context.sh's loose-end nudges). The commit gives those
#     hooks a real HEAD to diff against even when "files" staged nothing.
#   - "dirty_files": like "files", but written *after* the "setup_git"
#     baseline commit — so a new path lands untracked (visible in `git status
#     --porcelain` as `??`) and an overwritten already-committed path lands
#     modified-unstaged (visible in `git diff HEAD`). Same unsafe-key guard as
#     "files". Meaningless without "setup_git" (no git repo to be dirty in).
#   - "prime": true — runs the hook once beforehand (same sanitized env and
#     payload as the real run below), discarding its output but still failing
#     the case loudly if that priming invocation errors, so a hook whose
#     behavior depends on its own prior invocation (e.g.
#     inject-workflow-context.sh's signature-gated re-emission, which reads a
#     state file the hook itself wrote last time) can be tested against its
#     *second* call rather than its first. Note: this reuses the case's audit
#     log path, so pairing "prime" with an audit-log assertion on a hook that
#     writes audit lines would double-count; harmless for hooks (like
#     inject-workflow-context.sh) that never call somi::audit.
#   - "files_after_prime": like "files", but written after the priming
#     invocation and before the real one — for perturbing whatever state the
#     prior invocation just persisted (e.g. adding a new
#     .somi/reviews/*/*.md so a signature computed from directory-listing
#     mtimes changes deterministically, with no sleep/timing dependency,
#     rather than relying on touching an existing file's mtime). Only
#     meaningful alongside "prime".
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
#   - "expect_context_excludes": asserted as a substring that must NOT appear
#     in `.hookSpecificOutput.additionalContext` — the negative complement to
#     "expect_context", for a hook that emits *some* context (so
#     "expect_no_context" doesn't apply — a plain substring match on the part
#     that IS present can't rule out something else silently being appended
#     alongside it) but where one specific piece of content must be absent
#     (e.g. inject-workflow-context.sh still prints its standing reminder
#     block on an unrelated branch, but a particular work-item hint inside
#     that block must not appear for this case's staged input).
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
# A case that declares none of the seven recognized assertion fields above
# runs the hook and passes vacuously (a typo'd field name would silently
# produce a meaningless green case) — the runner fails such a case loudly
# instead.
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

# Writes cases[$idx].$field (an object mapping relative path -> content) into
# $dir, one file per key, validating every key via is_unsafe_staging_key first
# (shared by "files", "dirty_files", and "files_after_prime" — same shape,
# different write timing). Prints a FAIL line and returns 1 on an unsafe key
# (caller must count a failure and skip the case); returns 0 otherwise,
# including when the field is absent/empty.
stage_case_files() {
  local case_file="$1" idx="$2" dir="$3" field="$4" script_rel="$5" name="$6"
  local rel_path
  while IFS= read -r rel_path; do
    [[ -z "$rel_path" ]] && continue
    if is_unsafe_staging_key "$rel_path"; then
      echo "FAIL: [$script_rel] $name — unsafe \"$field\" key escapes the case dir: $rel_path" >&2
      return 1
    fi
    mkdir -p "$dir/$(dirname "$rel_path")"
    jq -r --argjson idx "$idx" --arg key "$rel_path" ".cases[\$idx].$field[\$key]" "$case_file" \
      > "$dir/$rel_path"
  done < <(jq -r ".cases[$idx].$field // {} | keys[]" "$case_file")
  return 0
}

for case_file in "$CASES_DIR"/*.json; do
  script_rel="$(jq -r '.script' "$case_file")"
  script="$ROOT/hooks/$script_rel"
  # Dispatch by extension (node-runtime-port phase 2, iteration 2.1): a
  # ".mjs" hook is invoked via `node "$script"`; a ".sh" hook stays a direct
  # exec, as before. This lets a single hook flip to its .mjs port (by
  # changing the fixture's "script" field) without disturbing any other
  # fixture still pointed at ".sh" — no hook is deleted until Phase 3.
  #
  # The executable-bit precondition is relaxed to the ".sh" branch only: a
  # ".mjs" file invoked via `node "$script"` doesn't need an exec bit, and
  # the exec bit doesn't exist on Windows — the exact host this work item
  # targets. The ".mjs" branch checks readability instead.
  case "$script_rel" in
    *.mjs)
      if [[ ! -r "$script" ]]; then
        echo "FAIL: $(basename "$case_file") — hook script missing or not readable: hooks/$script_rel" >&2
        failures=$((failures + 1))
        continue
      fi
      cmd=(node "$script")
      ;;
    *)
      if [[ ! -x "$script" ]]; then
        echo "FAIL: $(basename "$case_file") — hook script missing or not executable: hooks/$script_rel" >&2
        failures=$((failures + 1))
        continue
      fi
      cmd=("$script")
      ;;
  esac

  count="$(jq '.cases | length' "$case_file")"
  for ((i = 0; i < count; i++)); do
    total=$((total + 1))
    name="$(jq -r ".cases[$i].name" "$case_file")"
    expect="$(jq -r ".cases[$i].expect // empty" "$case_file")"
    expect_context="$(jq -r ".cases[$i].expect_context // empty" "$case_file")"
    expect_reason="$(jq -r ".cases[$i].expect_reason // empty" "$case_file")"
    expect_no_context="$(jq -r ".cases[$i].expect_no_context // false" "$case_file")"
    expect_context_excludes="$(jq -r ".cases[$i].expect_context_excludes // empty" "$case_file")"
    expect_audit_log="$(jq -r ".cases[$i].expect_audit_log // empty" "$case_file")"
    expect_no_audit_log="$(jq -r ".cases[$i].expect_no_audit_log // false" "$case_file")"
    has_assertion="$(jq -r ".cases[$i] | (has(\"expect\") or has(\"expect_context\") or has(\"expect_reason\") or has(\"expect_no_context\") or has(\"expect_context_excludes\") or has(\"expect_audit_log\") or has(\"expect_no_audit_log\"))" "$case_file")"
    payload="$(jq -c ".cases[$i].payload" "$case_file")"

    # Sanitized environment: session opt-ins never leak in from the caller;
    # audit-log writes land in a per-case throwaway file, not the repo's
    # .somi/; the project root is a per-case temp dir so .somi/config.json
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
    if ! stage_case_files "$case_file" "$i" "$case_dir" "files" "$script_rel" "$name"; then
      failures=$((failures + 1))
      continue
    fi

    # "setup_git": true — real git repo in the case dir, with whatever
    # "files" staged committed as its baseline, so hooks that shell out to
    # `git diff`/`git status` (e.g. inject-workflow-context.sh) have a real
    # HEAD to compare against.
    setup_git="$(jq -r ".cases[$i].setup_git // false" "$case_file")"
    if [[ "$setup_git" == "true" ]]; then
      git -C "$case_dir" init -q -b main
      git -C "$case_dir" config user.email "somi-fixture@test.local"
      git -C "$case_dir" config user.name "somi-fixture"
      git -C "$case_dir" add -A
      git -C "$case_dir" commit -q -m "fixture baseline" --allow-empty
    fi

    # "dirty_files": written after the baseline commit above, so a new path
    # is untracked and an overwritten committed path is modified-unstaged.
    if ! stage_case_files "$case_file" "$i" "$case_dir" "dirty_files" "$script_rel" "$name"; then
      failures=$((failures + 1))
      continue
    fi

    env_args=("SOMI_AUDIT_LOG=$case_dir/audit.log" "CLAUDE_PROJECT_DIR=$case_dir")
    while IFS= read -r kv; do
      [[ -z "$kv" ]] && continue
      env_args+=("$kv")
    done < <(jq -r ".cases[$i].env // {} | to_entries[] | \"\(.key)=\(.value)\"" "$case_file")

    # "prime": true — run the hook once first, discarding output, so a
    # signature/state file the hook itself writes is already in place before
    # the real (assertable) invocation below. "files_after_prime" perturbs
    # that state between the two invocations (see header comment).
    prime="$(jq -r ".cases[$i].prime // false" "$case_file")"
    if [[ "$prime" == "true" ]]; then
      if ! printf '%s' "$payload" \
          | env -u SOMI_ALLOW_DEP_INSTALL -u SOMI_ALLOW_LOCKFILES "${env_args[@]}" "${cmd[@]}" >/dev/null; then
        echo "FAIL: [$script_rel] $name — priming invocation exited non-zero" >&2
        failures=$((failures + 1))
        continue
      fi
      if ! stage_case_files "$case_file" "$i" "$case_dir" "files_after_prime" "$script_rel" "$name"; then
        failures=$((failures + 1))
        continue
      fi
    fi

    if ! out="$(printf '%s' "$payload" \
        | env -u SOMI_ALLOW_DEP_INSTALL -u SOMI_ALLOW_LOCKFILES "${env_args[@]}" "${cmd[@]}")"; then
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

    if [[ -n "$expect_context_excludes" ]]; then
      context=""
      [[ -n "$out" ]] && context="$(jq -r '.hookSpecificOutput.additionalContext // empty' <<<"$out")"
      if [[ "$context" == *"$expect_context_excludes"* ]]; then
        echo "FAIL: [$script_rel] $name — additionalContext contained a substring it must not" >&2
        echo "        excluded substring: $expect_context_excludes" >&2
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
