// somi-findings.mjs — the findings ledger: identity and lifecycle for review findings.
//
// Zero-dependency: stdlib only. A thin CLI: it parses arguments, reads the project root, and reads and parses
// stdin (the trust boundary of the shell path); every handler lives in lib/findings-ledger.mjs and returns
// {lines, code, message}, which is printed here. Exit codes and stdout JSON shapes are frozen; see the bash
// original's header comment for the rationale (finding identity/lifecycle, consecutive-vs-cross-run
// recurrence, why line numbers are excluded from the locus).
//
// Ledger: .somi/reviews/<slug>/findings.json under the project root, committed with the other review artifacts.
// Subcommands (all take --slug S):
//   record  [--review FILE] [--run ID] [--pass N]  stdin: JSON array [{file, symbol, title, severity, confidence}, …]
//           Upserts each finding (new locus → new F-<n>; known OPEN locus → appends a sighting); one JSON line per
//           finding. Exit 5 if ANY finding recurred in consecutive passes, judged after all are processed.
//   resolve --id F-3 --status fixed|accepted|wontfix [--by REVIEW]
//   reopen  --id F-3 [--by REVIEW]
//   open    → JSON array of open findings        get --id F-3 → one finding
// Exit codes: 0 ok · 5 consecutive recurrence detected (record only) · 64 error.
// Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

import fs from 'node:fs';
import { PROG, getFinding, openFindings, recordFindings, reopenFinding, resolveFinding } from './lib/findings-ledger.mjs';

const FLAGS = { '--slug': 'slug', '--review': 'review', '--run': 'run', '--pass': 'pass', '--id': 'id', '--status': 'status', '--by': 'by' };

// Thrown to unwind to the top-level handler, which sets process.exitCode and lets Node exit naturally —
// avoids process.exit()'s risk of truncating buffered stdout/stderr writes on a pipe.
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

function projectRoot() {
  let b = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (b.includes('${')) b = process.cwd();
  return b;
}

function readFindingsFromStdin() {
  let text;
  try {
    text = fs.readFileSync(0, 'utf8');
  } catch {
    // Any OS-level read failure — e.g. Windows raises EAGAIN for a synchronous read of a TTY console handle
    // (no piped input attached) rather than blocking — degrades to the same clean die() as every bad input.
    die('failed to read stdin — findings must be piped in as a JSON array');
  }
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    die('stdin must be a JSON array of findings');
  }
  if (!Array.isArray(input)) die('stdin must be a JSON array of findings');
  return input;
}

function main() {
  const [cmd = '', ...argv] = process.argv.slice(2);
  const a = { slug: '', review: '', run: '', pass: 0, id: '', status: '', by: '' };
  for (let rest = argv; rest.length > 0; rest = rest.slice(2)) {
    if (!Object.hasOwn(FLAGS, rest[0])) die(`unknown argument: ${rest[0]}`);
    const key = FLAGS[rest[0]];
    a[key] = key === 'pass' ? Number(rest[1]) : rest[1];
  }

  if (!cmd) die('usage: somi-findings.mjs <record|resolve|reopen|open|get> --slug <slug> …');
  if (!a.slug) die('--slug is required');

  const call = { root: projectRoot(), ...a };
  const handlers = {
    record: () => recordFindings({ ...call, input: readFindingsFromStdin() }),
    resolve: () => resolveFinding(call),
    reopen: () => reopenFinding(call),
    open: () => openFindings(call),
    get: () => getFinding(call),
  };
  if (!Object.hasOwn(handlers, cmd)) die(`unknown subcommand: ${cmd}`);

  const result = handlers[cmd]();
  for (const line of result.lines) console.log(line);
  if (result.message) process.stderr.write(`${result.message}\n`);
  process.exitCode = result.code;
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
