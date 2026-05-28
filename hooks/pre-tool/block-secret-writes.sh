#!/usr/bin/env bash
# PreToolUse hook (matcher: Write|Edit) — block writes to secret-bearing paths.
#
# We block any attempt to write/edit files that are likely to hold real secrets.
# If the user genuinely needs to bootstrap a `.env`, they can do it themselves
# or explicitly add an override in their settings.local.json.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

somi::read_payload

TOOL="$(somi::field '.tool_name')"
PATH_INPUT="$(somi::field '.tool_input.file_path')"
[[ -z "$PATH_INPUT" ]] && exit 0

# Normalise to basename + path for pattern matching.
BASENAME="$(basename "$PATH_INPUT")"

SECRET_PATTERNS=(
  # env files (allow .env.example, .env.sample, .env.template explicitly)
  '^\.env$'
  '^\.env\.local$'
  '^\.env\.production$'
  '^\.env\.prod$'
  '^\.env\.staging$'
  '^\.env\.secret$'

  # private keys and certs
  '\.pem$'
  '\.key$'
  '\.p12$'
  '\.pfx$'
  '\.jks$'
  '^id_rsa$'
  '^id_ed25519$'
  '^id_ecdsa$'
  '^id_dsa$'

  # cloud credentials
  '^credentials$'      # ~/.aws/credentials
  '^config$'           # ~/.aws/config (usually contains profile refs but no secrets)

  # service-account keys
  '-key\.json$'
  '-credentials\.json$'
  'service-account.*\.json$'

  # shell rc files (may contain export STATEMENTS with secrets)
  '\.netrc$'
  '\.pgpass$'

  # vault / secret tool files
  '\.kdbx$'
  'secrets?\.ya?ml$'
  'secrets?\.json$'
)

# Allow explicit example/template files.
EXAMPLE_BASENAMES=(
  '.env.example'
  '.env.sample'
  '.env.template'
  '.env.dist'
)

for ex in "${EXAMPLE_BASENAMES[@]}"; do
  if [[ "$BASENAME" == "$ex" ]]; then
    exit 0
  fi
done

for pattern in "${SECRET_PATTERNS[@]}"; do
  if [[ "$BASENAME" =~ $pattern ]]; then
    somi::deny_pretool "somi-ai refused to ${TOOL} \`${PATH_INPUT}\`: this path is in the secret-bearing allowlist.
Bootstrap secret files by hand, or commit only \`.env.example\`-style templates."
  fi
done

exit 0
