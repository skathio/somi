// Verdict record (FR-17), its canonical hash and the hash chain (FR-33, FR-38). Pure functions over
// explicit inputs; each returns `null` for a malformed input, never a throw. Every input is read ONCE
// into a plain copy and all decisions (and the hash) run on that copy, so a getter or Proxy that
// answers differently on a second read cannot change what was validated.
//
// Record (flat; EXACTLY these keys, nothing else is stored, so a secret-like extra field is refused):
//   schema_version 1; kind 'verdict' | 'aborted'; digest, rule, tier_config, instrument_digest,
//   cli_version (non-empty strings); tasks [{id, hash}] and model_ids [string], both non-empty;
//   candidate / baseline: an arm {outcomes, cli, models, digest} (the shape triage reads) or null;
//   cost_candidate_usd / cost_baseline_usd: the two cost legs, finite numbers >= 0 (baseline 0 when
//   no baseline arm ran); baseline_digest: string | null; rerun_of / rerun_reason: both null or both
//   non-empty strings; prev_record_hash: 64-hex | null; record_hash: 64-hex.
//   A `verdict` carries triage_result (TRIAGE_RESULTS) and complete arms (9 draws, with 9 `cli` and 9
//   `models` entries); an `aborted` record carries candidate_result ('FAIL' | 'pass' | null) instead
//   and its arms may be null or partial (equal-length lists of at most 9).
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

import { createHash } from 'node:crypto';
import { ARM_OUTCOMES, ARM_SIZE } from './rules.mjs';
import { CANDIDATE_RESULTS, KINDS, TRIAGE_RESULTS } from './triage.mjs';

export const SCHEMA_VERSION = 1;
const MAX_DEPTH = 16;
const HEX = /^[0-9a-f]{64}$/;
const COMMON = ['schema_version', 'kind', 'digest', 'rule', 'tasks', 'tier_config', 'instrument_digest', 'cli_version', 'model_ids', 'candidate', 'baseline', 'cost_candidate_usd', 'cost_baseline_usd', 'baseline_digest', 'rerun_of', 'rerun_reason', 'prev_record_hash', 'record_hash'];
const KIND_FIELD = { verdict: 'triage_result', aborted: 'candidate_result' };

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.length > 0;
const isTextOrNull = (v) => v === null || isText(v);
const isHash = (v) => typeof v === 'string' && HEX.test(v);
const isUsd = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && !Object.is(v, -0);

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
  const proto = typeof v === 'object' ? Object.getPrototypeOf(v) : undefined;
  if (proto !== Object.prototype && proto !== null) throw new Error('not plain data');
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
  if (!outcomes || !cli || !models || !isText(s.digest)) return null;
  const n = outcomes.length;
  if (n > ARM_SIZE || cli.length !== n || models.length !== n || (complete && n !== ARM_SIZE)) return null;
  if (!outcomes.every((o) => ARM_OUTCOMES.includes(o)) || !cli.every(isText) || !models.every(isText)) return null;
  return { outcomes, cli, models, digest: s.digest };
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
  const ok = [s.digest, s.rule, s.tier_config, s.instrument_digest, s.cli_version].every(isText)
    && isTextOrNull(s.baseline_digest) && isUsd(s.cost_candidate_usd) && isUsd(s.cost_baseline_usd)
    && isTextOrNull(s.rerun_of) && isTextOrNull(s.rerun_reason) && (s.rerun_of === null) === (s.rerun_reason === null)
    && (s.prev_record_hash === null || isHash(s.prev_record_hash)) && (!hashed || isHash(s.record_hash))
    && (complete ? TRIAGE_RESULTS : CANDIDATE_RESULTS).includes(s[kindField]);
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
  return createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex');
}

/** The validated plain copy of a sealed record (`record_hash` required), or `null`. */
export function validateRecord(record) {
  try {
    return copyRecord(record, true);
  } catch {
    return null;
  }
}

/** The 64-hex record hash of a valid record (any `record_hash` it carries is ignored), or `null`. */
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
    return copy && !('record_hash' in copy) ? { ...copy, record_hash: hashOf(copy) } : null;
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
    const o = opts === undefined ? Object.create(null) : snap(opts);
    if (!list || !o || !Object.keys(o).every((k) => k === 'genesisHash' || k === 'headAnchor')) return null;
    const given = (v) => v !== undefined && v !== null;
    const { genesisHash, headAnchor } = o;
    if ((given(genesisHash) && !isHash(genesisHash)) || (given(headAnchor) && !isHash(headAnchor))) return null;
    const fail = (index, reason) => ({ ok: false, index, reason });
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
