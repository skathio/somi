#!/usr/bin/env bash
# somi-ai updater.
#
# Re-runs install with the previously-recorded scope and profile, after fetching
# the latest tagged version from the source repo.
#
# Usage:
#   update.sh [--target PATH] [--check]
#
# If --check is passed, only prints the current vs. available version and exits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd jq git

CHECK_ONLY=0
TARGET="$PWD"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$(cd "$2" && pwd)"; shift 2 ;;
    --check)  CHECK_ONLY=1; shift ;;
    -h|--help)
      cat <<EOF
somi-ai updater

Usage:
  update.sh [--target PATH] [--check]

  --target PATH    project root that has SOMI installed (default: \$PWD)
  --check          print current and available version, then exit
EOF
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

CURRENT_VERSION="$(cat "$SOMI_SOURCE_ROOT/VERSION" 2>/dev/null || echo "unknown")"

# Determine latest from origin (best-effort).
LATEST_VERSION=""
if [[ -d "$SOMI_SOURCE_ROOT/.git" ]]; then
  log::info "Fetching tags from origin …"
  git -C "$SOMI_SOURCE_ROOT" fetch --quiet --tags origin || log::warn "fetch failed (offline?)"
  LATEST_VERSION="$(git -C "$SOMI_SOURCE_ROOT" tag --list 'v*' --sort=-v:refname | head -n1 | sed 's/^v//')"
fi

log::info "Current installed version: $CURRENT_VERSION"
log::info "Latest available version:  ${LATEST_VERSION:-unknown}"

if [[ $CHECK_ONLY -eq 1 ]]; then
  exit 0
fi

# Find the installed scope/profile from the project's install.json.
INSTALL_META=""
for candidate in "$TARGET/.claude/.somi/install.json" "$HOME/.claude/.somi/install.json"; do
  if [[ -f "$candidate" ]]; then
    INSTALL_META="$candidate"
    break
  fi
done
[[ -z "$INSTALL_META" ]] && die "no existing SOMI install found at $TARGET or in user scope. Run install.sh first."

SCOPE="$(jq -r '.scope' "$INSTALL_META")"
PROFILE="$(jq -r '.profile' "$INSTALL_META")"

log::info "Detected install: scope=$SCOPE profile=$PROFILE (from $INSTALL_META)"

# Check out the latest tag if we have it.
if [[ -n "$LATEST_VERSION" && -d "$SOMI_SOURCE_ROOT/.git" ]]; then
  if [[ "$LATEST_VERSION" != "$CURRENT_VERSION" ]]; then
    log::info "Checking out tag v$LATEST_VERSION …"
    git -C "$SOMI_SOURCE_ROOT" checkout --quiet "v$LATEST_VERSION"
  else
    log::ok "Already on the latest version."
  fi
fi

# Re-run install with the recorded scope and profile.
"$SCRIPT_DIR/install.sh" --scope "$SCOPE" --profile "$PROFILE" --target "$TARGET"

log::ok "Update complete."
