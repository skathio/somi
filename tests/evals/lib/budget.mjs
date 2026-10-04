// Pre-registered budget (FR-0) and gate-run envelope (FR-0b). Pure functions over explicit inputs.
// The committed config tests/evals/budget.json is validated against the frozen PREREGISTERED table
// below; a re-registration is therefore a deliberate two-file diff. The table is checked against the
// requirements text only by the opt-in script tests/scripts/manual/budget-crosscheck.sh, never by
// `npm test`, because the requirements live in a gitignored folder a fresh clone does not have.
//
// Nine figures: eight are pre-registered (USD, minutes, hours, counts); the ninth,
// `inFlightCeilingUsd`, is DERIVED -- the per-run cap plus one full per-draw cap for every draw that
// can still be in flight when the running abort fires (FR-0b: $144 + 3 x $8 = $168). It is computed
// here, never typed, and a config that carries a different value is refused.
//
// Shapes. validateBudget has no `null` case: every input that is not exactly the table (absent,
// non-object, unreadable, a missing / mistyped / unequal figure, an extra key) is a REFUSAL naming the
// fields, so a harness that only checks `verdict === 'valid'` cannot start on a bad config.
// drawVerdictByBudget and envelopeStep return `null` for a malformed input, never a throw.
//
// validateBudget(config) -> {verdict: 'valid'|'refused', rule_id: 'budget-config', fields[], reason}
//
// drawVerdictByBudget({costUsd, durationMin}) -> {verdict, rule_id: 'draw-budget', outcome, reasons[], reason}
//   costUsd and durationMin are finite numbers >= 0 (USD, MINUTES: the same field names and units as
//   probeDecision, so milliseconds cannot be passed by mistake). Both comparisons are strict `>`:
//   exactly $8.00 or exactly 40:00 is within budget. Verdict `within-budget` or `fail: over-budget`
//   (over budget is a failed draw). `outcome` is the arm token for armVerdict: `over-budget` (a member of
//   FAIL_OUTCOMES, so the arm counts it as a failure) or `null` when within budget.
//
// envelopeStep({draws, invalidReplacements, elapsedMs, spendUsd, inFlight})
//   -> {verdict: 'continue'|'abort: draws'|'abort: time'|'abort: spend', rule_id: 'envelope',
//       ceilingUsd, reasons[], reason}
//   draws                valid draws finished so far (integer >= 0).
//   invalidReplacements  invalid draws finished so far, replaced or not (integer >= 0).
//   elapsedMs            wall clock since the run's clock started (finite >= 0, MILLISECONDS).
//   spendUsd             actual spend so far, every draw included (finite >= 0).
//   inFlight             draws launched and not finished (integer 0..runConcurrent; more than the
//                        concurrency cap is a harness bug, so it is `null`, not a verdict).
//   Meant to be called after EVERY draw. Any one trigger aborts the run with no verdict:
//     draws  invalidReplacements + max(ARM_SIZE, draws + inFlight) > runDraws: a verdict needs ARM_SIZE
//            valid candidate draws, so once the invalid ones leave no room no verdict is possible. Keeping
//            18 valid draws inside the envelope once triage starts is the caller's job. The per-spike (5)
//            and per-smoke (2) invalid caps are not gate-run rules and are not enforced here;
//     time   elapsedMs > perRunHours (strict: exactly 4 h is still inside);
//     spend  spendUsd > perRunUsd, or spendUsd == perRunUsd while anything could still spend (a draw
//            in flight, or a draw still allowed). A finished run that spent exactly the cap with every
//            allowed draw done is NOT aborted: nothing more can be spent, so it would only discard a
//            complete verdict. The abort can overshoot by the in-flight draws, so a spend abort always
//            reports the derived hard ceiling; spend past that ceiling is an invariant breach and aborts too.
//            Money is compared in whole cents, so summed float noise cannot turn exactly $144 into an abort.
//   `verdict` names the PRIMARY trigger (order draws, time, spend); `reasons` lists every trigger that
//   fired, each with its figure and ceiling. `continue` carries the ceiling too.
//
// Rule for the future runner (carried from the decision functions, not enforced here, since this
// module calls none of them): armVerdict, smokeAdmit, retireDecision, rollingFeed, spikeDecision,
// probeDecision, triage and rerunAllowed all return `null` on a malformed input. A `null` from any of
// them is a hard, fail-closed error that stops the run. It must NEVER be treated as "no decision yet"
// and re-drawn: a re-draw spends credits, and a draw that is re-run until the shape happens to pass
// is a selected draw.

import { ARM_SIZE, FAIL_OUTCOMES } from './rules.mjs';

const HOUR_MS = 3_600_000;

// The pre-registered figures. Key order here is the key order of budget.json.
const REGISTERED = {
  perDrawUsd: 8, // USD per draw (total_cost_usd)
  perDrawMin: 40, // minutes per draw, end to end
  perRunUsd: 144, // 18 draws x $8
  perRunHours: 4, // worst case including triage
  runDraws: 18, // candidate + triage + invalid replacements
  runConcurrent: 3, // draw containers
  phase1Usd: 208, // actual-spend cap for the one-time phase (FR-0)
  replacementSmokeUsd: 56, // FR-0: <= 7 draws x $8
};

export const PREREGISTERED = Object.freeze({
  ...REGISTERED,
  inFlightCeilingUsd: REGISTERED.perRunUsd + REGISTERED.runConcurrent * REGISTERED.perDrawUsd, // derived
});

const KEYS = Object.keys(PREREGISTERED);
const RUN_MS = PREREGISTERED.perRunHours * HOUR_MS;

const isCount = (x) => Number.isInteger(x) && x >= 0;
const isAmount = (x) => Number.isFinite(x) && x >= 0;
const cents = (x) => Math.round(x * 100); // callers pass finite amounts
const OVER_BUDGET = FAIL_OUTCOMES.find((o) => o === 'over-budget'); // the arm token
const usd = (x) => `$${x.toFixed(2)}`; // text only: comparisons use the raw value

export function validateBudget(config) {
  const refuse = (fields, reason) => ({ verdict: 'refused', rule_id: 'budget-config', fields, reason });
  try {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      return refuse(['config'], 'budget config absent or not an object');
    }
    // One read per key into a prototype-less copy (a JSON `__proto__` key stays plain data). Symbol and
    // non-enumerable extra keys are unreachable from JSON.parse, so Object.keys is enough.
    const copy = Object.create(null);
    for (const key of Object.keys(config)) copy[key] = config[key];
    const bad = [];
    const notes = [];
    for (const key of KEYS) {
      if (!Object.hasOwn(copy, key)) { bad.push(key); notes.push(`${key} missing`); continue; }
      const want = PREREGISTERED[key];
      if (typeof copy[key] !== 'number' || copy[key] !== want) {
        bad.push(key);
        const kind = key === 'inFlightCeilingUsd' ? 'derived, not settable: ' : '';
        notes.push(`${key} ${kind}want ${want}, got ${typeof copy[key] === 'number' ? copy[key] : typeof copy[key]}`);
      }
    }
    for (const key of Object.keys(copy)) {
      if (!KEYS.includes(key)) { bad.push(key); notes.push(`${key} is not a registered figure`); }
    }
    if (bad.length > 0) return refuse(bad, notes.join('; '));
    return { verdict: 'valid', rule_id: 'budget-config', fields: [], reason: `all ${KEYS.length} figures match the pre-registered table` };
  } catch {
    return refuse(['config'], 'budget config unreadable');
  }
}

export function drawVerdictByBudget(draw) {
  try {
    if (typeof draw !== 'object' || draw === null) return null;
    const { costUsd, durationMin } = draw; // one read each; decide on the locals
    if (!isAmount(costUsd) || !isAmount(durationMin)) return null;
    const over = [];
    if (cents(costUsd) > cents(PREREGISTERED.perDrawUsd)) over.push(`cost ${usd(costUsd)} > ${usd(PREREGISTERED.perDrawUsd)}`);
    if (durationMin > PREREGISTERED.perDrawMin) over.push(`duration ${durationMin} min > ${PREREGISTERED.perDrawMin} min`);
    const rule_id = 'draw-budget';
    if (over.length > 0) return { verdict: 'fail: over-budget', rule_id, outcome: OVER_BUDGET, reasons: over, reason: over.join('; ') };
    const within = `cost ${usd(costUsd)} <= ${usd(PREREGISTERED.perDrawUsd)}, duration ${durationMin} min <= ${PREREGISTERED.perDrawMin} min`;
    return { verdict: 'within-budget', rule_id, outcome: null, reasons: [within], reason: within };
  } catch {
    return null;
  }
}

export function envelopeStep(input) {
  try {
    const { draws, invalidReplacements, elapsedMs, spendUsd, inFlight } = input; // one read each
    if (!isCount(draws) || !isCount(invalidReplacements) || !isAmount(elapsedMs) || !isAmount(spendUsd)) return null;
    if (!isCount(inFlight) || inFlight > PREREGISTERED.runConcurrent) return null;
    const { runDraws, perRunUsd, perRunHours, inFlightCeilingUsd } = PREREGISTERED;
    const needed = Math.max(ARM_SIZE, draws + inFlight); // valid draws the run has to hold
    const launched = draws + invalidReplacements + inFlight;
    const mayStillSpend = inFlight > 0 || launched < runDraws;
    const spent = cents(spendUsd);
    const fired = [];
    if (invalidReplacements + needed > runDraws) {
      fired.push(['draws', `${invalidReplacements} invalid + ${needed} valid (a verdict needs ${ARM_SIZE}) = ${invalidReplacements + needed} draws > ${runDraws}`]);
    }
    if (elapsedMs > RUN_MS) fired.push(['time', `elapsed ${elapsedMs} ms > ${perRunHours} h (${RUN_MS} ms)`]);
    if (spent > cents(inFlightCeilingUsd)) {
      fired.push(['spend', `spend ${usd(spendUsd)} is past the hard ceiling ${usd(inFlightCeilingUsd)}: invariant breach`]);
    } else if (spent > cents(perRunUsd) || (spent === cents(perRunUsd) && mayStillSpend)) {
      fired.push(['spend', `spend ${usd(spendUsd)} reached the ${usd(perRunUsd)} cap with ${inFlight} in flight (hard ceiling ${usd(inFlightCeilingUsd)})`]);
    }
    const rule_id = 'envelope';
    if (fired.length > 0) {
      const reasons = fired.map(([, text]) => text);
      return { verdict: `abort: ${fired[0][0]}`, rule_id, ceilingUsd: inFlightCeilingUsd, reasons, reason: reasons.join('; ') };
    }
    const ok = `${invalidReplacements + needed}/${runDraws} draws, elapsed ${elapsedMs} ms <= ${RUN_MS} ms, spend ${usd(spendUsd)} <= ${usd(perRunUsd)}`;
    return { verdict: 'continue', rule_id, ceilingUsd: inFlightCeilingUsd, reasons: [ok], reason: ok };
  } catch {
    return null;
  }
}
