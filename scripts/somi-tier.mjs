#!/usr/bin/env node
// somi-tier.mjs — CLI over scripts/lib/size-tier.mjs's decideTier(): how much pipeline does this
// request deserve, and what was decided?
//
//   resolve --signals <file|-> [--override small|full] [--record <slug> [--project-dir <dir>]]
//       Reads signals JSON (a file path, or - for stdin; at most 64 KiB; a path must be a regular
//       file, never a symlink or FIFO), calls decideTier, applies the optional override, prints one
//       JSON line: { tier, effective, source, floor, security_lens, failed, unknown, invalid, reasons, basis }.
//       security_lens is true unless the request is proven free of untrusted input and of auth, crypto,
//       secrets and PII; /code-loop then reviews with the security lens at any tier.
//       When the input holds keys that are not signal ids, the line also carries `unrecognized` (at
//       most 8 of those names, each cut to 40 characters and ASCII-escaped; values are never
//       echoed) and `expected` (the exact signal ids), so a caller can correct its input. Those two
//       fields appear only then; the decision itself is unchanged (a missing signal is read as its
//       worst case).
//         tier       what the function computed
//         effective  the tier to run: the computed one, or the override
//         source     'computed' | 'override' (flag) | 'env' (SOMI_SHIP_LOOP_TIER)
//       The override may only be small or full. The --override flag wins over the environment
//       variable; an empty variable counts as unset. Raising the tier is always allowed; lowering
//       it is refused when the result carries floor 'full'. Invalid signals are not an error here:
//       decideTier already read them as their worst case and lists them in `invalid`.
//
//       --record <slug> also writes <project>/.somi/somi-state/tier/<slug>.json from that same
//       result, so the recorded tier, source, floor and signals hash are the computed ones by
//       construction: { slug, tier (the effective one), source, computed_tier, floor, security_lens, reasons,
//       failed, basis, signals_sha256, attempt, prior, recorded_at }, and the stdout line gains
//       `recorded` (the path relative to the project). Every attempt that computed a tier, refusals
//       included, is first appended to tier/<slug>.attempts.jsonl (append-only, 0600, links never
//       followed); `attempt` is its number and `prior` the { computed_tier, signals_sha256 } of
//       the earlier ones. A re-record whose computed tier is lower than any earlier computed tier
//       is refused (65) unless --override is given. The basis is the whole one whenever the
//       effective tier is lower than the computed tier. The project is --project-dir or the
//       current directory.
//       signals_sha256 is the sha256 of the signal entries only (their value and evidence, in id
//       order, scalars only), so key order and extra keys do not change it. Directories it creates
//       are 0700, the file is 0600, written to a temp file and renamed; a link at .somi,
//       somi-state or tier is refused, and a link at the final path is replaced, not followed.
//       Residual, accepted: a same-user process that swaps a checked directory for a link between
//       the check and the write is not defended against.
//
//   approve --slug <slug> [--project-dir <dir>]
//       Stamps approved_at and brief_sha256 (of .somi/plans/<slug>/brief.md) into the slug's record.
//       Run once, after the human replies approve and brief.md is written. Refused (65) unless the
//       record is tier small with a signals hash and not yet approved; 64 when the record or the
//       brief cannot be read. `somi-loop.mjs init` accepts a brief-only item only with this stamp.
//
// Output (stdout and the state file) is pure ASCII: every non-ASCII character is \uXXXX-escaped.
// Error messages never echo input text raw: values are JSON-quoted and non-ASCII is escaped.
//
// Exit codes (callers branch on these — do not repurpose):
//   0   ok
//   64  usage, input or I/O error: bad flag or value, unreadable or oversize input, JSON parse
//       error, signals that are not an object, bad slug, unusable state directory, failed write
//   65  refused: a downward override below a security floor (names the floor on stderr), or a
//       re-record whose computed tier is lower than an earlier one without --override
// Nothing is printed to stdout on an error path. Zero-dependency: stdlib only.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decideTier, SIGNAL_IDS } from './lib/size-tier.mjs';
import { briefSha256, readRecord } from './lib/tier-record.mjs';

const PROG = 'somi-tier';
const USAGE = `usage: ${PROG}.mjs resolve --signals <file|-> [--override small|full] [--record <slug> [--project-dir <dir>]] | approve --slug <slug> [--project-dir <dir>]`;

const EXIT_USAGE = 64;
const EXIT_FLOOR = 65;

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_UNRECOGNIZED = 8;
const MAX_NAME_CHARS = 40;
const OVERRIDE_TARGETS = ['small', 'full'];
const TIERS = ['trivial', 'small', 'full'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_OVERRIDE = 'SOMI_SHIP_LOOP_TIER';
const STATE_DIRS = ['.somi', 'somi-state', 'tier'];
const MISSING = '\u0000missing';
const NON_SCALAR = '\u0000non-scalar';

class ExitSignal extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

// JSON with every non-ASCII character escaped, so neither stdout nor an error line can carry
// bidi, line-separator or C1 characters that a terminal would act on.
const ascii = (x, indent) => JSON.stringify(x, null, indent)
  .replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const quote = (x) => ascii(String(x));

function fail(code, msg) {
  process.stderr.write(`${PROG}: ${msg}\n`);
  throw new ExitSignal(code);
}

function die(msg) {
  fail(EXIT_USAGE, `${msg}\n${USAGE}`);
}

const rank = (t) => TIERS.indexOf(t);

// flags: { '--name': { oneOf?, pattern? } } -> { '--name': value }. A flag given twice, without a
// value, or with an empty or out-of-list value is a usage error.
function parseFlags(args, flags) {
  const out = Object.create(null);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!Object.hasOwn(flags, flag)) die(`unknown argument: ${quote(flag)}`);
    const spec = flags[flag];
    const value = args[i + 1];
    if (value === undefined || value === '') die(`${flag} requires a non-empty value`);
    if (flag in out) die(`${flag} given twice`);
    if (spec.oneOf && !spec.oneOf.includes(value)) die(`${flag} must be one of: ${spec.oneOf.join(', ')}`);
    if (spec.pattern && !spec.pattern.test(value)) die(`${flag} is not a valid ${flag.slice(2)}`);
    out[flag] = value;
  }
  return out;
}

// Reads at most MAX_INPUT_BYTES from a regular file (opened without following links or blocking
// on a FIFO) or stdin.
function readBounded(src) {
  let fd = 0;
  let opened = false;
  try {
    if (src !== '-') {
      fd = fs.openSync(src, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      opened = true;
      if (!fs.fstatSync(fd).isFile()) fail(EXIT_USAGE, `${quote(src)} is not a regular file`);
    }
    const buf = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let total = 0;
    while (total < buf.length) {
      let n;
      try {
        n = fs.readSync(fd, buf, total, buf.length - total, null);
      } catch (e) {
        if (e.code === 'EOF') break;
        if (e.code === 'EAGAIN') {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          continue;
        }
        throw e;
      }
      if (n === 0) break;
      total += n;
    }
    if (total > MAX_INPUT_BYTES) fail(EXIT_USAGE, `signals input exceeds ${MAX_INPUT_BYTES} bytes`);
    return buf.subarray(0, total);
  } catch (e) {
    if (e instanceof ExitSignal) throw e;
    return fail(EXIT_USAGE, `cannot read ${src === '-' ? 'stdin' : quote(src)}: ${e.code || 'error'}`);
  } finally {
    if (opened) fs.closeSync(fd);
  }
}

// -> the parsed signals object. Only JSON.parse output ever reaches decideTier.
function loadSignals(src) {
  const bytes = readBounded(src);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    // The engine's message quotes the offending input; only its position is safe to repeat.
    const at = /position (\d+)/.exec(String(e && e.message));
    return fail(EXIT_USAGE, `signals are not valid UTF-8 JSON${at ? ` (near position ${at[1]})` : ''}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(EXIT_USAGE, 'signals must be a JSON object');
  }
  return parsed;
}

const field = (o, k) => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : MISSING);
const scalar = (x) => (x === null || ['string', 'number', 'boolean'].includes(typeof x) ? x : NON_SCALAR);

// Hash of the signal entries only, scalars only: bounded work however deeply the input nests.
function signalsHash(signals) {
  const rows = SIGNAL_IDS.map((id) => {
    const entry = field(signals, id);
    return [id, scalar(field(entry, 'value')), scalar(field(entry, 'evidence'))];
  });
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function refuseBelowFloor(tier, floor, what, beforeFail) {
  if (floor && rank(tier) < rank(floor)) {
    beforeFail?.('refused_floor');
    fail(EXIT_FLOOR, `${what} to ${tier} is refused: the security floor is ${floor} (the request is not proven free of security-sensitive work)`);
  }
}

// Creates the state directories under the project root, refusing any link on the way, and returns
// the real path of the tier directory after proving it sits inside the real project root.
function stateDir(projectDir) {
  const root = fs.realpathSync(projectDir);
  let dir = root;
  for (const part of STATE_DIRS) {
    dir = path.join(dir, part);
    let st = null;
    try {
      st = fs.lstatSync(dir);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (!st) fs.mkdirSync(dir, { mode: 0o700 });
    else if (!st.isDirectory()) fail(EXIT_USAGE, `${path.relative(root, dir)} is not a real directory (links are not followed)`);
  }
  const real = fs.realpathSync(dir);
  if (real !== path.join(root, ...STATE_DIRS)) fail(EXIT_USAGE, 'state directory escapes the project root');
  return { root, real };
}

const MAX_ATTEMPTS = 50;
const MAX_LOG_BYTES = 256 * 1024;
const attemptsPath = (dirs, slug) => path.join(dirs.real, `${slug}.attempts.jsonl`);

// -> [{ computed_tier, signals_sha256 }] of every earlier attempt for the slug, oldest first.
// A log that cannot be read, is too large, or holds a malformed line fails closed.
function readAttempts(dirs, slug) {
  let fd;
  try {
    try {
      fd = fs.openSync(attemptsPath(dirs, slug), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_LOG_BYTES) fail(EXIT_USAGE, 'the attempts log is not a regular file or is too large');
    const rows = fs.readFileSync(fd, 'utf8').split('\n').filter(Boolean).map((line) => {
      let row;
      try { row = JSON.parse(line); } catch { row = null; }
      const ok = row !== null && typeof row === 'object' && TIERS.includes(row.computed_tier)
        && (row.signals_sha256 === null || /^[0-9a-f]{64}$/.test(row.signals_sha256));
      if (!ok) fail(EXIT_USAGE, 'the attempts log holds a malformed line');
      return { computed_tier: row.computed_tier, signals_sha256: row.signals_sha256 };
    });
    if (rows.length >= MAX_ATTEMPTS) fail(EXIT_USAGE, `the attempts log is full (${MAX_ATTEMPTS} attempts); ask the human before sizing this work again`);
    return rows;
  } catch (e) {
    if (e instanceof ExitSignal) throw e;
    return fail(EXIT_USAGE, `cannot read the attempts log: ${e.code || 'error'}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Appends one line (append-only, 0600, links never followed).
function appendAttempt(dirs, slug, row) {
  let fd;
  try {
    fd = fs.openSync(attemptsPath(dirs, slug), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    if (!fs.fstatSync(fd).isFile()) fail(EXIT_USAGE, 'the attempts log is not a regular file');
    const line = `${ascii(row)}\n`;
    if (fs.writeSync(fd, line) !== line.length) throw Object.assign(new Error('short write'), { code: 'ESHORT' });
  } catch (e) {
    if (e instanceof ExitSignal) throw e;
    fail(EXIT_USAGE, `cannot append to the attempts log: ${e.code || 'error'}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function openState(projectDir) {
  try {
    return stateDir(projectDir);
  } catch (e) {
    if (e instanceof ExitSignal) throw e;
    return fail(EXIT_USAGE, `cannot prepare the state directory: ${e.code || 'error'}`);
  }
}

// Writes the record atomically (temp file, then rename); returns its path relative to the project.
function writeRecord(dirs, slug, doc) {
  const body = `${ascii(doc, 2)}\n`;
  const final = path.join(dirs.real, `${slug}.json`);
  const tmp = path.join(dirs.real, `.${slug}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      if (fs.writeSync(fd, body) !== body.length) throw Object.assign(new Error('short write'), { code: 'ESHORT' });
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, final);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    return fail(EXIT_USAGE, `cannot write the tier record: ${e.code || 'error'}`);
  }
  return path.relative(dirs.root, final);
}

function resolve(args) {
  const f = parseFlags(args, {
    '--signals': {}, '--override': { oneOf: OVERRIDE_TARGETS }, '--record': { pattern: SLUG }, '--project-dir': {},
  });
  if (!f['--signals']) die('--signals is required');
  if (f['--project-dir'] && !f['--record']) die('--project-dir only applies with --record');
  let requested = f['--override'];
  let source = 'override';
  if (!requested && process.env[ENV_OVERRIDE]) {
    requested = process.env[ENV_OVERRIDE];
    source = 'env';
    if (!OVERRIDE_TARGETS.includes(requested)) die(`${ENV_OVERRIDE} must be one of: ${OVERRIDE_TARGETS.join(', ')}`);
  }
  const signals = loadSignals(f['--signals']);
  const r = decideTier(signals);
  const slug = f['--record'];
  // The attempts log is the memory of this slug: every attempt that computed a tier is appended,
  // refusals included, before the failure exit.
  const dirs = slug ? openState(f['--project-dir'] || process.cwd()) : null;
  const prior = slug ? readAttempts(dirs, slug) : [];
  const hash = slug ? signalsHash(signals) : null;
  const log = (outcome) => slug && appendAttempt(dirs, slug, {
    n: prior.length + 1, at: new Date().toISOString(), computed_tier: r.tier, requested: requested || null, outcome, signals_sha256: hash,
  });
  let effective = r.tier;
  if (requested) {
    refuseBelowFloor(requested, r.floor, `overriding ${r.tier}`, log);
    effective = requested;
  } else {
    source = 'computed';
  }
  // Re-extracting cannot talk the tier down: only a human reply (the flag) can.
  const highest = Math.max(-1, ...prior.map((a) => rank(a.computed_tier)));
  if (slug && !f['--override'] && rank(r.tier) < highest) {
    log('refused_lower');
    fail(EXIT_FLOOR, `computed tier ${r.tier} is lower than an earlier computed tier (${TIERS[highest]}) for this slug; re-extracting cannot lower the tier (a human reply with --override is required)`);
  }
  // An override that lowers the tier shows the whole basis, not only the security signal's.
  const shown = requested && rank(effective) < rank(r.tier) ? decideTier(signals, { fullBasis: true }) : r;
  const out = {
    tier: r.tier, effective, source, floor: r.floor, security_lens: r.securityLens, failed: r.failed, unknown: r.unknown,
    invalid: r.invalid, reasons: r.reasons, basis: shown.basis,
  };
  const strange = signals !== null && typeof signals === 'object' && !Array.isArray(signals) ? Object.keys(signals).filter((k) => !SIGNAL_IDS.includes(k)) : [];
  if (strange.length > 0) {
    out.unrecognized = strange.slice(0, MAX_UNRECOGNIZED).map((k) => k.slice(0, MAX_NAME_CHARS));
    out.expected = [...SIGNAL_IDS];
  }
  if (slug) {
    log('accepted');
    out.recorded = writeRecord(dirs, slug, {
      slug, tier: effective, source, computed_tier: r.tier, floor: r.floor, security_lens: r.securityLens,
      reasons: r.reasons, failed: r.failed, basis: shown.basis, signals_sha256: hash,
      attempt: prior.length + 1, prior, recorded_at: new Date().toISOString(),
    });
  }
  console.log(ascii(out));
}

// Stamps the approval into the record: run after the human's reply and after brief.md is written.
// Binds the approval to the brief as it is now; a later change to the brief voids it.
function approve(args) {
  const f = parseFlags(args, { '--slug': { pattern: SLUG }, '--project-dir': {} });
  if (!f['--slug']) die('--slug is required');
  const dirs = openState(f['--project-dir'] || process.cwd());
  const rec = readRecord(dirs.root, f['--slug']);
  if (!rec) fail(EXIT_USAGE, 'there is no readable tier record for this slug');
  if (rec.tier !== 'small') fail(EXIT_FLOOR, 'only a small tier record can be approved for a brief-only run');
  if (typeof rec.signals_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(rec.signals_sha256)) {
    fail(EXIT_FLOOR, 'the record has no signals hash; resolve with --record first');
  }
  if (rec.approved_at) fail(EXIT_FLOOR, 'the record is already approved; a new approval needs a new resolve --record');
  const brief = briefSha256(dirs.root, f['--slug']);
  if (!brief) fail(EXIT_USAGE, 'brief.md is missing, a link, or too large');
  const recorded = writeRecord(dirs, f['--slug'], { ...rec, approved_at: new Date().toISOString(), brief_sha256: brief });
  console.log(ascii({ approved: true, recorded, brief_sha256: brief }));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'resolve') resolve(rest);
  else if (cmd === 'approve') approve(rest);
  else die(cmd ? `unknown subcommand: ${quote(cmd)}` : 'a subcommand is required');
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
