#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — block clearly dangerous shell commands.
#
# This is a deterministic guardrail, not a policy debate. It catches the
# common-and-catastrophic class of mistakes; nuanced cases are the human's call.
#
# Block list focuses on irreversible / system-destructive / supply-chain shapes,
# plus shell-level writes to secret-bearing paths — the Bash-side complement of
# block-secret-writes.sh, whose Write|Edit matcher a redirect / tee / sed -i /
# cp / mv would otherwise bypass entirely.
# It is intentionally conservative — false positives cost less than false negatives here.
#
# Behavioral fixtures for this script live in tests/hooks/cases/ and run in CI
# via scripts/validate.sh. If you change a pattern, add or update a fixture.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

CMD="$(somi::field '.tool_input.command')"
[[ -z "$CMD" ]] && exit 0

# Quote-stripped copy. `bash -c "rm -rf /"` hides the dangerous string inside
# quotes where the patterns' trailing boundary classes ([[:space:]]|$) don't
# match. Stripping quote characters never removes dangerous content — it only
# widens matching — so every check runs against both the raw and the stripped
# form. False positives are tolerated here by design.
CMD_STRIPPED=${CMD//\"/}
CMD_STRIPPED=${CMD_STRIPPED//\'/}

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
  # force-push via +refspec — no --force flag involved (`git push origin +main`, `+HEAD:main`)
  'git[[:space:]]+push[[:space:]]+[^;&|]*[[:space:]]\+(main|master|trunk|release)([[:space:]:]|$)'
  'git[[:space:]]+push[[:space:]]+[^;&|]*[[:space:]]\+[^[:space:]]*:(main|master|trunk|release)([[:space:]]|$)'
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

# Secret-bearing targets for the shell-write check below. Mirrors the basename
# list in block-secret-writes.sh (keep the two in sync when extending either).
SECRET_BASENAME='(\.env(\.(local|production|prod|staging|secret))?|id_(rsa|ed25519|ecdsa|dsa)|[^[:space:]]*\.(pem|key|p12|pfx|jks)|[^[:space:]]*(-key|-credentials)\.json|service-account[^[:space:]]*\.json|\.netrc|\.pgpass|[^[:space:]]*secrets?\.(ya?ml|json))'

# Shell-level writes to secret paths: redirection, tee, in-place sed, cp/mv onto
# the target. These run against the quote-stripped command.
SECRET_WRITE_PATTERNS=(
  "(>|>>)[[:space:]]*([^[:space:]]*/)?${SECRET_BASENAME}([[:space:]]|$)"
  "(^|[[:space:]|;&])tee[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*([^[:space:]]*/)?${SECRET_BASENAME}([[:space:]]|$)"
  "(^|[[:space:]|;&])sed[[:space:]]+[^|;&]*-i[^|;&]*[[:space:]]([^[:space:]]*/)?${SECRET_BASENAME}([[:space:]]|$)"
  "(^|[[:space:]|;&])(cp|mv)[[:space:]]+[^|;&]*[[:space:]]([^[:space:]]*/)?${SECRET_BASENAME}([[:space:]]|$)"
)

check_dangerous() {
  local c="$1" pattern
  for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    if [[ "$c" =~ $pattern ]]; then
      somi::deny_pretool "somi refused this command: it matches a dangerous-shell pattern (\`${BASH_REMATCH[0]}\`).
If this is genuinely intended, stop and ask the human to run it themselves — never work around this hook silently."
    fi
  done

  shopt -s nocasematch
  for pattern in "${DANGEROUS_PATTERNS_NOCASE[@]}"; do
    if [[ "$c" =~ $pattern ]]; then
      somi::deny_pretool "somi refused this command: it matches a destructive-SQL pattern (\`${BASH_REMATCH[0]}\`).
If this is genuinely intended, stop and ask the human to run it themselves — never work around this hook silently."
    fi
  done
  shopt -u nocasematch
}

check_secret_writes() {
  local c="$1" pattern matched
  for pattern in "${SECRET_WRITE_PATTERNS[@]}"; do
    if [[ "$c" =~ $pattern ]]; then
      matched="${BASH_REMATCH[0]}"
      # Explicit example/template files are fine — same exception as block-secret-writes.sh.
      # (Capture the match first: the exception's own =~ resets BASH_REMATCH.)
      if [[ "$matched" =~ \.env\.(example|sample|template|dist) ]]; then
        continue
      fi
      somi::deny_pretool "somi refused this command: it writes to a secret-bearing path via the shell (\`${matched}\`).
Bootstrap secret files by hand, or commit only \`.env.example\`-style templates. This is the
Bash-side twin of the Write/Edit secret guard — do not work around either silently."
    fi
  done
}

# Force-push without a verifiable target. The protected-branch patterns above
# only fire when the branch is named in the command — but `git push -f`,
# `git push -f origin`, and `git push -f origin HEAD` push the *current* branch,
# which this hook cannot resolve (it may well be main). Deny force pushes that
# don't name an explicit target branch; naming it is what makes the
# protected-branch check meaningful.
check_bare_force_push() {
  local c="$1"
  local re='git[[:space:]]+push([[:space:]]+[^;&|]*)?[[:space:]](-f|--force(-with-lease(=[^[:space:]]*)?)?)([[:space:]]|$)'
  [[ "$c" =~ $re ]] || return 0

  local after_push="${c#*push}"
  local nonflag_count=0 names_bare_head=0 tok
  # shellcheck disable=SC2086  # intentional word splitting of the command tail
  for tok in $after_push; do
    case "$tok" in
      ';'|'&&'|'||'|'|') break ;;   # stop at a command boundary
      -*) continue ;;               # flags don't name a target
    esac
    nonflag_count=$((nonflag_count + 1))
    if [[ $nonflag_count -eq 2 && "$tok" == "HEAD" ]]; then
      names_bare_head=1
    fi
  done

  if (( nonflag_count < 2 )) || (( names_bare_head == 1 )); then
    somi::deny_pretool "somi refused this command: force-push without an explicit target branch (the current branch cannot be verified and may be protected).
Name the remote and branch explicitly — e.g. \`git push --force-with-lease origin feature-x\`.
Force pushes naming main/master/trunk/release are always refused; if this is genuinely
intended, stop and ask the human to run it themselves."
  fi
}

check_dangerous "$CMD"
check_dangerous "$CMD_STRIPPED"
check_secret_writes "$CMD_STRIPPED"
check_bare_force_push "$CMD_STRIPPED"

exit 0
