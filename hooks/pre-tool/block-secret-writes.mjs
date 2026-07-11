#!/usr/bin/env node
// hooks/pre-tool/block-secret-writes.mjs — PreToolUse hook (matcher: Write|Edit) — block
// writes to secret-bearing paths.
//
// Node port of hooks/pre-tool/block-secret-writes.sh (node-runtime-port, phase 2,
// iteration 2.2). Imports the shared read/deny/context helpers from ../lib/common.mjs
// (2.1, reviewer-blessed) rather than reimplementing them.
//
// We block any attempt to write/edit files that are likely to hold real secrets. If the
// user genuinely needs to bootstrap a `.env`, they can do it themselves or explicitly add
// an override in their settings.local.json.
//
// SECRET_PATTERNS mirrors block-dangerous-bash.sh's SECRET_BASENAME set
// (block-dangerous-bash.sh:86) — "kept in sync by comment convention, not code sharing"
// today (context.md §2). Preserved as a deliberate duplication in this port; do not
// unify the two lists — that would be a scope-creeping refactor beyond this
// behavior-preserving port (flagged as a future-refactor target, same as today).
//
// ERE→RegExp translation note: every pattern below is basename-only, pure-ASCII, and
// uses only anchors, escaped literal dots, and `?`/`*` quantifiers (plus one bare `.`
// wildcard in the service-account pattern) — a mechanical, one-to-one translation, with
// no POSIX bracket-expression classes to convert. The `.`-semantics caveat that matters
// for block-dangerous-bash.sh's patterns (POSIX ERE `.` matches every byte but `\n`; JS
// `.` additionally refuses to match `\r`/U+2028/U+2029) is scoped to matching against
// raw COMMAND-STRING content — irrelevant here, since every pattern below matches a
// normalized file-path BASENAME extracted from the JSON payload, never raw content, and
// no realistic basename contains a line-terminator character for that divergence to bite.
// One platform sensitivity 2.3+ must inherit knowingly: path.basename() is posix-vs-win32
// separator-aware (on Windows, `C:\Users\me\.env` → `.env` → DENY, where bash basename on
// Linux treats `\` as a regular character → allow). For THIS hook the Windows behavior is
// strictly safer; for path-heavier hooks (guard-protected-paths) the same divergence could
// cut the unsafe way. The Linux fixture corpus validates only the posix axis.

import path from 'node:path';
import { readPayload, field, denyPretool, matchesAny, runHook } from '../lib/common.mjs';

const SECRET_PATTERNS = [
  // env files (allow .env.example, .env.sample, .env.template explicitly)
  /^\.env$/,
  /^\.env\.local$/,
  /^\.env\.production$/,
  /^\.env\.prod$/,
  /^\.env\.staging$/,
  /^\.env\.secret$/,

  // private keys and certs
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^id_ecdsa$/,
  /^id_dsa$/,

  // cloud credentials
  /^credentials$/, // ~/.aws/credentials
  /^config$/, // ~/.aws/config (usually contains profile refs but no secrets)

  // service-account keys
  /-key\.json$/,
  /-credentials\.json$/,
  /service-account.*\.json$/,

  // shell rc files (may contain export STATEMENTS with secrets)
  /\.netrc$/,
  /\.pgpass$/,

  // vault / secret tool files
  /\.kdbx$/,
  /secrets?\.ya?ml$/,
  /secrets?\.json$/,
];

// Allow explicit example/template files.
const EXAMPLE_BASENAMES = ['.env.example', '.env.sample', '.env.template', '.env.dist'];

function main() {
  const payload = readPayload();
  const tool = field(payload, '.tool_name');
  const pathInput = field(payload, '.tool_input.file_path');
  if (!pathInput) return;

  // Normalise to basename for pattern matching.
  const basename = path.basename(pathInput);

  if (EXAMPLE_BASENAMES.includes(basename)) return;

  if (matchesAny(basename, SECRET_PATTERNS)) {
    denyPretool(payload, `somi refused to ${tool} \`${pathInput}\`: this path is in the secret-bearing allowlist.
Bootstrap secret files by hand, or commit only \`.env.example\`-style templates.`);
  }
}

runHook(main);
