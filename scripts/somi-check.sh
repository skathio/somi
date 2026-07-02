#!/usr/bin/env bash
# somi-check.sh — host-agnostic working-tree guard (the portable enforcement layer).
#
# SoMi's deterministic hooks only run inside Claude Code. This script carries the
# working-tree subset of those guarantees to every other host: run it as a git
# pre-commit hook, a CI step, or via `npx` on GitHub Copilot setups — the
# environments where the tool-call-time hooks don't exist.
#
# Checks (each maps to a hook-layer guarantee):
#   1. Staged secret-bearing files      (block-secret-writes' basename patterns)
#   2. Staged lockfile hand-edits        (guard-protected-paths' lockfile gate;
#      honors .somi/config.json lockfiles.allow_edit and SOMI_ALLOW_LOCKFILES)
#   3. TODO(claude)/FIXME(claude) markers staged for commit (the loose-end nudge)
#   4. Scratch/backup files staged       (.bak/.orig/scratch_ — the same nudge)
#
# Usage:
#   scripts/somi-check.sh [--staged|--all]     (default: --staged; --all scans the
#                                               full working tree vs HEAD)
# Exit codes: 0 clean · 1 findings (fail the commit / CI step) · 64 error.
#
# Install as a pre-commit hook:
#   ln -s ../../<path-to-somi>/scripts/somi-check.sh .git/hooks/pre-commit
# Or as a CI step:
#   - run: bash <path-to-somi>/scripts/somi-check.sh --all
#
# Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

set -euo pipefail

die() { echo "somi-check: $*" >&2; exit 64; }
command -v git >/dev/null 2>&1 || die "requires git"

MODE="staged"
case "${1:-}" in
  --all) MODE="all" ;;
  --staged|"") ;;
  *) die "unknown argument: $1" ;;
esac

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
[[ "$ROOT" == *'${'* ]] && ROOT="$PWD"
git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository: $ROOT"

changed_files() {
  if [[ "$MODE" == "staged" ]]; then
    git -C "$ROOT" diff --cached --name-only --diff-filter=ACM
  else
    git -C "$ROOT" diff HEAD --name-only --diff-filter=ACM
    git -C "$ROOT" ls-files --others --exclude-standard
  fi
}

changed_content() { # additions only
  if [[ "$MODE" == "staged" ]]; then
    git -C "$ROOT" diff --cached --no-color --unified=0
  else
    git -C "$ROOT" diff HEAD --no-color --unified=0
  fi
}

# Mirrors block-secret-writes.sh's basename patterns (keep in sync when extending).
SECRET_PATTERNS=(
  '^\.env$' '^\.env\.local$' '^\.env\.production$' '^\.env\.prod$' '^\.env\.staging$' '^\.env\.secret$'
  '\.pem$' '\.key$' '\.p12$' '\.pfx$' '\.jks$'
  '^id_rsa$' '^id_ed25519$' '^id_ecdsa$' '^id_dsa$'
  '-key\.json$' '-credentials\.json$' 'service-account.*\.json$'
  '\.netrc$' '\.pgpass$' '\.kdbx$' 'secrets?\.ya?ml$' 'secrets?\.json$'
)
EXAMPLE_BASENAMES=('.env.example' '.env.sample' '.env.template' '.env.dist')

LOCKFILES=(package-lock.json yarn.lock pnpm-lock.yaml Cargo.lock Gemfile.lock poetry.lock uv.lock composer.lock go.sum)

lockfiles_allowed() {
  # env wins (including =0); then committed config; default deny.
  if [[ -n "${SOMI_ALLOW_LOCKFILES:-}" ]]; then
    [[ "$SOMI_ALLOW_LOCKFILES" == "1" ]]
    return
  fi
  local cfg="$ROOT/.somi/config.json"
  [[ -f "$cfg" ]] && [[ "$(jq -r '.lockfiles.allow_edit // empty' "$cfg" 2>/dev/null)" == "true" ]]
}

findings=0
report() { echo "somi-check: $1" >&2; findings=$((findings + 1)); }

# 1 + 2 + 4 — file-name checks.
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  base="$(basename "$f")"

  example=0
  for ex in "${EXAMPLE_BASENAMES[@]}"; do
    [[ "$base" == "$ex" ]] && { example=1; break; }
  done
  if (( ! example )); then
    for p in "${SECRET_PATTERNS[@]}"; do
      if [[ "$base" =~ $p ]]; then
        report "secret-bearing file in the change set: $f (commit only .env.example-style templates)"
        break
      fi
    done
  fi

  if ! lockfiles_allowed; then
    for l in "${LOCKFILES[@]}"; do
      if [[ "$base" == "$l" ]]; then
        # Hand-edit heuristic: a lockfile changing without its manifest alongside.
        dir="$(dirname "$f")"
        prefix=""
        [[ "$dir" != "." ]] && prefix="${dir}/"
        if ! changed_files | grep -qE "^${prefix}(package\.json|Cargo\.toml|Gemfile|pyproject\.toml|composer\.json|go\.mod)$"; then
          report "lockfile changed without its manifest: $f (regenerate via the package manager, or set lockfiles.allow_edit in .somi/config.json)"
        fi
        break
      fi
    done
  fi

  case "$base" in
    *.bak|*.orig|scratch_*)
      report "scratch/backup file in the change set: $f"
      ;;
  esac
done < <(changed_files)

# 3 — added TODO(claude)/FIXME(claude) markers.
if changed_content | grep -E '^\+.*(TODO\(claude\)|TODO\(agent\)|FIXME\(claude\))' -q; then
  report "TODO(claude)/FIXME(claude) markers added — resolve them or convert to owned follow-ups before committing"
fi

if (( findings > 0 )); then
  echo "somi-check: $findings finding(s) — see above." >&2
  exit 1
fi
echo "somi-check: clean."
