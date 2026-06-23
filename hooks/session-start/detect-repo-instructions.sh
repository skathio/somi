#!/usr/bin/env bash
# SessionStart hook — detect repo-local agent/instruction files and surface them.
#
# SoMi's MAX→ECO economy is "respect repo conventions as context": when a project
# ships its own instructions (CLAUDE.md / AGENTS.md / copilot-instructions /
# .cursorrules) or its own subagents (.claude/agents/), SoMi's MAX actions should
# read them once and fold the relevant conventions into the work-item brief.md, so
# the ECO tier inherits them without re-reading. Repo-local instructions WIN over
# SoMi defaults where they conflict; SoMi does NOT auto-invoke foreign agents.
#
# This hook only *surfaces* what exists (paths + a one-line directive) — it does not
# read or ingest file contents (that's the MAX agent's job, and keeps this cheap).
# It fires once per session and stays silent when nothing repo-local is present.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
# Some hosts pass an unexpanded literal; fall back to the resolvable cwd.
[[ "$PROJECT_ROOT" == *'${'* ]] && PROJECT_ROOT="$PWD"

FOUND=()

# Root-level instruction files the consumer repo may ship.
for f in "CLAUDE.md" "AGENTS.md" ".cursorrules" ".github/copilot-instructions.md"; do
  [[ -f "$PROJECT_ROOT/$f" ]] && FOUND+=("$f")
done

# Nested CLAUDE.md / AGENTS.md (cap depth and count so this stays cheap and never
# wanders into .git / node_modules / .somi).
while IFS= read -r nested; do
  [[ -z "$nested" ]] && continue
  rel="${nested#"$PROJECT_ROOT"/}"
  FOUND+=("$rel")
done < <(
  find "$PROJECT_ROOT" -maxdepth 3 \
    \( -path "$PROJECT_ROOT/.git" -o -path "$PROJECT_ROOT/node_modules" \
       -o -path "$PROJECT_ROOT/.somi" -o -path "$PROJECT_ROOT/vendor" \) -prune -o \
    -mindepth 2 -type f \( -name 'CLAUDE.md' -o -name 'AGENTS.md' \) -print 2>/dev/null \
  | head -n 10
)

# Repo-local subagents (note presence only — never auto-invoke them).
REPO_AGENTS=""
if [[ -d "$PROJECT_ROOT/.claude/agents" ]]; then
  count="$(find "$PROJECT_ROOT/.claude/agents" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
  [[ "${count:-0}" -gt 0 ]] && REPO_AGENTS=".claude/agents/ (${count} repo-local subagent definition(s))"
fi

if (( ${#FOUND[@]} == 0 )) && [[ -z "$REPO_AGENTS" ]]; then
  exit 0
fi

MSG="somi repo-awareness — this repository ships its own instructions/agents. Respect them as context:"
if (( ${#FOUND[@]} > 0 )); then
  # De-duplicate while preserving order.
  seen=""
  for f in "${FOUND[@]}"; do
    case " $seen " in *" $f "*) continue;; esac
    seen+=" $f"
    MSG+=$'\n  - '"$f"
  done
fi
[[ -n "$REPO_AGENTS" ]] && MSG+=$'\n  - '"$REPO_AGENTS"
MSG+=$'\nMAX actions (/discover, /design, /refactor analysis, and /plan on a cold start) should read these once and distil the relevant conventions into the work item'\''s brief.md / context.md so the ECO tier inherits them without re-reading. Repo-local instructions WIN over SoMi defaults where they conflict. Do NOT auto-invoke the repo'\''s own agents — surface them for the user to opt into.'

somi::context "SessionStart" "$MSG"
exit 0
