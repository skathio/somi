// Calibrate-as-you-go retirement (statistical-design.md section 5, FR-30). Pure functions; `null`
// for an input shape they were not written for, never a throw.
//
// Draw record: `{digest, outcome}` -- `digest` is a non-empty string (the definition-set digest the
// draw ran on), `outcome` is one of ARM_OUTCOMES. Nothing else is read; extra fields are ignored.
// Input must be `rollingFeed(...)` output; `retireDecision` does not check digests (F-49).
// Draws are oldest-first. `invalid` is not an outcome: the caller replaces it before recording.

import { ARM_OUTCOMES, FAIL_OUTCOMES } from './rules.mjs';
import { wilson } from './stats.mjs';

const WINDOW = 20; // last N valid draws
const MIN_DRAWS = 10; // fewer than this: no verdict
const RETIRE_BELOW = 0.85; // retire iff the Wilson upper bound of the pass rate is under this

const isDigest = (d) => typeof d === 'string' && d.length > 0;
const isDraw = (d) =>
  typeof d === 'object' && d !== null && isDigest(d.digest) && ARM_OUTCOMES.includes(d.outcome);

// Dense copy of an array, or null. Holes are refused: a missing draw must not vanish from the count.
function denseCopy(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (!Object.hasOwn(arr, i)) return null;
    out.push(arr[i]);
  }
  return out;
}

/**
 * Retire decision over the last 20 draws (all of them when there are 10-19). Fewer than 10 is
 * `kept` with an `insufficient` reason. Retires iff the Wilson 95% upper bound of the pass rate is
 * below 0.85, i.e. at least 7 failures in 20. Input must be `rollingFeed(...)` output; this function
 * does not check digests (F-49).
 */
export function retireDecision(draws) {
  try {
    const all = denseCopy(draws);
    if (!all || !all.every(isDraw)) return null;
    const window = all.slice(-WINDOW);
    const n = window.length;
    const k = window.filter((d) => FAIL_OUTCOMES.includes(d.outcome)).length;
    if (n < MIN_DRAWS) {
      return { verdict: 'kept', rule_id: 'wilson-20-0.85', reason: `insufficient: ${n} valid draws < ${MIN_DRAWS}`, k, n, upper: null };
    }
    const { upper } = wilson(n - k, n);
    const retire = upper < RETIRE_BELOW;
    return {
      verdict: retire ? 'retire' : 'kept',
      rule_id: 'wilson-20-0.85',
      reason: `${k}/${n} failures, Wilson upper ${upper.toFixed(3)} ${retire ? '<' : '>='} ${RETIRE_BELOW}`,
      k,
      n,
      upper,
    };
  } catch {
    return null;
  }
}

/**
 * The rolling record (FR-30, F-49): only draws on released digests. A candidate-arm draw on a digest
 * that was never released must not be able to retire the task that caught it. `releasedDigests` is
 * a Set or array of digest strings. Returns the kept draws, oldest-first, or `null`.
 */
export function rollingFeed(draws, releasedDigests) {
  try {
    const all = denseCopy(draws);
    const released = releasedDigests instanceof Set ? [...releasedDigests] : denseCopy(releasedDigests);
    if (!all || !released || !all.every(isDraw) || !released.every(isDigest)) return null;
    const keep = new Set(released);
    return all.filter((d) => keep.has(d.digest));
  } catch {
    return null;
  }
}
