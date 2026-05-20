#!/usr/bin/env bash
# somi-ai repository validator.
#
# Checks that all agent / skill / command / hook files are well-formed and
# internally consistent. Run as part of CI on every PR.
#
# Exit codes:
#   0 = all checks pass
#   1 = one or more checks failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd jq

FAILED=0

fail() {
  FAILED=1
  log::err "$*"
}

# 1. Plugin manifest: present, valid JSON, required keys.
log::info "Validating plugin manifest …"
PLUGIN_JSON="$SOMI_SOURCE_ROOT/.claude-plugin/plugin.json"
if [[ ! -f "$PLUGIN_JSON" ]]; then
  fail "$PLUGIN_JSON not found"
elif ! jq empty "$PLUGIN_JSON" 2>/dev/null; then
  fail "$PLUGIN_JSON is not valid JSON"
else
  for key in name version description; do
    if [[ "$(jq -r ".${key} // empty" "$PLUGIN_JSON")" == "" ]]; then
      fail "plugin.json missing required key: $key"
    fi
  done
fi

# 2. VERSION file: present, non-empty, semver-ish.
log::info "Validating VERSION …"
VERSION_FILE="$SOMI_SOURCE_ROOT/VERSION"
if [[ ! -f "$VERSION_FILE" ]]; then
  fail "VERSION not found"
else
  V="$(tr -d '[:space:]' < "$VERSION_FILE")"
  if [[ ! "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    fail "VERSION is not SemVer-shaped: '$V'"
  fi
fi

# 3. Marketplace manifest references a real plugin.
log::info "Validating marketplace manifest …"
MARKETPLACE_JSON="$SOMI_SOURCE_ROOT/.claude-plugin/marketplace.json"
if [[ -f "$MARKETPLACE_JSON" ]]; then
  if ! jq empty "$MARKETPLACE_JSON" 2>/dev/null; then
    fail "$MARKETPLACE_JSON is not valid JSON"
  fi
fi

# 4. Agents: every .md has YAML frontmatter with required keys.
log::info "Validating agents …"
shopt -s nullglob
for f in "$SOMI_SOURCE_ROOT"/agents/*.md; do
  if ! head -n 1 "$f" | grep -q '^---$'; then
    fail "$f missing frontmatter"
    continue
  fi
  # Extract frontmatter block (between first two --- lines).
  fm="$(awk '/^---$/{c++; next} c==1{print} c==2{exit}' "$f")"
  for key in name description; do
    if ! grep -qE "^${key}:" <<<"$fm"; then
      fail "$f missing frontmatter key: $key"
    fi
  done
done

# 5. Commands: every .md has frontmatter with description.
log::info "Validating commands …"
for f in "$SOMI_SOURCE_ROOT"/commands/*.md; do
  if ! head -n 1 "$f" | grep -q '^---$'; then
    fail "$f missing frontmatter"
    continue
  fi
  fm="$(awk '/^---$/{c++; next} c==1{print} c==2{exit}' "$f")"
  if ! grep -qE '^description:' <<<"$fm"; then
    fail "$f missing frontmatter key: description"
  fi
done

# 6. Skills: every skill has SKILL.md with frontmatter name+description.
log::info "Validating skills …"
for d in "$SOMI_SOURCE_ROOT"/skills/*/; do
  skill="$d/SKILL.md"
  if [[ ! -f "$skill" ]]; then
    fail "$d missing SKILL.md"
    continue
  fi
  if ! head -n 1 "$skill" | grep -q '^---$'; then
    fail "$skill missing frontmatter"
    continue
  fi
  fm="$(awk '/^---$/{c++; next} c==1{print} c==2{exit}' "$skill")"
  for key in name description; do
    if ! grep -qE "^${key}:" <<<"$fm"; then
      fail "$skill missing frontmatter key: $key"
    fi
  done
done

# 7. Hooks: every .sh starts with bash shebang, is executable, and `bash -n` parses cleanly.
log::info "Validating hooks …"
find "$SOMI_SOURCE_ROOT/hooks" -name '*.sh' -type f -print0 |
while IFS= read -r -d '' f; do
  if ! head -n 1 "$f" | grep -qE '^#!/usr/bin/env bash'; then
    fail "$f missing #!/usr/bin/env bash shebang"
  fi
  if [[ ! -x "$f" ]]; then
    fail "$f is not executable"
  fi
  if ! bash -n "$f" 2>/dev/null; then
    fail "$f has bash syntax errors"
  fi
done

# 8. Settings.json: valid JSON, references real hook paths (relative to SOMI_ROOT).
log::info "Validating .claude/settings.json …"
SETTINGS="$SOMI_SOURCE_ROOT/.claude/settings.json"
if [[ ! -f "$SETTINGS" ]]; then
  fail "$SETTINGS not found"
elif ! jq empty "$SETTINGS" 2>/dev/null; then
  fail "$SETTINGS is not valid JSON"
else
  # Every hook command must reference an existing script under hooks/.
  while IFS= read -r cmd; do
    # Strip ${SOMI_ROOT}/ prefix.
    rel="${cmd#\$\{SOMI_ROOT\}/}"
    abs="$SOMI_SOURCE_ROOT/$rel"
    if [[ ! -f "$abs" ]]; then
      fail "settings.json references missing hook: $rel"
    fi
  done < <(jq -r '.hooks | to_entries[] | .value[]?.hooks[]?.command // empty' "$SETTINGS")
fi

# 9. Install profiles: each component referenced must exist (path or known alias).
log::info "Validating install profiles …"
KNOWN_ALIASES="rules claudemd agents commands skills hooks settings templates"
for p in "$SOMI_SOURCE_ROOT"/install/profiles/*.json; do
  if ! jq empty "$p" 2>/dev/null; then
    fail "$p is not valid JSON"
    continue
  fi
  while IFS= read -r comp; do
    if [[ " $KNOWN_ALIASES " == *" $comp "* ]]; then
      continue
    fi
    # Treat as path under repo root.
    candidate="$SOMI_SOURCE_ROOT/${comp%/}"
    if [[ ! -e "$candidate" ]]; then
      fail "$p references missing component: $comp"
    fi
  done < <(jq -r '.components[]' "$p")
done

# 10. Rules: CLAUDE.md exists and references each numbered rule file.
log::info "Validating rules composition …"
RULES_CLAUDE="$SOMI_SOURCE_ROOT/rules/CLAUDE.md"
if [[ ! -f "$RULES_CLAUDE" ]]; then
  fail "rules/CLAUDE.md not found"
else
  for f in 00-priorities.md 10-solid.md 20-clean-code.md 30-security-owasp.md 40-engineering-practices.md 50-collaboration.md 99-overrides.md; do
    if [[ ! -f "$SOMI_SOURCE_ROOT/rules/$f" ]]; then
      fail "rules/$f not found"
    fi
    if ! grep -q "$f" "$RULES_CLAUDE"; then
      fail "rules/CLAUDE.md does not reference $f"
    fi
  done
fi

# 11. Templates: present and shaped as templates (no obvious half-finished sections).
log::info "Validating templates …"
for t in PLAN.md.tmpl ITERATION.md.tmpl ADR.md.tmpl REVIEW.md.tmpl DOD.md.tmpl; do
  if [[ ! -f "$SOMI_SOURCE_ROOT/templates/$t" ]]; then
    fail "templates/$t not found"
  fi
done

if [[ $FAILED -eq 0 ]]; then
  log::ok "All validation checks passed."
  exit 0
fi
log::err "Validation failed. See messages above."
exit 1
