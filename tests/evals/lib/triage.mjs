// Paired triage (FR-35) and the one-rerun policy (FR-34). Pure functions over explicit inputs; each
// returns a `{verdict, rule_id, reason, ...}` object, or `null` for an input shape it was not written
// for -- never a throw, so a malformed record cannot be mistaken for a verdict.
//
// Arm: `{outcomes, cli, models, digest}`. `outcomes` is exactly 9 entries of ARM_OUTCOMES. `cli` and
// `models` are per-draw lists of the same length (one non-empty string per draw; a draw that used
// several model ids passes its sorted, comma-joined key), so drift inside an arm is detectable.
// `digest` is a non-empty string.
//
// triage() takes COMPLETE arms: a partial arm (not 9 outcomes) is `null`, not a pending verdict. The
// baseline arm is only run after a candidate FAIL, so `baseline` may be absent (null/undefined) when
// the candidate passes or no baseline exists; a candidate FAIL with a `v*` tag but no baseline arm
// is a shape the caller should not produce, and is `null`. `tagBaselineDigest` is the digest of the
// most recent `v*` tag, or null/undefined when there is none.
//
// History record (oldest first; any digest): `{digest, kind, rerun_of, rerun_reason, ...}`. Both
// `rerun_of` and `rerun_reason` must be present and are either both null or both non-empty strings.
// `kind: 'verdict'` also needs `triage_result`, one of TRIAGE_RESULTS. `kind: 'aborted'` also needs
// `candidate_result`: 'FAIL', 'pass' or null (candidate arm not known). Other fields are ignored.
// A record missing a field, or carrying an unknown value, makes the whole history `null`: a missing
// field must never read as "no rerun used" or "no inconclusive before".

import { FAIL_OUTCOMES, armVerdict } from './rules.mjs';

const ARM_SIZE = 9;

export const TRIAGE_RESULTS = Object.freeze([
  'pass',
  'block',
  'inconclusive: instrument-or-environment',
  'user-decision-required',
  'refused: drift',
  'refused: no-baseline',
]);
export const KINDS = Object.freeze(['verdict', 'aborted']);
export const CANDIDATE_RESULTS = Object.freeze(['FAIL', 'pass', null]);

// A property read counts only when the property is the object's own (never inherited).
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.length > 0;
const isTextOrNull = (v) => v === null || isText(v);
const distinct = (list) => [...new Set(list)].sort();

// Dense plain copy of an array (`length` read once, every slot read once), or null. A hole is
// refused: a missing entry must not vanish from a count. `size`, when given, must equal the length.
function denseCopy(arr, size) {
  if (!Array.isArray(arr)) return null;
  const n = arr.length;
  if (size !== undefined && n !== size) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!Object.hasOwn(arr, i)) return null;
    out.push(arr[i]);
  }
  return out;
}

// Validated, plain summary of an arm, or null. Every decision below runs on this copy only.
function copyArm(arm) {
  if (!isObject(arm)) return null;
  const outcomes = denseCopy(own(arm, 'outcomes'), ARM_SIZE);
  const cli = denseCopy(own(arm, 'cli'), ARM_SIZE);
  const models = denseCopy(own(arm, 'models'), ARM_SIZE);
  const digest = own(arm, 'digest');
  if (!outcomes || !cli || !models || !isText(digest)) return null;
  if (!cli.every(isText) || !models.every(isText)) return null;
  const result = armVerdict(outcomes);
  if (!result) return null;
  return {
    fail: result.verdict === 'FAIL',
    failures: outcomes.filter((o) => FAIL_OUTCOMES.includes(o)).length,
    cli: distinct(cli),
    models: distinct(models),
    digest,
  };
}

// Validated, plain copy of a history, or null.
function copyHistory(history) {
  const records = denseCopy(history);
  if (!records) return null;
  const out = [];
  for (const rec of records) {
    if (!isObject(rec)) return null;
    const digest = own(rec, 'digest');
    const kind = own(rec, 'kind');
    const rerunOf = own(rec, 'rerun_of');
    const rerunReason = own(rec, 'rerun_reason');
    if (!isText(digest) || !KINDS.includes(kind)) return null;
    if (!isTextOrNull(rerunOf) || !isTextOrNull(rerunReason) || (rerunOf === null) !== (rerunReason === null)) return null;
    const out1 = { digest, kind, rerun: rerunOf !== null, triage: null, candidate: null };
    if (kind === 'verdict') {
      out1.triage = own(rec, 'triage_result');
      if (!TRIAGE_RESULTS.includes(out1.triage)) return null;
    } else {
      out1.candidate = own(rec, 'candidate_result');
      if (!CANDIDATE_RESULTS.includes(out1.candidate)) return null;
    }
    out.push(out1);
  }
  return out;
}

// True iff the most recent decisive verdict in the history (any digest) is an inconclusive one. An
// `aborted` record is not a verdict and a `refused` one decides nothing, so neither ends a streak:
// skipping them can only demand a user decision, never skip one.
function lastDecisiveWasInconclusive(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const { kind, triage } = history[i];
    if (kind !== 'verdict' || triage.startsWith('refused')) continue;
    return triage.startsWith('inconclusive') || triage === 'user-decision-required';
  }
  return false;
}

/**
 * Paired triage over `{candidate, baseline, tagBaselineDigest, history}`. Precedence is a total
 * order; the first step that applies wins:
 *   1. drift inside the candidate arm (mixed CLI version or model)    -> refused: drift
 *   2. candidate arm passes                                           -> pass
 *   3. no `v*` baseline (no tag, or the baseline arm's digest is not
 *      the tag's digest)                                              -> refused: no-baseline
 *   4. CLI or model sets differ between the arms (this also refuses a
 *      uniform candidate against an internally mixed baseline)        -> refused: drift
 *   5. baseline passes -> block; baseline FAILs -> inconclusive, or
 *      user-decision-required when the latest decisive verdict in
 *      `history` was already inconclusive (fails closed: no decision
 *      record shape exists to satisfy it yet)
 * The result carries both arm failure counts (`baseline_failures` is null when no baseline arm was
 * given) and a reason naming the rule that fired.
 */
export function triage(input) {
  try {
    if (!isObject(input)) return null;
    const candidate = copyArm(own(input, 'candidate'));
    const rawBaseline = own(input, 'baseline');
    const hasBaseline = rawBaseline !== undefined && rawBaseline !== null;
    const baseline = hasBaseline ? copyArm(rawBaseline) : null;
    const tag = own(input, 'tagBaselineDigest');
    const hasTag = tag !== undefined && tag !== null;
    const history = copyHistory(own(input, 'history'));
    if (!candidate || !history || (hasBaseline && !baseline) || (hasTag && !isText(tag))) return null;

    const counts = `candidate ${candidate.failures}/${ARM_SIZE} failures${baseline ? `, baseline ${baseline.failures}/${ARM_SIZE}` : ''}`;
    const result = (verdict, why) => ({
      verdict,
      rule_id: 'paired-triage',
      reason: `${why} (${counts})`,
      candidate_failures: candidate.failures,
      baseline_failures: baseline ? baseline.failures : null,
    });

    if (candidate.cli.length > 1 || candidate.models.length > 1) {
      return result('refused: drift', 'drift within the candidate arm: mixed CLI versions or models');
    }
    if (!candidate.fail) return result('pass', 'candidate arm passes');
    if (!hasTag) return result('refused: no-baseline', 'no v* release tag to take a baseline from');
    if (!baseline) return null;
    if (baseline.digest !== tag) {
      return result('refused: no-baseline', 'baseline arm is not the digest of the latest v* tag');
    }
    if (JSON.stringify(candidate.cli) !== JSON.stringify(baseline.cli) || JSON.stringify(candidate.models) !== JSON.stringify(baseline.models)) {
      return result('refused: drift', 'CLI versions or models differ between the arms');
    }
    if (!baseline.fail) return result('block', 'candidate FAILs and baseline passes');
    if (lastDecisiveWasInconclusive(history)) {
      return result('user-decision-required', 'second consecutive inconclusive: a recorded user decision is required before release');
    }
    return result('inconclusive: instrument-or-environment', 'candidate and baseline both FAIL: not blocking, flag the tasks and environment');
  } catch {
    return null;
  }
}

/**
 * One reasoned rerun per digest (FR-34). Each record for `digest` uses the rerun when it is marked
 * as one (`rerun_of` set), is an `aborted` record after a candidate FAIL (FR-0b), or is a `verdict`
 * following an earlier `verdict` or aborted FAIL for the same digest, marked or not: an unmarked
 * repeat is still a re-roll. Each record counts once. The first verdict uses nothing; `allowed` while
 * none is used, `refused` once one is (so an aborted FAIL then a verdict is two uses). It does not
 * ask whether a rerun makes sense (the latest verdict being a block is the caller's question).
 */
export function rerunAllowed(history, digest) {
  try {
    const records = copyHistory(history);
    if (!records || !isText(digest)) return null;
    let prior = false;
    let used = 0;
    for (const r of records) {
      if (r.digest !== digest) continue;
      const abortedFail = r.kind === 'aborted' && r.candidate === 'FAIL';
      if (r.rerun || abortedFail || (r.kind === 'verdict' && prior)) used++;
      if (r.kind === 'verdict' || abortedFail) prior = true;
    }
    return {
      verdict: used === 0 ? 'allowed' : 'refused',
      rule_id: 'rerun-once',
      reason: `${used} rerun(s) already used for this digest, 1 allowed`,
    };
  } catch {
    return null;
  }
}
