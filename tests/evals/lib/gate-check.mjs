// Release verdict check (FR-16, FR-17, FR-33, FR-34, FR-35): may THIS definition-set digest be released?
// Pure over explicit inputs; it never runs git and never writes. Callers gate ONLY on `verdict ===
// 'ready'` (a `not-ready` result may carry `code: 'invalid'`); a `null` return is a malformed argument,
// never ready. `ready` means only: a chain-consistent record exists for this digest that recomputes to
// pass or inconclusive. It says nothing about the hidden suites, the containers, which model really ran
// (model ids are self-reported by the draws) or cost. Fail closed: every input is read once into a plain
// copy, and a missing, ambiguous or unexpected value is never `ready`.
//
// Argument: a plain-keyed object `{records, digest, baselineTag, genesisHash?, headAnchor?}` (any other
// key, a symbol key, a missing `baselineTag`, a digest or tag that is not 64 lowercase hex, `records` not
// a dense array or a malformed anchor is `null`; a class instance with own keys is read like a plain
// object). `baselineTag` is the digest of the latest v* tag, or `null` when none exists; the caller
// computes it, so a record cannot choose its own baseline (FR-35).
//
// Checks, in order, each failing closed (`code`):
//   1. chain: records validate, hashes recompute, links, optional anchors      invalid, "broken chain"
//   2. no records, or none for this digest (a later record for another digest
//      never masks it; the latest for this digest decides)                     not-ready, "no verdict"
//   3. latest record is `aborted`                                              not-ready, "aborted"
//   4. the arms were drawn on this digest: candidate.digest equals the record digest, and any baseline
//      arm's digest equals baseline_digest                                     not-ready, "digest mismatch"
//   5. baseline_digest, when set, equals `baselineTag`, a PRIOR release (never the candidate's own tree) not-ready, "baseline is not the latest v* tag"
//   6. recompute: triage() over the record's arms, `baselineTag`, and the EARLIER chain records as
//      history; a different verdict than the stored triage_result              not-ready, "recompute mismatch"
//      (triage cannot evaluate the record)                                     not-ready, "invalid"
//   7. rerun policy (FR-34) on this digest's records up to the latest: more than one rerun used, or a
//      repeat verdict not marked as a rerun                                    not-ready, "rerun-policy"
//   8. mapping (FR-35): pass -> ready; inconclusive -> ready with `inconclusive: true`; user-decision-
//      required (no decision record exists, no exception), block, refused: drift, refused: no-baseline
//      -> not-ready. A ready record whose candidate draws were not all on `cli_version`
//      -> not-ready, "cli mismatch".
// Residuals: with no headAnchor a deleted TAIL still verifies (see verdict-record.mjs); instrument_digest
// and model_ids are compared with nothing here (the result carries `record`, the index, so a later check
// can); rerun_of and rerun_reason are not verified against any record; an `aborted` record with a null
// candidate_result uses no rerun, a run killed before anything is written is invisible, and a passing
// verdict on another digest resets the consecutive-inconclusive streak. The real control is a run-start
// record pre-registered by the writer. A rerun without rerun_reason is caught at step 1 (the pair is
// validated there).
//
// readRecordsFile reads the JSONL store read-only with appendRecord's read-side rules: O_NOFOLLOW,
// regular file, the same 32 MiB cap, owner and group/world-writable mode (where getuid exists), LF-only,
// a complete last line, strict UTF-8, and canonical lines (so duplicate keys and padding are refused).
// The owner and mode rule matters because a sealed record is not a secret: anyone who can write the store
// can append one, so the trust boundary is the maintainer plus the host. The link count is not checked
// and symlinked parent directories are followed. It returns plain data; checkVerdicts verifies the chain.

import fs from 'node:fs';
import { validateRecord, verifyChain } from './verdict-record.mjs';
import { triage, rerunsUsed } from './triage.mjs';
import { armVerdict } from './rules.mjs';

const MAX_BYTES = 32 * 1024 * 1024; // keep equal to verdict-record.mjs
const HEX = /^[0-9a-f]{64}$/;
const ARG_KEYS = ['records', 'digest', 'baselineTag', 'genesisHash', 'headAnchor'];
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
// [ready?, code] per triage verdict; keys equal TRIAGE_RESULTS and anything else is not-ready.
export const MAPPING = Object.freeze({
  pass: [true, 'pass'],
  'inconclusive: instrument-or-environment': [true, 'inconclusive'],
  'user-decision-required': [false, 'user-decision-required'],
  block: [false, 'block'],
  'refused: drift': [false, 'refused: drift'],
  'refused: no-baseline': [false, 'refused: no-baseline'],
});

const out = (verdict, code, why, extra) => ({ verdict, code, reason: `${code}: ${why}`, inconclusive: false, ...extra });

// Dense plain copy of an array (`length` and each slot read once), or null.
function dense(arr) {
  if (!Array.isArray(arr)) return null;
  const n = arr.length;
  const list = [];
  for (let i = 0; i < n; i++) {
    if (!Object.hasOwn(arr, i)) return null;
    list.push(arr[i]);
  }
  return list;
}

/**
 * `{records, digest, baselineTag, genesisHash?, headAnchor?}` -> `{verdict, code, reason, inconclusive,
 * record?, arms?}`, or `null` for a malformed argument.
 */
export function checkVerdicts(args) {
  try {
    if (!isObject(args)) return null;
    const keys = Reflect.ownKeys(args);
    if (!keys.every((k) => ARG_KEYS.includes(k))) return null;
    const a = Object.create(null);
    for (const k of keys) a[k] = args[k];
    const list = dense(a.records);
    if (!list || typeof a.digest !== 'string' || !HEX.test(a.digest)) return null;
    const digest = a.digest;
    const tag = a.baselineTag;
    if (tag !== null && !(typeof tag === 'string' && HEX.test(tag))) return null;

    // Copy first, verify the copies: the bytes verified are the bytes decided on.
    const copies = list.map((r) => validateRecord(r));
    const chain = verifyChain(copies, { genesisHash: a.genesisHash, headAnchor: a.headAnchor });
    if (!chain) return null;
    if (!chain.ok) return { ...out('invalid', 'broken chain', '', { index: chain.index }), reason: `broken chain at ${chain.index}: ${chain.reason}` };
    if (copies.length === 0) return out('not-ready', 'no verdict', 'the store holds no records');
    let k = -1;
    copies.forEach((r, i) => { if (r.digest === digest) k = i; });
    if (k < 0) return out('not-ready', 'no verdict', 'no record for this digest');
    const rec = copies[k];
    const at = { record: k };
    if (rec.kind === 'aborted') return out('not-ready', 'aborted', 'the latest record for this digest is an aborted run', at);

    const { candidate, baseline } = rec;
    if (candidate.digest !== rec.digest || (baseline && baseline.digest !== rec.baseline_digest)) {
      return out('not-ready', 'digest mismatch', 'an arm was not drawn on the digest the record claims', at);
    }
    // A tag on the candidate's own tree is never a baseline: a tree compared with itself FAILs twice.
    if (rec.baseline_digest !== null && (rec.baseline_digest !== tag || tag === digest)) return out('not-ready', 'baseline is not the latest v* tag', 'the baseline is not a prior release tag', at);

    const t = triage({ candidate, baseline, tagBaselineDigest: tag, history: copies.slice(0, k) });
    const arms = { candidate: armVerdict(rec.candidate.outcomes)?.verdict ?? null, baseline: rec.baseline ? armVerdict(rec.baseline.outcomes)?.verdict ?? null : null };
    if (!t || !arms.candidate || (rec.baseline && !arms.baseline)) return out('not-ready', 'invalid', 'the record cannot be recomputed by triage', { ...at, arms });
    const known = { ...at, arms };
    if (t.verdict !== rec.triage_result) return out('not-ready', 'recompute mismatch', `stored "${rec.triage_result}", recomputed "${t.verdict}"`, known);

    const used = rerunsUsed(copies.slice(0, k + 1), digest);
    let verdicts = 0;
    let unmarked = false;
    copies.slice(0, k + 1).forEach((r) => {
      if (r.digest === digest && r.kind === 'verdict' && verdicts++ > 0 && r.rerun_of === null) unmarked = true;
    });
    if (used === null) return out('not-ready', 'invalid', 'the rerun history cannot be evaluated', known);
    if (used > 1 || unmarked) return out('not-ready', 'rerun-policy', used > 1 ? `${used} reruns used for this digest, 1 allowed` : 'a repeat verdict for this digest is not marked as a rerun', known);

    const row = Object.hasOwn(MAPPING, t.verdict) ? MAPPING[t.verdict] : null;
    if (!row) return out('not-ready', 'invalid', `unmapped verdict "${t.verdict}"`, known);
    const [ready, code] = row;
    if (ready && !candidate.cli.every((c) => c === rec.cli_version)) return out('not-ready', 'cli mismatch', 'a draw ran on a CLI version other than the record cli_version', known);
    return { ...out(ready ? 'ready' : 'not-ready', code, t.reason, known), inconclusive: code === 'inconclusive' };
  } catch {
    return null;
  }
}

// A `__proto__` key is refused outright: JSON.parse would store it as an own data property.
const noProto = (key, value) => {
  if (key === '__proto__') throw new Error('__proto__ key');
  return value;
};

/** Parsed records of the JSONL store at `path` (read-only), or `null` on anything malformed. An empty file is `[]`. */
export function readRecordsFile(path) {
  let fd = null;
  try {
    if (typeof path !== 'string' || path === '') return null;
    const c = fs.constants;
    fd = fs.openSync(path, c.O_RDONLY | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    if (typeof process.getuid === 'function' && (st.uid !== process.getuid() || (st.mode & 0o022) !== 0)) return null;
    const buf = fs.readFileSync(fd);
    if (buf.length > MAX_BYTES) return null;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
    const lines = text.split('\n');
    if (lines.pop() !== '') return null; // the last line must end in LF (an empty file is zero lines)
    const records = [];
    for (const line of lines) {
      // A blank line is not JSON; CRLF, padding and duplicate keys fail the canonical-line check below.
      const rec = JSON.parse(line, noProto);
      if (!isObject(rec) || JSON.stringify(rec) !== line) return null;
      records.push(rec);
    }
    return records;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* a read-only handle: nothing to undo */ }
  }
}
