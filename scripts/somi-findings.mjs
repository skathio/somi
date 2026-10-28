// somi-findings.mjs — the findings ledger: identity and lifecycle for review findings.
//
// Zero-dependency: stdlib only. The ledger IO and `record` live in lib/findings-ledger.mjs; stdin is
// read and parsed here, at the trust boundary. No jq, no bash. Behavior-preserving
// — exit codes and stdout JSON shapes are frozen and reproduced exactly; see the bash
// original's header comment for the full rationale (finding identity/lifecycle, the
// consecutive-vs-cross-run recurrence distinction, why line numbers are excluded from
// the locus).
//
// Ledger: .somi/reviews/<slug>/findings.json under the project root — committed with
// the other review artifacts (it is the machine view; the markdown review file stays
// the human view).
//
// Subcommands:
//   record  --slug S [--review FILE] [--run ID] [--pass N]
//           stdin: JSON array [{file, symbol, title, severity, confidence}, …]
//           Upserts each finding: new locus → new F-<n>; known OPEN locus → appends a
//           sighting. Prints one JSON line per finding with {id, state, recurring_consecutive,
//           recurring_cross_run}. Exit 5 if ANY finding was recurring_consecutive (checked
//           after processing ALL findings) — the caller decides what to do with it.
//   resolve --slug S --id F-3 --status fixed|accepted|wontfix [--by REVIEW]
//   reopen  --slug S --id F-3 [--by REVIEW]
//   open    --slug S            → JSON array of open findings
//   get     --slug S --id F-3   → one finding
//
// Locus matching: same file + same symbol (case-insensitive) + same normalized title
// (lowercased, non-alphanumerics collapsed, first 8 words). Line numbers are
// deliberately NOT part of the locus — lines drift between passes.
//
// Exit codes: 0 ok · 5 consecutive recurrence detected (record only) · 64 error.
// Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

import fs from 'node:fs';
import { PROG, ensureLedger, ledgerPaths, loadLedger, recordFindings, saveLedger } from './lib/findings-ledger.mjs';

// Thrown to unwind to the top-level handler, which sets process.exitCode and lets Node
// exit naturally — avoids process.exit()'s risk of truncating buffered stdout/stderr
// writes on a pipe. Same idiom as somi-loop.mjs.
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

function main() {
  const argv = process.argv.slice(2);
  const CMD = argv[0] || '';
  let rest = argv.slice(1);

  let SLUG = '';
  let REVIEW = '';
  let RUN = '';
  let PASS = 0;
  let ID = '';
  let STATUS = '';
  let BY = '';

  while (rest.length > 0) {
    const a = rest[0];
    switch (a) {
      case '--slug': SLUG = rest[1]; rest = rest.slice(2); break;
      case '--review': REVIEW = rest[1]; rest = rest.slice(2); break;
      case '--run': RUN = rest[1]; rest = rest.slice(2); break;
      case '--pass': PASS = Number(rest[1]); rest = rest.slice(2); break;
      case '--id': ID = rest[1]; rest = rest.slice(2); break;
      case '--status': STATUS = rest[1]; rest = rest.slice(2); break;
      case '--by': BY = rest[1]; rest = rest.slice(2); break;
      default: die(`unknown argument: ${a}`);
    }
  }

  if (!CMD) die('usage: somi-findings.mjs <record|resolve|reopen|open|get> --slug <slug> …');
  if (!SLUG) die('--slug is required');

  const root = projectRoot();
  const { dir: LEDGER_DIR, file: LEDGER } = ledgerPaths(root, SLUG);

  switch (CMD) {
    case 'record': {
      let stdinText;
      try {
        stdinText = fs.readFileSync(0, 'utf8');
      } catch {
        // Any OS-level read failure — e.g. Windows raises EAGAIN for a synchronous read of
        // a TTY console handle (no piped input attached) rather than blocking, the POSIX
        // behavior — should degrade to the same clean die() exit every other bad-input path
        // here uses, not an uncaught exception.
        die('failed to read stdin — findings must be piped in as a JSON array');
      }
      let input;
      try {
        input = JSON.parse(stdinText);
      } catch {
        die('stdin must be a JSON array of findings');
      }
      if (!Array.isArray(input)) die('stdin must be a JSON array of findings');

      const result = recordFindings({ root, slug: SLUG, review: REVIEW, run: RUN, pass: PASS, input });
      for (const line of result.lines) console.log(line);
      if (result.message) process.stderr.write(`${result.message}\n`);
      process.exitCode = result.code;
      break;
    }

    case 'resolve': {
      ensureLedger(LEDGER_DIR, LEDGER);
      if (!ID || !STATUS) die('resolve requires --id and --status');
      if (!['fixed', 'accepted', 'wontfix'].includes(STATUS)) {
        die('--status must be fixed|accepted|wontfix');
      }
      const ledger = loadLedger(LEDGER);
      const found = ledger.findings.find((x) => x.id === ID);
      if (found) {
        found.status = STATUS;
        found.resolved_by = BY;
        saveLedger(LEDGER, ledger);
        console.log(JSON.stringify({ id: found.id, status: found.status, resolved_by: found.resolved_by }));
      }
      break;
    }

    case 'reopen': {
      ensureLedger(LEDGER_DIR, LEDGER);
      if (!ID) die('reopen requires --id');
      const ledger = loadLedger(LEDGER);
      const found = ledger.findings.find((x) => x.id === ID);
      if (found) {
        found.status = 'open';
        found.resolved_by = null;
        found.reopened_by = BY;
        saveLedger(LEDGER, ledger);
        console.log(JSON.stringify({ id: found.id, status: found.status }));
      }
      break;
    }

    case 'open': {
      ensureLedger(LEDGER_DIR, LEDGER);
      const ledger = loadLedger(LEDGER);
      const openFindings = ledger.findings
        .filter((x) => x.status === 'open')
        .map((x) => ({
          id: x.id,
          locus: x.locus,
          title: x.title,
          severity: x.severity,
          confidence: x.confidence,
          introduced_by: x.introduced_by,
        }));
      console.log(JSON.stringify(openFindings, null, 2));
      break;
    }

    case 'get': {
      ensureLedger(LEDGER_DIR, LEDGER);
      if (!ID) die('get requires --id');
      const ledger = loadLedger(LEDGER);
      const found = ledger.findings.find((x) => x.id === ID);
      if (found) console.log(JSON.stringify(found, null, 2));
      break;
    }

    default:
      die(`unknown subcommand: ${CMD}`);
  }
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
