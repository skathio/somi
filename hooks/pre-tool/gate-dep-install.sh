#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — gate dependency-adding commands.
#
# Adding a runtime dependency crosses a trust boundary: it imports unreviewed code,
# expands attack surface, and creates a long-term maintenance obligation. The
# coder should not add deps as a drive-by — they belong in `decisions.md` or at
# minimum in the iteration summary so a human can sign off.
#
# This hook denies adding a *new* dep without an explicit acknowledgement
# (SOMI_ALLOW_DEP_INSTALL=1 in the env, set by the human for the session).
# Lockfile-respecting reinstalls (bare `npm install`, `yarn install`, etc.)
# are allowed — those don't add deps, they materialize what's already declared.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

CMD="$(somi::field '.tool_input.command')"
[[ -z "$CMD" ]] && exit 0

# Explicit opt-in: human acknowledged this session may add deps.
if [[ "${SOMI_ALLOW_DEP_INSTALL:-0}" == "1" ]]; then
  exit 0
fi

# Per-project allowlist from .somi/config.json (`dep_install.allow`) — committed,
# reviewable policy, scoped to name prefixes, unlike the all-or-nothing env opt-in.
# An entry is a PREFIX of a package argument: "@types/" allows `npm install
# @types/node`. Conservative by construction: compound commands (`;`, `&&`, `|`)
# never qualify, and EVERY package token must match an entry.
config_allows_dep() {
  local c="$1"
  local -a allow=()
  mapfile -t allow < <(somi::config '.dep_install.allow[]?')
  (( ${#allow[@]} > 0 )) || return 1
  [[ "$c" == *';'* || "$c" == *'&'* || "$c" == *'|'* ]] && return 1

  local -a toks=()
  local seen_verb=0 tok
  # shellcheck disable=SC2086  # intentional word splitting of the command
  for tok in $c; do
    if (( seen_verb )); then
      [[ "$tok" == -* ]] && continue
      toks+=("$tok")
    elif [[ "$tok" =~ ^(install|i|add|get|require)$ ]]; then
      seen_verb=1
    fi
  done
  (( ${#toks[@]} > 0 )) || return 1

  local t a ok
  for t in "${toks[@]}"; do
    ok=0
    for a in "${allow[@]}"; do
      [[ "$t" == "$a"* ]] && { ok=1; break; }
    done
    (( ok )) || return 1
  done
  return 0
}

# Patterns for "add a new dependency". A trailing package argument is required;
# bare `<pm> install` (no package) is the lockfile-respecting form and is fine.
DEP_ADD_PATTERNS=(
  # npm / yarn / pnpm / bun: install with at least one positional package
  'npm[[:space:]]+(install|i|add)[[:space:]]+([^-][^[:space:]]*|--save[[:space:]]+[^[:space:]]+|--save-dev[[:space:]]+[^[:space:]]+)'
  'yarn[[:space:]]+add[[:space:]]+[^-][^[:space:]]*'
  'pnpm[[:space:]]+(add|install)[[:space:]]+[^-][^[:space:]]*'
  'bun[[:space:]]+(add|install)[[:space:]]+[^-][^[:space:]]*'

  # python: pip / pipx / uv / poetry / conda
  'pip[0-9]*[[:space:]]+install[[:space:]]+([^-][^[:space:]]*|-r[[:space:]]+[^[:space:]]+\.txt)'
  'pip[0-9]*[[:space:]]+install[[:space:]]+--upgrade[[:space:]]+[^-][^[:space:]]*'
  'pipx[[:space:]]+install[[:space:]]+[^-][^[:space:]]*'
  'uv[[:space:]]+(add|pip[[:space:]]+install)[[:space:]]+[^-][^[:space:]]*'
  'poetry[[:space:]]+add[[:space:]]+[^-][^[:space:]]*'
  'conda[[:space:]]+install[[:space:]]+[^-][^[:space:]]*'

  # rust / go / ruby / php
  'cargo[[:space:]]+(add|install)[[:space:]]+[^-][^[:space:]]*'
  'go[[:space:]]+get[[:space:]]+[^-][^[:space:]]*'
  'go[[:space:]]+install[[:space:]]+[^-][^[:space:]]*'
  'gem[[:space:]]+install[[:space:]]+[^-][^[:space:]]*'
  'bundle[[:space:]]+add[[:space:]]+[^-][^[:space:]]*'
  'composer[[:space:]]+(require|install)[[:space:]]+[^-][^[:space:]]*'

  # generic curl-to-installer (`brew install` is borderline; install scripts often add tools).
  'brew[[:space:]]+install[[:space:]]+[^-][^[:space:]]*'
  'apt[[:space:]]+(install|add)[[:space:]]+[^-][^[:space:]]*'
  'apt-get[[:space:]]+install[[:space:]]+[^-][^[:space:]]*'
)

for pattern in "${DEP_ADD_PATTERNS[@]}"; do
  if [[ "$CMD" =~ $pattern ]]; then
    if config_allows_dep "$CMD"; then
      somi::audit "ALLOW" "dep install permitted by .somi/config.json dep_install.allow: $CMD"
      exit 0
    fi
    somi::deny_pretool "somi refused this command: it would add a new dependency (\`${BASH_REMATCH[0]}\`).
Adding a dep is a decision — record it in \`.somi/plans/<slug>/decisions.md\` (or surface it in
the iteration summary for the human) and re-run with \`SOMI_ALLOW_DEP_INSTALL=1\` in the
environment for this session, or have the human run the install themselves. Projects can also
allowlist package-name prefixes in \`.somi/config.json\` under \`dep_install.allow\`.
Lockfile-respecting reinstalls (bare \`npm install\` / \`pip install -r requirements.txt\`-less,
\`bundle install\`, etc.) are allowed without acknowledgement."
  fi
done

exit 0
