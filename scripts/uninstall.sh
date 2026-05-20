#!/usr/bin/env bash
# somi-ai uninstaller.
#
# Removes SOMI-installed paths. Does NOT remove:
#   - user edits to settings.json (we restore from a backup we made at install time when possible)
#   - the project's own CLAUDE.md if it has been modified
#   - PLAN.md / REVIEW.md artifacts you produced with SOMI workflows
#
# Usage:
#   uninstall.sh [--target PATH] [--scope project|user|plugin] [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SCOPE=""
TARGET="$PWD"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)  SCOPE="$2"; shift 2 ;;
    --target) TARGET="$(cd "$2" && pwd)"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    -h|--help)
      cat <<EOF
somi-ai uninstaller

Usage:
  uninstall.sh [--scope project|user|plugin] [--target PATH] [--force]

If --scope is omitted, the scope is read from .somi/install.json.
EOF
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

# Locate install metadata if scope wasn't given.
if [[ -z "$SCOPE" ]]; then
  for candidate in "$TARGET/.claude/.somi/install.json" "$HOME/.claude/.somi/install.json"; do
    if [[ -f "$candidate" ]]; then
      SCOPE="$(jq -r '.scope' "$candidate")"
      break
    fi
  done
fi
[[ -z "$SCOPE" ]] && die "could not determine scope. Pass --scope explicitly."

INSTALL_DIR="$(somi::target_dir "$SCOPE" "$TARGET")"
PLUGIN_DIR="$(somi::plugin_root "$SCOPE" "$TARGET")"

log::warn "About to remove SOMI-managed paths under: $INSTALL_DIR"
log::dim  "  - rules/, agents/, commands/, skills/, templates/"
log::dim  "  - plugins/somi-ai/"
log::dim  "  - .somi/install.json"
log::warn "Will NOT remove: settings.json (SOMI hooks will be stripped), CLAUDE.md, PLAN.md, REVIEW.md, audit.log"

if [[ $FORCE -ne 1 ]]; then
  read -r -p "Proceed? [y/N] " ans
  [[ "$ans" =~ ^[yY]$ ]] || { log::info "Aborted."; exit 0; }
fi

# Remove SOMI-managed directories.
for d in rules agents commands skills templates; do
  if [[ -d "$INSTALL_DIR/$d" ]]; then
    rm -rf "${INSTALL_DIR:?}/$d"
    log::ok "- $INSTALL_DIR/$d"
  fi
done

# Remove the plugin dir.
if [[ -d "$PLUGIN_DIR" ]]; then
  rm -rf "$PLUGIN_DIR"
  log::ok "- $PLUGIN_DIR"
fi

# Remove install metadata.
if [[ -d "$INSTALL_DIR/.somi" ]]; then
  rm -rf "$INSTALL_DIR/.somi"
  log::ok "- $INSTALL_DIR/.somi"
fi

# Strip SOMI hooks from settings.json if present.
SETTINGS="$INSTALL_DIR/settings.json"
if [[ -f "$SETTINGS" ]]; then
  log::info "stripping SOMI hook entries from settings.json …"
  tmp="$(mktemp)"
  jq '
    .hooks //= {}
    | .hooks = (
        .hooks
        | with_entries(
            .value |= (
              map(
                .hooks |= map(select(
                  (.command // "" | test("/somi-ai/hooks/")) | not
                ))
              )
              | map(select((.hooks // []) | length > 0))
            )
          )
      )
    | .hooks = (.hooks | with_entries(select(.value | length > 0)))
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  log::ok "~ $SETTINGS (SOMI hook entries stripped)"
fi

log::ok "Uninstall complete."
log::dim "Note: artifacts you produced (PLAN.md, REVIEW.md, audit.log) are preserved."
