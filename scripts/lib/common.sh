#!/usr/bin/env bash
# Shared helpers for somi-ai install / validate / update / uninstall scripts.

set -euo pipefail

# Source root: directory containing the scripts/ folder.
SOMI_SOURCE_ROOT="${SOMI_SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Color output if TTY.
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_GRN=$'\033[32m'; C_BLU=$'\033[34m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=''; C_YEL=''; C_GRN=''; C_BLU=''; C_DIM=''; C_OFF=''
fi

log::info()  { printf '%s[somi]%s %s\n'   "$C_BLU" "$C_OFF" "$*"; }
log::ok()    { printf '%s[somi]%s %s%s%s\n' "$C_BLU" "$C_OFF" "$C_GRN" "$*" "$C_OFF"; }
log::warn()  { printf '%s[somi]%s %s%s%s\n' "$C_BLU" "$C_OFF" "$C_YEL" "$*" "$C_OFF" >&2; }
log::err()   { printf '%s[somi]%s %s%s%s\n' "$C_BLU" "$C_OFF" "$C_RED" "$*" "$C_OFF" >&2; }
log::dim()   { printf '%s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }

die() {
  log::err "$*"
  exit 1
}

require_cmd() {
  for c in "$@"; do
    if ! command -v "$c" >/dev/null 2>&1; then
      die "required command not found: $c"
    fi
  done
}

# Resolve the install target directory for a given scope.
#   project: <target>/.claude
#   user:    $HOME/.claude
#   plugin:  <target>/.claude/plugins/somi-ai
somi::target_dir() {
  local scope="$1"
  local target="${2:-$PWD}"
  case "$scope" in
    project) printf '%s/.claude' "$target" ;;
    user)    printf '%s/.claude' "$HOME" ;;
    plugin)  printf '%s/.claude/plugins/somi-ai' "$target" ;;
    *)       die "unknown scope: $scope (expected project|user|plugin)" ;;
  esac
}

# Resolve the plugin root (where hooks live), relative to the install target.
somi::plugin_root() {
  local scope="$1"
  local target="${2:-$PWD}"
  case "$scope" in
    project) printf '%s/.claude/plugins/somi-ai' "$target" ;;
    user)    printf '%s/.claude/plugins/somi-ai' "$HOME" ;;
    plugin)  printf '%s/.claude/plugins/somi-ai' "$target" ;;
  esac
}
