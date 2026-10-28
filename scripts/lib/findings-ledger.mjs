// findings-ledger.mjs -- the findings ledger: identity, the ledger file and every handler (record, resolve,
// reopen, open, get). Each returns `{lines, code, message}`. Nothing here
// reads the process environment, stdin or argv, and nothing prints: the caller (somi-findings.mjs today, a tool
// later) hands in the project root and already-parsed arguments, and gets back the lines to print, an exit code
// and the stderr text. The stdin read and the JSON parse stay at the CLI, the trust boundary of the shell path.
//
// Ledger: .somi/reviews/<slug>/findings.json under the root. Locus matching: same file + same symbol
// (case-insensitive) + same normalized title (lowercased, non-alphanumerics collapsed, first 8 words); line
// numbers are deliberately NOT part of the locus, lines drift between passes. Exit codes: 0 ok, 5 consecutive
// recurrence detected, 64 bad input.

import fs from 'node:fs';
import path from 'node:path';

export const PROG = 'somi-findings';

export function ledgerPaths(root, slug) {
  const dir = path.join(root, '.somi', 'reviews', slug);
  return { dir, file: path.join(dir, 'findings.json') };
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
// Verified against six normalize_title edge-case goldens (empty,
// single-word, >8-word, leading/trailing whitespace, multi-space, punctuation) plus
// adversarial Unicode probes (café, İstanbul).
export function normalizeTitle(title) {
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
  // against JSON.stringify(ledger, null, 2) + '\n'), written to a temp file in
  // the SAME directory as the target and renamed into place so the write is atomic and the
  // rename never crosses a filesystem boundary.
  const tmpPath = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(ledger, null, 2) + '\n');
  fs.renameSync(tmpPath, ledgerPath);
}

// A finding is recordable when it names a file and a title.
function firstUnrecordable(input) {
  return input.findIndex((f) => !rawStr(f?.file) || !rawStr(f?.title));
}

// Upserts each finding of `input` (an already-parsed array) into the ledger: a new locus becomes F-<n>, a known
// OPEN locus gets a sighting appended. `lines` is one JSON line per finding; `code` is 5 if ANY finding recurred
// in consecutive passes (judged after all are processed). Every element is validated before the ledger is
// touched: a malformed one returns 64 and writes nothing, not even the empty ledger.
export function recordFindings({ root, slug, review, run, pass, input, now = nowDateUtc }) {
  const bad = firstUnrecordable(input);
  if (bad !== -1) return { lines: [], code: 64, message: `${PROG}: finding ${bad} needs at least {file, title}` };

  const { dir, file } = ledgerPaths(root, slug);
  ensureLedger(dir, file);
  const ledger = loadLedger(file);
  const date = now();
  const lines = [];
  let breaker = false;

  for (const f of input.map((x) => x ?? {})) {
    // ASCII-only lowercase, same reasoning as normalizeTitle: bash uses byte-wise `tr '[:upper:]' '[:lower:]'`.
    const symbol = rawStr(f.symbol).replace(/[A-Z]/g, (c) => c.toLowerCase());
    const key = `${rawStr(f.file)}|${symbol}|${normalizeTitle(rawStr(f.title))}`;
    const sighting = { review, run, pass, date };

    // Known open locus: recurrence is classified BEFORE the sighting is appended.
    const existing = ledger.findings.find((x) => x.key === key && x.status === 'open');
    if (existing) {
      const recurringConsecutive = existing.seen.some((s) => s.run === run && s.pass === pass - 1);
      const recurringCross = existing.seen.some((s) => s.run !== run);
      existing.seen.push(sighting);
      if (recurringConsecutive) breaker = true;
      lines.push(JSON.stringify({ id: existing.id, state: 'known', recurring_consecutive: recurringConsecutive, recurring_cross_run: recurringCross }));
    } else {
      const id = `F-${ledger.next_id}`;
      ledger.next_id += 1;
      ledger.findings.push({
        id,
        key,
        locus: { file: f.file, symbol: orElse(f.symbol, '') },
        title: f.title,
        severity: orElse(f.severity, 'Minor'),
        confidence: orElse(f.confidence, 'Medium'),
        status: 'open',
        introduced_by: review,
        resolved_by: null,
        seen: [sighting],
      });
      lines.push(JSON.stringify({ id, state: 'new', recurring_consecutive: false, recurring_cross_run: false }));
    }
  }

  // An empty batch changes nothing: leave the file as it is, seed literal included.
  if (input.length > 0) saveLedger(file, ledger);
  return { lines, code: breaker ? 5 : 0, message: '' };
}

const STATUSES = ['fixed', 'accepted', 'wontfix'];
const refuse = (msg) => ({ lines: [], code: 64, message: `${PROG}: ${msg}` });
const ok = (lines = []) => ({ lines, code: 0, message: '' });

// Seeds the ledger on first touch and returns its path. Every lifecycle handler does this before it validates its
// arguments, so a refused call still leaves the seed behind, as the bash original did.
function touchLedger(root, slug) {
  const { dir, file } = ledgerPaths(root, slug);
  ensureLedger(dir, file);
  return file;
}

// An unknown id is not an error: nothing is changed and nothing is printed.
export function resolveFinding({ root, slug, id, status, by }) {
  const file = touchLedger(root, slug);
  if (!id || !status) return refuse('resolve requires --id and --status');
  if (!STATUSES.includes(status)) return refuse('--status must be fixed|accepted|wontfix');
  const ledger = loadLedger(file);
  const found = ledger.findings.find((x) => x.id === id);
  if (!found) return ok();
  found.status = status;
  found.resolved_by = by;
  saveLedger(file, ledger);
  return ok([JSON.stringify({ id: found.id, status: found.status, resolved_by: found.resolved_by })]);
}

export function reopenFinding({ root, slug, id, by }) {
  const file = touchLedger(root, slug);
  if (!id) return refuse('reopen requires --id');
  const ledger = loadLedger(file);
  const found = ledger.findings.find((x) => x.id === id);
  if (!found) return ok();
  found.status = 'open';
  found.resolved_by = null;
  found.reopened_by = by;
  saveLedger(file, ledger);
  return ok([JSON.stringify({ id: found.id, status: found.status })]);
}

// The open findings only, trimmed to the fields a reader needs, as one pretty-printed JSON array.
export function openFindings({ root, slug }) {
  const ledger = loadLedger(touchLedger(root, slug));
  const open = ledger.findings
    .filter((x) => x.status === 'open')
    .map((x) => ({ id: x.id, locus: x.locus, title: x.title, severity: x.severity, confidence: x.confidence, introduced_by: x.introduced_by }));
  return ok([JSON.stringify(open, null, 2)]);
}

export function getFinding({ root, slug, id }) {
  const file = touchLedger(root, slug);
  if (!id) return refuse('get requires --id');
  const found = loadLedger(file).findings.find((x) => x.id === id);
  return ok(found ? [JSON.stringify(found, null, 2)] : []);
}
