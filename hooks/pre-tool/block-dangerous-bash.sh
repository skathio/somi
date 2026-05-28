#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — block clearly dangerous shell commands.
#
# This is a deterministic guardrail, not a policy debate. It catches the
# common-and-catastrophic class of mistakes; nuanced cases are the human's call.
#
# Block list focuses on irreversible / system-destructive / supply-chain shapes.
# It is intentionally conservative — false positives cost less than false negatives here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

CMD="$(somi::field '.tool_input.command')"
[[ -z "$CMD" ]] && exit 0

# Case-sensitive patterns (filesystem paths, exact tools, exact flags).
DANGEROUS_PATTERNS=(
  # filesystem nukes
  'rm[[:space:]]+-rf?[[:space:]]+/([[:space:]]|$)'
  'rm[[:space:]]+-rf?[[:space:]]+~([[:space:]]|/|$)'
  'rm[[:space:]]+-rf?[[:space:]]+\*'
  'rm[[:space:]]+-rf?[[:space:]]+\$HOME'
  ':\(\)\{[[:space:]]*:\|:&[[:space:]]*\};:' # fork bomb

  # device / partition writes
  '>[[:space:]]*/dev/(sd[a-z]|nvme|hd[a-z]|disk)'
  'dd[[:space:]]+if=.*[[:space:]]+of=/dev/(sd[a-z]|nvme|hd[a-z]|disk)'
  'mkfs(\.|[[:space:]])'

  # supply-chain / remote-exec one-liners
  'curl[[:space:]]+[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba)?sh'
  'wget[[:space:]]+[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba)?sh'
  'curl[[:space:]]+[^|]*\|[[:space:]]*python[0-9]*'
  'wget[[:space:]]+[^|]*\|[[:space:]]*python[0-9]*'

  # destructive git ops on protected branches
  # Covers --force, -f, --force-with-lease (with or without =value), and refspec form (origin HEAD:main).
  'git[[:space:]]+push[[:space:]]+(-{1,2}force|-f)([[:space:]=]|$).*[[:space:]:](main|master|trunk|release)([[:space:]]|$)'
  'git[[:space:]]+push[[:space:]]+--force-with-lease([[:space:]=][^[:space:]]*)?[[:space:]].*[[:space:]:](main|master|trunk|release)([[:space:]]|$)'
  'git[[:space:]]+branch[[:space:]]+-D[[:space:]]+(main|master|trunk)'
  'git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+(origin/)?(main|master|trunk)'
  'git[[:space:]]+clean[[:space:]]+-[fdx]+[[:space:]]'

  # process / permission ops
  'chmod[[:space:]]+-R[[:space:]]+777[[:space:]]+/'
  'chown[[:space:]]+-R[[:space:]]+.*[[:space:]]+/'

  # skipping safety checks (only block when used in commit/push context)
  'git[[:space:]]+commit[[:space:]]+.*--no-verify'
  'git[[:space:]]+push[[:space:]]+.*--no-verify'
)

# Case-insensitive patterns (SQL keywords arrive in lowercase from ORM logs, mixed case from REPLs).
DANGEROUS_PATTERNS_NOCASE=(
  'DROP[[:space:]]+DATABASE'
  'DROP[[:space:]]+SCHEMA[[:space:]]+(public|prod|production)'
  'DROP[[:space:]]+TABLE[[:space:]]+[a-zA-Z_]+'
  'TRUNCATE[[:space:]]+(TABLE[[:space:]]+)?[a-zA-Z_]+'
  'DELETE[[:space:]]+FROM[[:space:]]+[a-zA-Z_]+[[:space:]]*;'
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if [[ "$CMD" =~ $pattern ]]; then
    somi::deny_pretool "somi-ai refused this command: it matches a dangerous-shell pattern (\`${BASH_REMATCH[0]}\`).
If this is genuinely intended, stop and ask the human to run it themselves — never work around this hook silently."
  fi
done

shopt -s nocasematch
for pattern in "${DANGEROUS_PATTERNS_NOCASE[@]}"; do
  if [[ "$CMD" =~ $pattern ]]; then
    somi::deny_pretool "somi-ai refused this command: it matches a destructive-SQL pattern (\`${BASH_REMATCH[0]}\`).
If this is genuinely intended, stop and ask the human to run it themselves — never work around this hook silently."
  fi
done
shopt -u nocasematch

exit 0
