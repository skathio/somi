#!/usr/bin/env bash
# somi-ai installer.
#
# Usage:
#   install.sh --scope <project|user|plugin> [--profile <minimal|standard|full>] [--target <path>] [--force]
#
# Behavior:
#   - project: vendors SOMI under <target>/.claude/{rules,agents,commands,skills,templates}
#              and the plugin payload (hooks + settings) under
#              <target>/.claude/plugins/somi-ai/. CLAUDE.md goes at the project root.
#   - user:    installs the same layout under $HOME/.claude.
#   - plugin:  installs only under <target>/.claude/plugins/somi-ai, ready to be
#              consumed by `/plugin install somi-ai@...` from a marketplace.
#
# Idempotent: re-running upgrades in place. Use --force to overwrite local edits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SCOPE=""
PROFILE="standard"
TARGET="$PWD"
FORCE=0

usage() {
  cat <<EOF
somi-ai installer

Usage:
  install.sh --scope <project|user|plugin> [options]

Required:
  --scope SCOPE         project | user | plugin

Options:
  --profile PROFILE     minimal | standard | full   (default: standard)
  --target PATH         project root to install into for project/plugin scopes (default: \$PWD)
  --force               overwrite local modifications without prompting
  -h, --help            show this help

Examples:
  install.sh --scope project --profile standard
  install.sh --scope user --profile full
  install.sh --scope plugin --target /tmp/marketplace-checkout
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)   SCOPE="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --target)  TARGET="$(cd "$2" && pwd)"; shift 2 ;;
    --force)   FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (use --help)" ;;
  esac
done

[[ -z "$SCOPE" ]] && { usage; die "--scope is required"; }
[[ "$SCOPE" =~ ^(project|user|plugin)$ ]] || die "invalid scope: $SCOPE"
[[ "$PROFILE" =~ ^(minimal|standard|full)$ ]] || die "invalid profile: $PROFILE"

require_cmd jq

PROFILE_FILE="$SOMI_SOURCE_ROOT/install/profiles/${PROFILE}.json"
[[ -f "$PROFILE_FILE" ]] || die "profile not found: $PROFILE_FILE"

INSTALL_DIR="$(somi::target_dir "$SCOPE" "$TARGET")"
PLUGIN_DIR="$(somi::plugin_root "$SCOPE" "$TARGET")"

log::info "Source:     $SOMI_SOURCE_ROOT"
log::info "Scope:      $SCOPE"
log::info "Profile:    $PROFILE"
log::info "Target:     $INSTALL_DIR"
log::info "Plugin dir: $PLUGIN_DIR"

# Read components from profile.
COMPONENTS=()
while IFS= read -r line; do
  COMPONENTS+=("$line")
done < <(jq -r '.components[]' "$PROFILE_FILE")

mkdir -p "$INSTALL_DIR" "$PLUGIN_DIR"

# Copy a source path to an install path. Source can be a file or a directory.
copy_path() {
  local src="$1" dst="$2"
  if [[ -d "$src" ]]; then
    mkdir -p "$dst"
    # Use cp -a to preserve executable bits on hook scripts.
    cp -a "$src/." "$dst/"
  elif [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    if [[ -e "$dst" && "$FORCE" -ne 1 ]]; then
      # Skip if identical; warn otherwise.
      if cmp -s "$src" "$dst"; then
        log::dim "= $dst (unchanged)"
        return 0
      fi
      log::warn "! $dst already exists — overwriting (use --force to suppress this warning)"
    fi
    cp -a "$src" "$dst"
  else
    die "source path not found: $src"
  fi
  log::ok "+ $dst"
}

# Install each component listed in the profile. The component may be:
#   - a top-level alias (rules, agents, commands, skills, hooks, settings, claudemd, templates)
#   - a relative path to a single file (agents/planner.md)
#   - a relative path to a sub-tree (skills/owasp-defense/)
install_component() {
  local comp="$1"
  local src dst

  case "$comp" in
    rules)
      copy_path "$SOMI_SOURCE_ROOT/rules" "$INSTALL_DIR/rules"
      ;;
    claudemd)
      # CLAUDE.md goes to the project root (or ~ for user scope).
      case "$SCOPE" in
        project) dst="$TARGET/CLAUDE.md" ;;
        user)    dst="$HOME/.claude/CLAUDE.md" ;;
        plugin)  dst="$PLUGIN_DIR/CLAUDE.md" ;;
      esac
      copy_path "$SOMI_SOURCE_ROOT/rules/CLAUDE.md" "$dst"
      ;;
    agents)
      copy_path "$SOMI_SOURCE_ROOT/agents" "$INSTALL_DIR/agents"
      ;;
    agents/*)
      copy_path "$SOMI_SOURCE_ROOT/$comp" "$INSTALL_DIR/$comp"
      ;;
    commands)
      copy_path "$SOMI_SOURCE_ROOT/commands" "$INSTALL_DIR/commands"
      ;;
    commands/*)
      copy_path "$SOMI_SOURCE_ROOT/$comp" "$INSTALL_DIR/$comp"
      ;;
    skills)
      copy_path "$SOMI_SOURCE_ROOT/skills" "$INSTALL_DIR/skills"
      ;;
    skills/*)
      copy_path "$SOMI_SOURCE_ROOT/$comp" "$INSTALL_DIR/${comp%/}"
      ;;
    hooks)
      copy_path "$SOMI_SOURCE_ROOT/hooks" "$PLUGIN_DIR/hooks"
      ;;
    settings)
      install_settings
      ;;
    templates)
      copy_path "$SOMI_SOURCE_ROOT/templates" "$INSTALL_DIR/templates"
      ;;
    *)
      log::warn "unknown component: $comp (skipping)"
      ;;
  esac
}

# settings.json install: copy if absent; merge if present.
install_settings() {
  local src="$SOMI_SOURCE_ROOT/.claude/settings.json"
  local dst="$INSTALL_DIR/settings.json"

  if [[ ! -f "$dst" ]] || [[ "$FORCE" -eq 1 ]]; then
    cp -a "$src" "$dst"
    log::ok "+ $dst"
    return 0
  fi

  # Merge: existing project settings win for permissions; SOMI hooks are appended.
  log::info "merging into existing settings.json (SOMI hooks union; project permissions preserved)"
  local merged
  merged="$(jq -s '
    .[0] as $existing
    | .[1] as $somi
    | $existing
      * {
          env: ((($existing.env // {}) + ($somi.env // {}))),
          permissions: {
            allow: (((($existing.permissions.allow // []) + ($somi.permissions.allow // [])) | unique)),
            deny:  (((($existing.permissions.deny  // []) + ($somi.permissions.deny  // [])) | unique))
          },
          hooks: (
            (($existing.hooks // {}) as $eh
             | ($somi.hooks // {}) as $ch
             | reduce ($eh + $ch | keys | unique[]) as $event ({}; .[$event] = (($eh[$event] // []) + ($ch[$event] // []))))
          )
        }
  ' "$dst" "$src")"
  printf '%s\n' "$merged" > "$dst.new"
  mv "$dst.new" "$dst"
  log::ok "~ $dst (merged)"
}

# Always install CLAUDE.md and rules first so other components can reference them sanely.
for comp in "${COMPONENTS[@]}"; do
  install_component "$comp"
done

# Always copy plugin manifest into the plugin dir so it identifies as somi-ai.
mkdir -p "$PLUGIN_DIR/.claude-plugin"
cp -a "$SOMI_SOURCE_ROOT/.claude-plugin/plugin.json" "$PLUGIN_DIR/.claude-plugin/plugin.json"

# Record install metadata.
mkdir -p "$INSTALL_DIR/.somi"
cat > "$INSTALL_DIR/.somi/install.json" <<EOF
{
  "scope": "$SCOPE",
  "profile": "$PROFILE",
  "version": "$(cat "$SOMI_SOURCE_ROOT/VERSION")",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "$SOMI_SOURCE_ROOT"
}
EOF
log::ok "+ $INSTALL_DIR/.somi/install.json"

log::ok "somi-ai $(cat "$SOMI_SOURCE_ROOT/VERSION") installed."
log::info "Next steps:"
log::dim "  - Open the project in Claude Code (or reload the window)."
log::dim "  - Try: /plan <your problem statement>"
log::dim "  - See docs/USAGE.md for the full workflow."
