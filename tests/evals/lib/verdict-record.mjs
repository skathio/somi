// Verdict record (FR-17), its canonical hash and the hash chain (FR-33, FR-38). Pure functions over
// explicit inputs; each returns `null` for a malformed input, never a throw. Every input is read ONCE
// into a plain copy and all decisions (and the hash) run on that copy, so a getter or Proxy that
// answers differently on a second read cannot change what was validated.
//
// Record (flat; EXACTLY these keys, nothing else is stored, so a secret-like extra field is refused):
//   schema_version 1; kind 'verdict' | 'aborted'; digest, instrument_digest: 64-hex; rule: one of RECORD_RULES;
//   tier_config, cli_version (text, see below); tasks [{id, hash}] and model_ids [string], both non-empty;
//   candidate / baseline: an arm {outcomes, cli, models, digest: 64-hex} (the shape triage reads) or null;
//   cost_candidate_usd / cost_baseline_usd: the two cost legs, finite numbers >= 0 (baseline 0 when
//   no baseline arm ran); baseline_digest: 64-hex | null; rerun_of / rerun_reason: both null or both
//   non-empty strings; prev_record_hash: 64-hex | null; record_hash: 64-hex.
//   A `verdict` carries triage_result (TRIAGE_RESULTS) and complete arms (9 draws, with 9 `cli` and 9
//   `models` entries); an `aborted` record carries candidate_result ('FAIL' | 'pass' | null) instead
//   and its arms may be null or partial (equal-length lists of 1 to 9). Its candidate_result must equal
//   what the candidate arm seen so far implies: 'FAIL' once 4 draws failed (even if the arm never
//   finished), 'pass' once failures plus undrawn draws stay below 4, else null (a null candidate arm is
//   null too). A null on a decided arm would be a free rerun, so it is refused (abortedRecord derives it).
//
// Hash. record_hash = sha256 over the UTF-8 bytes of canonicalJson(the validated record without
// `record_hash`). That covers every other field, including prev_record_hash, so none can be added,
// removed or edited without changing it. canonicalJson sorts keys, emits no whitespace, takes only
// plain data (finite numbers, no -0, strings, booleans, null, dense arrays, plain objects, depth <=
// MAX_DEPTH) and returns null for anything else, so two distinct values never share bytes.
//
// Chain. Record n's prev_record_hash is record n-1's record_hash; the first record's is null and its
// record_hash equals `genesisHash` when one is given; the last record's equals `headAnchor` when one
// is given. Named residual: without an anchor, deleting the TAIL passes, and an edited chain that is
// re-hashed from the edit onward passes. Only a head anchor kept outside the file closes that, and
// the chain does not defend against a maintainer who can rewrite both.
// A writer must store the object validateRecord/sealRecord return, not its own input.
//
// Text. Every string field is 1 to 512 UTF-16 code units and has none of: control, format (bidi
// overrides, zero-width), surrogate or private-use code points, U+2028 / U+2029, the
// blank-looking fillers (Hangul U+3164 U+115F U+1160 U+FFA0, Braille U+2800), and none may start or end
// with whitespace (any \s or \p{Z}) or be only whitespace; an interior space ("claude-code 2.1.207")
// is fine. Accepted residuals: variation selectors, the combining grapheme joiner, stacked combining
// marks, interior non-ASCII spaces, homoglyphs and unassigned code points. Unassigned ones are accepted
// on purpose: that category follows the running Node's Unicode tables, and a stored record must never
// validate on one runtime and fail on another (a rejected history record makes triage return null).
//
// Store. appendRecord appends one sealed line (JSON + LF) to a JSONL file. The store is SINGLE-WRITER:
// a second concurrent writer is not prevented, it shows up as a fork at the next verify, and the cut-back
// after a failed write assumes one writer (under O_APPEND another writer's line landing first would be
// cut back with ours). `create` means a NEW store only (O_CREAT|O_EXCL): an existing file is refused, a
// file this call created is unlinked on any refusal, and without `create` a missing or 0-byte store is
// refused, so a deleted or emptied store cannot restart as a new chain. Before writing it verifies the
// whole file and refuses (file unchanged) a broken chain, a failed genesis / head anchor, an unparsable
// or partial last line, a CR (LF-only), a non-regular file, one with several hard links, another owner
// or a group/world-writable mode (the last two skipped where there is no getuid, i.e. Windows), one
// over MAX_BYTES, a stale prev_record_hash, and a sealed line over MAX_LINE. The file is opened once,
// O_NOFOLLOW and O_NONBLOCK where the platform has them. A failed write is cut back to the verified
// size, so only refusals made before the write are guaranteed to leave the file untouched. Residuals:
// without O_NOFOLLOW (Windows) a symlink is followed; symlinked parent directories are followed
// everywhere; the file is read to EOF (the size cap is checked on fstat); the parent directory is not
// fsynced after a create; a new file is 0o600 (the umask can only narrow it); with no anchor a
// tail-cut chain is extended; the unlink of a refused new store acts on the path, so someone who can
// swap a path component could make it remove a file it did not create (a dev/ino check would narrow
// that window, not close it); an unlink that fails leaves an empty store that blocks both append and
// create until removed by hand; code points that are unassigned in an older Unicode but format
// characters in a newer one (e.g. U+0890, U+13439) are accepted on one runtime and refused on another.
// Runner contract: the first append uses `create` and no genesis and checks that the returned
// record_hash equals the committed value; every later append passes `genesisHash` and not `create`.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { ARM_OUTCOMES, ARM_SIZE, armVerdict } from './rules.mjs';
import { KINDS, TRIAGE_RESULTS } from './triage.mjs';

export const SCHEMA_VERSION = 1;
export const RECORD_RULES = Object.freeze(['pooled-9-4']); // a smoke result is never a verdict
const MAX_DEPTH = 16;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_LINE = 64 * 1024;
const MAX_TEXT = 512;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u2028\u2029\u3164\u115f\u1160\uffa0\u2800]/u;
const EDGE_SPACE = /^[\s\p{Z}]|[\s\p{Z}]$/u;
const HEX = /^[0-9a-f]{64}$/;
const COMMON = ['schema_version', 'kind', 'digest', 'rule', 'tasks', 'tier_config', 'instrument_digest', 'cli_version', 'model_ids', 'candidate', 'baseline', 'cost_candidate_usd', 'cost_baseline_usd', 'baseline_digest', 'rerun_of', 'rerun_reason', 'prev_record_hash', 'record_hash'];
const KIND_FIELD = { verdict: 'triage_result', aborted: 'candidate_result' };

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT && !UNSAFE.test(v) && !EDGE_SPACE.test(v);
const isTextOrNull = (v) => v === null || isText(v);
const isHash = (v) => typeof v === 'string' && HEX.test(v);
const isUsd = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && !Object.is(v, -0);
const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
const fail = (index, reason) => ({ ok: false, index, reason });
const given = (v) => v !== undefined && v !== null;

// Dense plain copy of an array (`length` and every slot read once), or null; a hole is refused.
function denseCopy(arr) {
  if (!Array.isArray(arr)) return null;
  const n = arr.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!Object.hasOwn(arr, i)) return null;
    out.push(arr[i]);
  }
  return out;
}

// Null-prototype snapshot of an object's own string-keyed properties, each read once (an inherited
// property or `__proto__` is never read as a field), or null.
function snap(obj) {
  if (!isObject(obj)) return null;
  const keys = Reflect.ownKeys(obj);
  if (keys.some((k) => typeof k !== 'string')) return null;
  const out = Object.create(null);
  for (const k of keys) out[k] = obj[k];
  return out;
}
const hasExactly = (s, keys) => {
  const have = Object.keys(s);
  return have.length === keys.length && keys.every((k) => have.includes(k));
};

function canon(v, depth) {
  if (depth > MAX_DEPTH) throw new Error('too deep');
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Object.is(v, -0)) throw new Error('number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    const a = denseCopy(v);
    if (!a || Reflect.ownKeys(v).length !== a.length + 1) throw new Error('array');
    return `[${a.map((x) => canon(x, depth + 1)).join(',')}]`;
  }
  if (typeof v !== 'object' || !isPlain(v)) throw new Error('not plain data');
  const s = snap(v);
  if (!s) throw new Error('object');
  return `{${Object.keys(s).sort().map((k) => `${JSON.stringify(k)}:${canon(s[k], depth + 1)}`).join(',')}}`;
}

/** Canonical JSON text of plain data (sorted keys, no whitespace), or `null` for anything else. */
export function canonicalJson(value) {
  try {
    return canon(value, 0);
  } catch {
    return null;
  }
}

// Validated plain copy of an arm, or null. `complete` demands the full 9 draws.
function copyArm(arm, complete) {
  const s = snap(arm);
  if (!s || !hasExactly(s, ['outcomes', 'cli', 'models', 'digest'])) return null;
  const outcomes = denseCopy(s.outcomes);
  const cli = denseCopy(s.cli);
  const models = denseCopy(s.models);
  if (!outcomes || !cli || !models || !isHash(s.digest)) return null;
  const n = outcomes.length;
  if (n < 1 || n > ARM_SIZE || cli.length !== n || models.length !== n || (complete && n !== ARM_SIZE)) return null;
  if (!outcomes.every((o) => ARM_OUTCOMES.includes(o)) || !cli.every(isText) || !models.every(isText)) return null;
  return { outcomes, cli, models, digest: s.digest };
}

// The candidate_result an aborted record must carry for its (validated, possibly partial) candidate arm:
// the pooled rule run with every undrawn draw as a pass ('FAIL' already) or as a fail ('pass' already).
function armResult(arm) {
  if (!arm) return null;
  const pad = (o) => armVerdict([...arm.outcomes, ...Array(ARM_SIZE).fill(o)].slice(0, ARM_SIZE))?.verdict;
  return pad('pass') === 'FAIL' ? 'FAIL' : pad('fail') === 'pass' ? 'pass' : null;
}

// Validated plain copy of a record, or null. `record_hash` is required when `needHash`, otherwise it
// is optional (a record not yet sealed) but, when present, still validated.
function copyRecord(rec, needHash) {
  const s = snap(rec);
  if (!s || !KINDS.includes(s.kind)) return null;
  const hashed = needHash || 'record_hash' in s;
  const kindField = KIND_FIELD[s.kind];
  if (!hasExactly(s, [...COMMON.filter((k) => hashed || k !== 'record_hash'), kindField])) return null;
  const complete = s.kind === 'verdict';
  const rawTasks = denseCopy(s.tasks);
  const modelIds = denseCopy(s.model_ids);
  if (s.schema_version !== SCHEMA_VERSION || !rawTasks?.length || !modelIds?.length || !modelIds.every(isText)) return null;
  const tasks = [];
  for (const t of rawTasks) {
    const ts = snap(t);
    if (!ts || !hasExactly(ts, ['id', 'hash']) || !isText(ts.id) || !isText(ts.hash)) return null;
    tasks.push({ id: ts.id, hash: ts.hash });
  }
  const candidate = s.candidate === null ? null : copyArm(s.candidate, complete);
  const baseline = s.baseline === null ? null : copyArm(s.baseline, complete);
  if ((s.candidate !== null && !candidate) || (s.baseline !== null && !baseline) || (complete && !candidate)) return null;
  const ok = [s.digest, s.instrument_digest].every(isHash) && RECORD_RULES.includes(s.rule) && [s.tier_config, s.cli_version].every(isText)
    && (s.baseline_digest === null || isHash(s.baseline_digest)) && isUsd(s.cost_candidate_usd) && isUsd(s.cost_baseline_usd)
    && isTextOrNull(s.rerun_of) && isTextOrNull(s.rerun_reason) && (s.rerun_of === null) === (s.rerun_reason === null)
    && (s.prev_record_hash === null || isHash(s.prev_record_hash)) && (!hashed || isHash(s.record_hash))
    && (complete ? TRIAGE_RESULTS.includes(s.triage_result) : s.candidate_result === armResult(candidate));
  if (!ok) return null;
  const out = {
    schema_version: SCHEMA_VERSION, kind: s.kind, digest: s.digest, rule: s.rule, tasks, tier_config: s.tier_config,
    instrument_digest: s.instrument_digest, cli_version: s.cli_version, model_ids: modelIds, candidate, baseline,
    cost_candidate_usd: s.cost_candidate_usd, cost_baseline_usd: s.cost_baseline_usd, baseline_digest: s.baseline_digest,
    rerun_of: s.rerun_of, rerun_reason: s.rerun_reason, prev_record_hash: s.prev_record_hash, [kindField]: s[kindField],
  };
  if (hashed) out.record_hash = s.record_hash;
  return out;
}

// sha256 of the canonical bytes of a validated copy, with record_hash left out of its own input.
function hashOf(copy) {
  const rest = { ...copy };
  delete rest.record_hash;
  const text = canonicalJson(rest);
  return text === null ? null : createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The validated plain copy of a sealed record (`record_hash` required), or `null`. */
export function validateRecord(record) {
  try {
    return copyRecord(record, true);
  } catch {
    return null;
  }
}

/** The 64-hex record hash of a valid record (a well-formed `record_hash` is ignored; a malformed one yields `null`), or `null`. */
export function recordHash(record) {
  try {
    const copy = copyRecord(record, false);
    return copy ? hashOf(copy) : null;
  } catch {
    return null;
  }
}

/** A validated copy of an unsealed record with its `record_hash` set, or `null` (also if one is already set). */
export function sealRecord(record) {
  try {
    const copy = copyRecord(record, false);
    const hash = copy && !('record_hash' in copy) ? hashOf(copy) : null;
    return hash ? { ...copy, record_hash: hash } : null;
  } catch {
    return null;
  }
}

/**
 * Verify a chain of sealed records, oldest first. Returns `{ok:true, length, head}` or
 * `{ok:false, index, reason}` naming the first bad record or link; `null` for a malformed input,
 * including an unknown option key or a malformed `genesisHash` / `headAnchor` (a typo must not
 * silently drop an anchor). Each record is validated, its hash recomputed, then its link checked.
 */
export function verifyChain(records, opts) {
  try {
    const list = denseCopy(records);
    const o = opts === undefined ? Object.create(null) : isObject(opts) && isPlain(opts) ? snap(opts) : null;
    if (!list || !o || !Object.keys(o).every((k) => k === 'genesisHash' || k === 'headAnchor')) return null;
    const { genesisHash, headAnchor } = o;
    if ((given(genesisHash) && !isHash(genesisHash)) || (given(headAnchor) && !isHash(headAnchor))) return null;
    let prev = null;
    for (let i = 0; i < list.length; i++) {
      const rec = copyRecord(list[i], true);
      if (!rec) return fail(i, `record ${i} is malformed or has an unknown schema_version`);
      const hash = hashOf(rec);
      if (hash !== rec.record_hash) return fail(i, `record ${i} does not match its record_hash (edited)`);
      if (i === 0) {
        if (rec.prev_record_hash !== null) return fail(0, 'first record has a prev_record_hash (chain does not start at genesis)');
        if (given(genesisHash) && hash !== genesisHash) return fail(0, 'first record hash does not match the genesis hash');
      } else if (rec.prev_record_hash !== prev) {
        return fail(i, `broken link between record ${i - 1} and record ${i}`);
      }
      prev = hash;
    }
    if (list.length === 0 && given(genesisHash)) return fail(0, 'empty chain cannot match the genesis hash');
    if (given(headAnchor) && prev !== headAnchor) return fail(Math.max(list.length - 1, 0), 'last record hash does not match the head anchor (tail truncated or replaced)');
    return { ok: true, length: list.length, head: prev };
  } catch {
    return null;
  }
}

/**
 * An unsealed `aborted` record from the common fields (everything but kind, candidate_result,
 * prev_record_hash and record_hash, which are refused if given; rerun_of / rerun_reason default to
 * null). candidate_result is derived from the candidate arm, never taken from the caller, so it cannot
 * disagree with it. Returns `null` for a malformed input.
 */
export function abortedRecord(fields) {
  try {
    const s = snap(fields);
    if (!s || ['kind', 'candidate_result', 'prev_record_hash', 'record_hash'].some((k) => k in s)) return null;
    const arm = s.candidate === null ? null : copyArm(s.candidate, false);
    if (s.candidate !== null && !arm) return null;
    return copyRecord({ rerun_of: null, rerun_reason: null, ...s, candidate: arm, kind: 'aborted', candidate_result: armResult(arm), prev_record_hash: null }, false);
  } catch {
    return null;
  }
}

/**
 * Append an unsealed record to the JSONL store at `file`. `opts`: `create` (boolean, default false: a
 * missing or empty store is refused, so a deleted or emptied store cannot restart as a new chain; true
 * means a new store only: an existing file is refused, and a file this call created is unlinked on any refusal), `genesisHash` and
 * `headAnchor` (passed to verifyChain). The record's prev_record_hash must be null (append at the head)
 * or the verified head; a different value is refused as stale. The validated, sealed copy is what is
 * written. Returns `{ok:true, record, length}`; `{ok:false, index, reason}` when the path, the store or
 * the write is refused (`index` is the broken record, or null); `null` for a malformed `file`, `opts`
 * (unknown key, foreign prototype, bad anchor) or record (including a sealed one).
 */
export function appendRecord(file, record, opts) {
  let fd = null;
  let written = false;
  let size = 0;
  let mayCreate = false;
  let created = false;
  let committed = false;
  try {
    const o = opts === undefined ? Object.create(null) : isObject(opts) && isPlain(opts) ? snap(opts) : null;
    if (!o || !Object.keys(o).every((k) => k === 'create' || k === 'genesisHash' || k === 'headAnchor')) return null;
    const { create = false, genesisHash, headAnchor } = o;
    const copy = copyRecord({ ...snap(record) }, false);
    if (typeof create !== 'boolean' || (given(genesisHash) && !isHash(genesisHash)) || (given(headAnchor) && !isHash(headAnchor))) return null;
    if (!copy || 'record_hash' in copy || typeof file !== 'string' || file === '') return null;
    mayCreate = create;
    const c = fs.constants;
    fd = fs.openSync(file, c.O_RDWR | c.O_APPEND | (create ? c.O_CREAT | c.O_EXCL : 0) | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0), 0o600);
    created = create;
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return fail(null, 'store is not a regular file');
    if (st.nlink !== 1) return fail(null, 'store has more than one hard link');
    if (typeof process.getuid === 'function' && (st.uid !== process.getuid() || (st.mode & 0o022) !== 0)) return fail(null, 'store is owned by another user or is group/world-writable');
    if (st.size > MAX_BYTES) return fail(null, `store is larger than ${MAX_BYTES} bytes`);
    const buf = fs.readFileSync(fd);
    size = buf.length;
    const text = buf.toString('utf8');
    if (text === '' && !mayCreate) return fail(null, 'store is empty (a new store needs create)');
    if (text !== '' && !text.endsWith('\n')) return fail(null, 'store ends in a partial line (no final newline)');
    const records = [];
    for (const [i, line] of (text === '' ? [] : text.slice(0, -1).split('\n')).entries()) {
      if (line.includes('\r')) return fail(i, `record ${i} has a carriage return (the store is LF-only)`);
      try { records.push(JSON.parse(line)); } catch { return fail(i, `record ${i} is not valid JSON`); }
    }
    const v = verifyChain(records, { genesisHash, headAnchor });
    if (!v?.ok) return v ?? fail(null, 'store could not be verified');
    if (copy.prev_record_hash !== null && copy.prev_record_hash !== v.head) return fail(null, 'stale prev_record_hash: chain head moved');
    const sealed = sealRecord({ ...copy, prev_record_hash: v.head });
    if (!sealed) return null;
    const line = `${JSON.stringify(sealed)}\n`;
    if (Buffer.byteLength(line) > MAX_LINE) return fail(null, `record line is larger than ${MAX_LINE} bytes`);
    written = true;
    fs.writeFileSync(fd, line);
    fs.fsyncSync(fd);
    committed = true;
    return { ok: true, record: sealed, length: v.length + 1 };
  } catch (e) {
    if (written) {
      try { fs.ftruncateSync(fd, size); } catch { return fail(null, created ? 'new store removed after a failed write' : 'store may hold a partial record'); }
      try { fs.fsyncSync(fd); } catch { /* the cut-back is done; making it durable is best-effort */ }
      return fail(null, `write failed; store truncated back to ${size} bytes`);
    }
    if (e?.code === 'EEXIST' && fd === null && mayCreate) return fail(null, 'store already exists (create is for a new store only)');
    if (e?.code === 'ENOENT' && fd === null && !mayCreate) return fail(null, 'store is missing and create was not requested');
    return typeof e?.syscall === 'string' ? fail(null, `cannot append: ${e.code}`) : null;
  } finally {
    // A close error cannot undo an fsynced write, and a throw here would escape the never-throws contract.
    if (fd !== null) try { fs.closeSync(fd); } catch { /* nothing left to undo */ }
    // A refused new store must not stay behind; a leftover that cannot be removed is refused as empty next time.
    if (created && !committed) try { fs.unlinkSync(file); } catch { /* see above */ }
  }
}
