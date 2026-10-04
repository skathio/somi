// Decision rules for the eval gate: pure functions over explicit inputs. Each returns a
// `{verdict, reason}` object, or `null` for an input shape it was not written for -- never a throw,
// so a malformed record cannot be mistaken for a verdict.

export const ARM_SIZE = 9; // 3 tasks x 3 valid draws
const ARM_FAIL_AT = 4; // an arm FAILs iff failures >= this (statistical-design.md section 3)

// The per-draw outcome tokens an arm may carry. `over-budget` (FR-7 rules 4-5, reported as the
// reason `fail: over-budget`) and `unexpected-pause` (FR-6/FR-7 rule 7) are kinds of fail, so each
// counts toward the arm's failures. `invalid` is NOT here: the caller replaces it first (FR-7), and
// only the caller knows whether a replacement is still available.
export const ARM_OUTCOMES = Object.freeze(['pass', 'fail', 'over-budget', 'unexpected-pause']);
export const FAIL_OUTCOMES = Object.freeze(ARM_OUTCOMES.filter((o) => o !== 'pass'));

/**
 * Pooled arm rule over exactly 9 outcomes drawn from ARM_OUTCOMES. Anything else -- wrong length,
 * an unknown token, a sparse array (a missing draw must never read as a pass), or an input whose
 * access throws -- yields `null`.
 */
export function armVerdict(outcomes) {
  try {
    if (!Array.isArray(outcomes) || outcomes.length !== ARM_SIZE) return null;
    const draws = [];
    for (let i = 0; i < ARM_SIZE; i++) {
      if (!Object.hasOwn(outcomes, i)) return null;
      draws.push(outcomes[i]);
    }
    if (!draws.every((o) => ARM_OUTCOMES.includes(o))) return null;
    const failures = draws.filter((o) => FAIL_OUTCOMES.includes(o)).length;
    const failed = failures >= ARM_FAIL_AT;
    return {
      verdict: failed ? 'FAIL' : 'pass',
      rule_id: 'pooled-9-4',
      reason: `${failures}/${ARM_SIZE} failures ${failed ? '>=' : '<'} ${ARM_FAIL_AT}`,
    };
  } catch {
    return null;
  }
}

const SMOKE_SIZE = 5;
const SMOKE_MAX_FAILS = 1; // admit iff failures <= this (statistical-design.md section 4, FR-14)

/**
 * Smoke admission over exactly 5 outcomes drawn from ARM_OUTCOMES: admitted iff at most 1 failure
 * and no Stage 0. `stage0` must be a boolean -- a missing flag must not read as "no Stage 0".
 * Same `null` contract as armVerdict: wrong count, hole, unknown token, bad flag, throwing access.
 */
export function smokeAdmit(draws, opts) {
  try {
    const stage0 = opts?.stage0; // read inside the try: a null or throwing options object must yield null
    if (!Array.isArray(draws) || draws.length !== SMOKE_SIZE || typeof stage0 !== 'boolean') return null;
    const outcomes = [];
    for (let i = 0; i < SMOKE_SIZE; i++) {
      if (!Object.hasOwn(draws, i)) return null;
      outcomes.push(draws[i]);
    }
    if (!outcomes.every((o) => ARM_OUTCOMES.includes(o))) return null;
    const failures = outcomes.filter((o) => FAIL_OUTCOMES.includes(o)).length;
    const admitted = failures <= SMOKE_MAX_FAILS && !stage0;
    return {
      verdict: admitted ? 'admit' : 'reject',
      rule_id: 'smoke-5-1',
      reason: `${failures}/${SMOKE_SIZE} failures ${failures <= SMOKE_MAX_FAILS ? '<=' : '>'} ${SMOKE_MAX_FAILS}, ${stage0 ? 'Stage 0 seen' : 'no Stage 0'}`,
    };
  } catch {
    return null;
  }
}
