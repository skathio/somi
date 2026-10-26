// Spike go/no-go (FR-2) and cost-probe decision (FR-1a, FR-36). Pure functions over explicit inputs,
// meant to be called after EVERY draw: they accept a partial set of valid draws and return a verdict
// as soon as one is certain, so the runner never re-implements an early stop. Each returns a result
// object, or `null` for an input shape it was not written for -- never a throw, so a malformed
// record cannot be mistaken for a verdict. A missing or ambiguous flag is never read as "clean".
//
// spikeDecision input:
//   draws        0..15 valid-draw outcomes, each one of ARM_OUTCOMES (no `invalid`: the caller
//                replaces it and reports how many in invalidSeen). over-budget counts as a fail.
//   spendUsd     finite number >= 0, the actual spend so far in USD.
//   stage0Seen   boolean, Stage 0 seen in any draw.
//   invalidSeen  integer >= 0, invalid draws observed so far, replaced or not.
// Result: {verdict, rule_id, reasons[], reason}. Verdict, in this order:
//   `no-go: <p̂|stage0|spend>` when a failure is already certain -- p̂ once 2 draws have failed (14/15
//     can no longer be reached), stage0, or spend over the cap. It names the PRIMARY failing condition
//     (FR-2 order: p̂, stage0, spend); `reasons` lists every certain failure in that order. Certain
//     no-go reasons take precedence over `inconclusive`;
//   `inconclusive` when more than 5 invalid draws were seen and nothing else is certain;
//   `pending` when fewer than 15 valid draws are in and nothing is certain;
//   `go` for a complete clean set.
//
// probeDecision input:
//   draws        0..3 valid-draw records `{costUsd, durationMin, resumeFailed, nonAnthropicHost,
//                tokenHit}`: costUsd and durationMin are finite numbers >= 0 (USD, MINUTES -- the
//                field name carries the unit so milliseconds cannot be passed by mistake); the three
//                flags must be booleans. Extra fields are ignored. Each record is copied once, so a
//                getter that changes its answer cannot pass validation and then decide differently.
//   unit         one of UNITS: `ship-loop` (primary) or `code-loop` (the FR-36 fallback). The tokens
//                are hyphenated, not slashed as in the requirements text; the spelling is cosmetic.
//   invalidSeen  integer >= 0, invalid draws observed in this run, replaced or not.
// Result: {verdict: stop|switch|continue|pending, rule_id, reasons[], reason}. stop beats switch beats
// continue. Precedence holds among the draws already seen: a later draw can still add a stop, so the
// decision is re-evaluated after every draw. With 3 draws the median exceeds 20 minutes iff at least 2 do, so that is certain as soon
// as two known draws are slow. `continue` needs the complete clean set of 3; otherwise `pending`.

import { ARM_OUTCOMES, FAIL_OUTCOMES } from './rules.mjs';

const SPIKE_SIZE = 15;
const SPIKE_MIN_PASSES = 14; // p̂ >= 0.90 pooled (FR-2a)
const SPIKE_MAX_INVALID = 5; // more than this: inconclusive (FR-1)
const SPIKE_SPEND_CAP_USD = 208; // FR-2c, strict: $208.01 fails

const PROBE_SIZE = 3;
const PROBE_COST_CAP_USD = 8; // a draw strictly over this stops (FR-1a)
const PROBE_MEDIAN_CAP_MIN = 20; // median strictly over this switches (FR-36)
const PROBE_DRAW_CAP_MIN = 40; // any draw strictly over this switches
const PROBE_MAX_INVALID = 2; // invalid draws replaced per probe run; a third stops
export const UNITS = Object.freeze(['ship-loop', 'code-loop']);

const isCount = (x) => Number.isInteger(x) && x >= 0;
const isAmount = (x) => Number.isFinite(x) && x >= 0;

// Dense copy of an array of exactly `size` slots, or null. Each slot is read once; holes are refused.
function denseOf(arr, size) {
  if (!Array.isArray(arr) || arr.length !== size) return null;
  const out = [];
  for (let i = 0; i < size; i++) {
    if (!Object.hasOwn(arr, i)) return null;
    out.push(arr[i]);
  }
  return out;
}

const usd = (x) => `$${x.toFixed(2)}`; // text only: comparisons use the raw value

export function spikeDecision(input) {
  try {
    const { draws, spendUsd, stage0Seen, invalidSeen } = input; // destructure inside the try: null / throwing input -> null
    if (!Array.isArray(draws)) return null;
    const len = draws.length; // read once: denseOf re-checks it, so a length that changes cannot pass the cap
    if (len > SPIKE_SIZE) return null;
    const outcomes = denseOf(draws, len);
    if (!outcomes || !outcomes.every((o) => ARM_OUTCOMES.includes(o))) return null;
    if (!isAmount(spendUsd) || typeof stage0Seen !== 'boolean' || !isCount(invalidSeen)) return null;
    const rule_id = 'spike-14-15';
    const n = outcomes.length;
    const fails = outcomes.filter((o) => FAIL_OUTCOMES.includes(o)).length;
    const certain = [];
    if (fails > SPIKE_SIZE - SPIKE_MIN_PASSES) {
      certain.push(['p̂', `${n - fails}/${n} passes: ${fails} failures > ${SPIKE_SIZE - SPIKE_MIN_PASSES}, p̂ cannot reach ${SPIKE_MIN_PASSES}/${SPIKE_SIZE}`]);
    }
    if (stage0Seen) certain.push(['stage0', 'Stage 0 seen']);
    if (spendUsd > SPIKE_SPEND_CAP_USD) certain.push(['spend', `spend ${usd(spendUsd)} > ${usd(SPIKE_SPEND_CAP_USD)}`]);
    const done = (verdict, reasons) => ({ verdict, rule_id, reasons, reason: reasons.join('; ') });
    if (certain.length > 0) return done(`no-go: ${certain[0][0]}`, certain.map(([, text]) => text));
    if (invalidSeen > SPIKE_MAX_INVALID) return done('inconclusive', [`${invalidSeen} invalid draws > ${SPIKE_MAX_INVALID}`]);
    if (n < SPIKE_SIZE) return done('pending', [`${n}/${SPIKE_SIZE} valid draws in, ${SPIKE_SIZE - n} remaining`]);
    return done('go', [`${n - fails}/${SPIKE_SIZE} passes >= ${SPIKE_MIN_PASSES}, no Stage 0, spend ${usd(spendUsd)} <= ${usd(SPIKE_SPEND_CAP_USD)}`]);
  } catch {
    return null;
  }
}

// One read per field, into a plain object; null if the record is not a well-formed probe draw.
function copyProbeDraw(d) {
  if (typeof d !== 'object' || d === null) return null;
  const c = { costUsd: d.costUsd, durationMin: d.durationMin, resumeFailed: d.resumeFailed, nonAnthropicHost: d.nonAnthropicHost, tokenHit: d.tokenHit };
  const ok = isAmount(c.costUsd) && isAmount(c.durationMin) && [c.resumeFailed, c.nonAnthropicHost, c.tokenHit].every((f) => typeof f === 'boolean');
  return ok ? c : null;
}

export function probeDecision(input) {
  try {
    const { draws, unit, invalidSeen } = input;
    if (!Array.isArray(draws)) return null;
    const len = draws.length; // read once, as in spikeDecision
    if (len > PROBE_SIZE) return null;
    const dense = denseOf(draws, len);
    const records = dense && dense.map(copyProbeDraw);
    if (!records || records.includes(null) || !UNITS.includes(unit) || !isCount(invalidSeen)) return null;
    const rule_id = 'probe-1a';
    const n = records.length;
    const stops = [];
    if (records.some((d) => d.costUsd > PROBE_COST_CAP_USD)) stops.push(`a draw cost > ${usd(PROBE_COST_CAP_USD)}`);
    if (records.some((d) => d.resumeFailed)) stops.push('--resume failed to carry the reply');
    if (records.some((d) => d.nonAnthropicHost)) stops.push('a non-Anthropic host was needed');
    if (records.some((d) => d.tokenHit)) stops.push('the literal token appeared in a record');
    if (invalidSeen > PROBE_MAX_INVALID) stops.push(`${invalidSeen} invalid draws > ${PROBE_MAX_INVALID}`);
    const slow = records.filter((d) => d.durationMin > PROBE_MEDIAN_CAP_MIN).length;
    const longest = Math.max(0, ...records.map((d) => d.durationMin));
    const switches = [];
    if (slow >= 2) switches.push(`${slow} of ${n} draws > ${PROBE_MEDIAN_CAP_MIN} min, so the median is over ${PROBE_MEDIAN_CAP_MIN}`);
    if (longest > PROBE_DRAW_CAP_MIN) switches.push(`a draw ran ${longest} min > ${PROBE_DRAW_CAP_MIN}`);
    if (switches.length > 0 && unit === 'code-loop') stops.push(`the fallback unit also tripped: ${switches.join('; ')}`);
    const done = (verdict, reasons) => ({ verdict, rule_id, reasons, reason: reasons.join('; ') });
    if (stops.length > 0) return done('stop', stops);
    if (switches.length > 0) return done('switch', switches);
    if (n < PROBE_SIZE) return done('pending', [`${n}/${PROBE_SIZE} valid draws in, ${PROBE_SIZE - n} remaining`]);
    return done('continue', [`all draws <= ${usd(PROBE_COST_CAP_USD)}, ${slow} of ${n} over ${PROBE_MEDIAN_CAP_MIN} min, longest ${longest} min`]);
  } catch {
    return null;
  }
}
