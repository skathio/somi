// somi-findings.mjs — the findings ledger: identity and lifecycle for review findings.
//
// Node port of scripts/somi-findings.sh (node-runtime-port, phase 1, iteration 1.2).
// Zero-dependency: stdlib only (node:fs, node:path). No jq, no bash. Behavior-preserving
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
import path from 'node:path';

const PROG = 'somi-findings';

// Thrown to unwind to the top-level handler, which sets process.exitCode and lets Node
// exit naturally — avoids process.exit()'s risk of truncating buffered stdout/stderr
// writes on a pipe. Same idiom as somi-loop.mjs (1.1, reviewer-blessed).
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

function nowDateUtc() {
  // `date -u +%Y-%m-%d` — bare date, no time component (findings' seen[].date).
  return new Date().toISOString().slice(0, 10);
}

// Mirrors jq's `//` alternative operator at the JSON-value level: substitutes the
// fallback only when the left side is `null`/missing or `false` — NOT for other
// falsy values like `""` or `0`, which jq treats as present. Used wherever the bash
// script keeps a raw JSON value (locus/severity/confidence on a newly created finding).
function orElse(v, fallback) {
  return v === null || v === undefined || v === false ? fallback : v;
}

// Mirrors `jq -r '<expr> // empty'` captured into a bash variable: same null/false
// substitution as orElse, then stringified (bash captures everything as text) — used
// wherever the bash script tests `[[ -n "$var" ]]` or concatenates into the locus key.
function rawStr(v) {
  const x = orElse(v, '');
  return x === '' ? '' : String(x);
}

// normalize_title() — bash pipeline: `tr '[:upper:]' '[:lower:]'` (byte-wise, ASCII-only —
// it only maps the 26 ASCII uppercase bytes; any multi-byte UTF-8 sequence passes through
// untouched) -> `tr -cs 'a-z0-9' ' '` (every maximal run of non-alphanumerics — including a
// leading or trailing run — collapses to ONE space; this is what then eats those untouched
// UTF-8 bytes) -> awk takes fields 1-8 (awk's default field-splitting ignores leading/
// trailing whitespace and splits on whitespace runs). By the time the tr step is done,
// the only characters left in the string are lowercase alphanumerics and single-space
// separators (with at most one leading and one trailing space) — so the awk step's only
// remaining job is to drop that leading/trailing space and truncate to 8 fields, which
// is exactly what trim + split + slice does below — PROVIDED the lowercasing step is also
// byte-wise ASCII-only. JS's `String.prototype.toLowerCase()` is Unicode-aware (e.g. U+0130
// İ -> "i" + combining dot above), which can *introduce* a fresh ASCII letter that bash's
// byte-wise `tr` would never produce (bash leaves İ's UTF-8 bytes alone; the following
// `tr -cs 'a-z0-9' ' '` step then discards all of them as non-alphanumeric). So the
// lowercasing below only maps `A`-`Z`, mirroring `tr '[:upper:]' '[:lower:]'` exactly.
// Verified against all six of Phase 0.6's normalize_title edge-case goldens (empty,
// single-word, >8-word, leading/trailing whitespace, multi-space, punctuation) plus
// adversarial Unicode probes (café, İstanbul) — see diary for the case-by-case trace.
function normalizeTitle(title) {
  const lowered = title.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const squeezed = lowered.replace(/[^a-z0-9]+/g, ' ').trim();
  if (squeezed === '') return '';
  return squeezed.split(/\s+/).slice(0, 8).join(' ');
}

function ensureLedger(ledgerDir, ledgerPath) {
  fs.mkdirSync(ledgerDir, { recursive: true });
  if (!fs.existsSync(ledgerPath)) {
    // Byte-for-byte the bash seed: `printf '{"next_id": 1, "findings": []}\n' > "$LEDGER"` —
    // a literal, NOT jq output (note the space after each colon but no other jq-pretty
    // formatting). Immediately superseded by the jq-pretty form on the first record/resolve/
    // reopen that touches this ledger; only matters at rest if `open`/`get` is called first.
    fs.writeFileSync(ledgerPath, '{"next_id": 1, "findings": []}\n');
  }
}

function loadLedger(ledgerPath) {
  return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
}

function saveLedger(ledgerPath, ledger) {
  // Mirror bash's `tmp="$(mktemp)"; jq ... "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"`:
  // pretty 2-space + trailing newline (jq's default pretty-print, verified byte-identical
  // against JSON.stringify(ledger, null, 2) + '\n' — see diary), written to a temp file in
  // the SAME directory as the target and renamed into place so the write is atomic and the
  // rename never crosses a filesystem boundary.
  const tmpPath = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(ledger, null, 2) + '\n');
  fs.renameSync(tmpPath, ledgerPath);
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
  const LEDGER_DIR = path.join(root, '.somi', 'reviews', SLUG);
  const LEDGER = path.join(LEDGER_DIR, 'findings.json');

  switch (CMD) {
    case 'record': {
      ensureLedger(LEDGER_DIR, LEDGER);

      const stdinText = fs.readFileSync(0, 'utf8');
      let input;
      try {
        input = JSON.parse(stdinText);
      } catch {
        die('stdin must be a JSON array of findings');
      }
      if (!Array.isArray(input)) die('stdin must be a JSON array of findings');

      const ledger = loadLedger(LEDGER);
      const now = nowDateUtc();
      let breaker = false;

      for (let i = 0; i < input.length; i++) {
        const f = input[i] ?? {};
        const file = rawStr(f.file);
        // ASCII-only lowercase — same reasoning as normalizeTitle above: bash uses byte-wise
        // `tr '[:upper:]' '[:lower:]'` here too, so Unicode-aware toLowerCase would diverge.
        const symbol = rawStr(f.symbol).replace(/[A-Z]/g, (c) => c.toLowerCase());
        const title = rawStr(f.title);
        if (!file || !title) die(`finding ${i} needs at least {file, title}`);
        const key = `${file}|${symbol}|${normalizeTitle(title)}`;

        // Known open locus: recurrence classification BEFORE the sighting is appended.
        const existing = ledger.findings.find((x) => x.key === key && x.status === 'open');

        if (existing) {
          const recurringConsecutive = existing.seen.some((s) => s.run === RUN && s.pass === PASS - 1);
          const recurringCross = existing.seen.some((s) => s.run !== RUN);
          existing.seen.push({ review: REVIEW, run: RUN, pass: PASS, date: now });
          saveLedger(LEDGER, ledger);
          if (recurringConsecutive) breaker = true;
          console.log(JSON.stringify({
            id: existing.id,
            state: 'known',
            recurring_consecutive: recurringConsecutive,
            recurring_cross_run: recurringCross,
          }));
        } else {
          const newId = `F-${ledger.next_id}`;
          ledger.next_id += 1;
          ledger.findings.push({
            id: newId,
            key,
            locus: { file: f.file, symbol: orElse(f.symbol, '') },
            title: f.title,
            severity: orElse(f.severity, 'Minor'),
            confidence: orElse(f.confidence, 'Medium'),
            status: 'open',
            introduced_by: REVIEW,
            resolved_by: null,
            seen: [{ review: REVIEW, run: RUN, pass: PASS, date: now }],
          });
          saveLedger(LEDGER, ledger);
          console.log(JSON.stringify({
            id: newId,
            state: 'new',
            recurring_consecutive: false,
            recurring_cross_run: false,
          }));
        }
      }

      if (breaker) process.exitCode = 5;
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
