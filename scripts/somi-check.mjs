#!/usr/bin/env node
// somi-check.mjs — host-agnostic working-tree guard (the portable enforcement layer).
//
// Node port of scripts/somi-check.sh (node-runtime-port, phase 1, iteration 1.3).
// Zero-dependency: stdlib only (node:fs, node:path, node:child_process). No jq, no bash.
// Behavior-preserving — exit codes are frozen and reproduced exactly; see the bash
// original's header comment for the full rationale.
//
// SHEBANG NOTE (the sanctioned exception to D1's "no shebang/exec-bit reliance"
// principle for the hook/manifest invocation path): every other Node port in this
// work item (somi-loop.mjs, somi-findings.mjs) is invoked as `node <file>` and carries
// no shebang. This file keeps one because package.json's `bin` field
// ("somi-check": "scripts/somi-check.sh", repointed to this file in Phase 3 iteration
// 3.2) is a *separate* invocation path via npm's own bin-symlinking, which on POSIX
// needs the linked file to be directly executable — that relies on a shebang. That's
// npm's own contract, distinct from how hooks.json/somi-loop/somi-findings are invoked.
// See phases/01-state-scripts-port.md's Iteration 1.3 implementation note. (The
// executable bit itself is left to Phase 3 iteration 3.2, which owns the bin repoint
// and the live-wiring smoke test — this iteration only adds the file content needed.)
//
// Checks (each maps to a hook-layer guarantee):
//   1. Staged secret-bearing files      (block-secret-writes' basename patterns)
//   2. Staged lockfile hand-edits        (guard-protected-paths' lockfile gate;
//      honors .somi/config.json lockfiles.allow_edit and SOMI_ALLOW_LOCKFILES)
//   3. TODO(claude)/FIXME(claude) markers staged for commit (the loose-end nudge)
//   4. Scratch/backup files staged       (.bak/.orig/scratch_ — the same nudge)
//
// Usage:
//   node scripts/somi-check.mjs [--staged|--all]   (default: --staged; --all scans the
//                                                   full working tree vs HEAD)
// Exit codes: 0 clean · 1 findings (fail the commit / CI step) · 64 error.
//
// Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PROG = 'somi-check';

// Thrown to unwind to the top-level handler, which sets process.exitCode and lets Node
// exit naturally — avoids process.exit()'s risk of truncating buffered stdout/stderr
// writes on a pipe. Same idiom as somi-loop.mjs / somi-findings.mjs (1.1/1.2,
// reviewer-blessed).
class ExitSignal extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function die(msg) {
  process.stderr.write(`${PROG}: ${msg}\n`);
  throw new ExitSignal(64);
}

function requireGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    die('requires git');
  }
}

function projectRoot() {
  let b = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (b.includes('${')) b = process.cwd();
  return b;
}

// Mirrors block-secret-writes.sh's basename patterns (keep in sync when extending).
// Bash matches these as POSIX ERE via `[[ "$base" =~ $p ]]` — every pattern here uses
// only `^`/`$`/`.`/`*`/`?` and escaped literal dots, which are byte-identical in ERE
// and JS regex syntax (no `[[:class:]]` bracket expressions, no ERE-vs-PCRE anchor
// divergence to worry about). CAVEAT, do not inherit blindly in 2.9: JS `.` refuses to
// match \r/U+2028/U+2029 where POSIX `.` matches every byte except \n — harmless HERE
// only because git's core.quotePath C-escapes non-ASCII filenames before either
// implementation sees them; on raw CONTENT (see the TODO-marker check below, and all of
// block-dangerous-bash.sh's command-string patterns) that difference is live.
const SECRET_PATTERNS = [
  /^\.env$/, /^\.env\.local$/, /^\.env\.production$/, /^\.env\.prod$/, /^\.env\.staging$/, /^\.env\.secret$/,
  /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/, /\.jks$/,
  /^id_rsa$/, /^id_ed25519$/, /^id_ecdsa$/, /^id_dsa$/,
  /-key\.json$/, /-credentials\.json$/, /service-account.*\.json$/,
  /\.netrc$/, /\.pgpass$/, /\.kdbx$/, /secrets?\.ya?ml$/, /secrets?\.json$/,
];
const EXAMPLE_BASENAMES = ['.env.example', '.env.sample', '.env.template', '.env.dist'];

const LOCKFILES = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'Gemfile.lock',
  'poetry.lock', 'uv.lock', 'composer.lock', 'go.sum',
];

function readConfig(root) {
  const cfgPath = path.join(root, '.somi', 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return {};
  }
}

// lockfiles_allowed() — env wins (including "0"); then committed config; default deny.
// The config half is this script's ONE jq use (`jq -r '.lockfiles.allow_edit // empty'
// == "true"`), preserved exactly rather than approximated with a JS-typed `=== true`
// check. jq's `//` alternative only substitutes for null/false (NOT other falsy values),
// and `-r` prints strings raw / other scalars as their JSON text — so a config author
// who writes `"allow_edit": "true"` (a JSON STRING, not a boolean) gets the exact same
// jq -r output ("true") as `"allow_edit": true` (the boolean) and is ALSO treated as
// allowed by bash. A naive `config.lockfiles.allow_edit === true` in JS would silently
// diverge on that string-vs-boolean case (deny where bash allows) — reproduced the
// text-comparison semantics instead so both forms match bash byte-for-byte.
function lockfilesAllowed(root) {
  const env = process.env.SOMI_ALLOW_LOCKFILES;
  if (env !== undefined && env !== '') {
    return env === '1';
  }
  const config = readConfig(root);
  const v = config?.lockfiles?.allow_edit;
  if (v === null || v === undefined || v === false) return false; // jq's `// empty`
  const raw = typeof v === 'string' ? v : JSON.stringify(v);
  return raw === 'true';
}

function changedFiles(root, mode) {
  if (mode === 'staged') {
    const out = execFileSync(
      'git',
      ['-C', root, 'diff', '--cached', '--name-only', '--diff-filter=ACM'],
      { encoding: 'utf8' },
    );
    return out.split('\n').filter((s) => s !== '');
  }
  const out1 = execFileSync(
    'git',
    ['-C', root, 'diff', 'HEAD', '--name-only', '--diff-filter=ACM'],
    { encoding: 'utf8' },
  );
  const out2 = execFileSync(
    'git',
    ['-C', root, 'ls-files', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  );
  return [...out1.split('\n'), ...out2.split('\n')].filter((s) => s !== '');
}

function changedContent(root, mode) { // additions only
  const args = mode === 'staged'
    ? ['-C', root, 'diff', '--cached', '--no-color', '--unified=0']
    : ['-C', root, 'diff', 'HEAD', '--no-color', '--unified=0'];
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  requireGit();

  const argv = process.argv.slice(2);
  const arg = argv[0];
  let mode = 'staged';
  if (arg === '--all') mode = 'all';
  else if (arg === '--staged' || arg === undefined || arg === '') mode = 'staged';
  else die(`unknown argument: ${arg}`);

  const root = projectRoot();
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
  } catch {
    die(`not a git repository: ${root}`);
  }

  let findings = 0;
  function report(msg) {
    process.stderr.write(`${PROG}: ${msg}\n`);
    findings += 1;
  }

  // Computed once and reused below (bash re-invokes `changed_files()` — a fresh `git`
  // process per call — inside its per-lockfile manifest check too; nothing about the
  // repo's staged/working state changes mid-run, so caching here is behavior-identical,
  // just fewer subprocess spawns).
  const files = changedFiles(root, mode);
  const allowLockfiles = lockfilesAllowed(root);

  for (const f of files) {
    const base = path.basename(f);

    if (!EXAMPLE_BASENAMES.includes(base)) {
      if (SECRET_PATTERNS.some((p) => p.test(base))) {
        report(`secret-bearing file in the change set: ${f} (commit only .env.example-style templates)`);
      }
    }

    if (!allowLockfiles && LOCKFILES.includes(base)) {
      // Hand-edit heuristic: a lockfile changing without its manifest alongside.
      const dir = path.dirname(f);
      const prefix = dir === '.' ? '' : `${dir}/`;
      // NOTE: `prefix` is interpolated into the RegExp source unescaped, exactly like
      // bash's `grep -qE "^${prefix}(package\.json|...)$"` interpolates it into the ERE
      // unescaped. A directory name containing regex metacharacters (e.g. a real dir
      // named "a.b" or "a+b") would be mis-treated identically by both implementations
      // — a shared, pre-existing quirk in the bash original, preserved here for parity
      // rather than silently fixed.
      const manifestPattern = new RegExp(`^${prefix}(package\\.json|Cargo\\.toml|Gemfile|pyproject\\.toml|composer\\.json|go\\.mod)$`);
      if (!files.some((cf) => manifestPattern.test(cf))) {
        report(`lockfile changed without its manifest: ${f} (regenerate via the package manager, or set lockfiles.allow_edit in .somi/config.json)`);
      }
    }

    if (base.endsWith('.bak') || base.endsWith('.orig') || base.startsWith('scratch_')) {
      report(`scratch/backup file in the change set: ${f}`);
    }
  }

  // 3 — added TODO(claude)/FIXME(claude) markers. grep splits lines on \n ONLY and its
  // `.` matches every byte except \n — JS differs on both counts: `m`-flag `^` also
  // anchors after \r/U+2028/U+2029, and `.` refuses to match those same terminators, so
  // a marker preceded by a Unicode line separator on the same git diff line would be
  // silently missed (under-matching — the wrong direction for a guard). Split on \n and
  // use [^\n] to reproduce grep's byte semantics exactly.
  const content = changedContent(root, mode);
  const todoRe = /^\+[^\n]*(TODO\(claude\)|TODO\(agent\)|FIXME\(claude\))/;
  if (content.split('\n').some((line) => todoRe.test(line))) {
    report('TODO(claude)/FIXME(claude) markers added — resolve them or convert to owned follow-ups before committing');
  }

  if (findings > 0) {
    process.stderr.write(`${PROG}: ${findings} finding(s) — see above.\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`${PROG}: clean.`);
}

try {
  main();
} catch (e) {
  if (e instanceof ExitSignal) {
    process.exitCode = e.code;
  } else {
    throw e;
  }
}
