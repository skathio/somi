// Mutant-spread check for micro tasks. A task's plausible-wrong solutions (its .mutants.json, applied to the oracle) must fail
// a believable share of the hidden cases, so that a partial solution can land between 40% and 90%. The rule:
//   - at least MIN_MUTANTS mutants;
//   - no mutant fails fewer than 5% of the cases (an equivalent mutant, failing none, is reported by name) or more than 90%;
//   - bands over the failed fraction: 5-20% (low end inclusive), 20-40%, 40-60% (60% inclusive) must each hold at least one
//     mutant; a mutant between 60% and 90% is allowed and shown as its own band.
// The mutants are run by admitTask (the existing scorer path: oracle, oracle2, nop, then every mutant through scoreHidden);
// this module only reads its result. Pure apart from mutantSpread, which calls admitTask. No model call, no network.

import { admitTask } from './admit.mjs';

export const SPREAD = Object.freeze({ MIN_MUTANTS: 6, MIN_FRACTION: 0.05, MAX_FRACTION: 0.9 });
export const BANDS = Object.freeze([
  { name: '5-20%', required: true, test: (f) => f >= 0.05 && f < 0.2 },
  { name: '20-40%', required: true, test: (f) => f >= 0.2 && f < 0.4 },
  { name: '40-60%', required: true, test: (f) => f >= 0.4 && f <= 0.6 },
  { name: '60-90%', required: false, test: (f) => f > 0.6 && f <= 0.9 },
]);

const isCount = (x) => Number.isInteger(x) && x >= 0;
/** The band name of a failed fraction, or 'out of range' below 5% and above 90%. */
export const bandOf = (f) => BANDS.find((b) => b.test(f))?.name ?? 'out of range';

/**
 * rows: [{name, failed, total}] (failed and total are counts) -> {ok, reasons, table}. `table` has one entry per mutant:
 * {name, failed, total, fraction, band}. Fractions are compared as integers (failed * 100 against total * the percent), so a
 * boundary value is never lost to rounding.
 */
export function evaluateSpread(rows) {
  if (!Array.isArray(rows) || rows.some((r) => r === null || typeof r !== 'object' || typeof r.name !== 'string' || !isCount(r.failed) || !isCount(r.total) || r.total === 0 || r.failed > r.total)) return { ok: false, reasons: ['the mutant rows are malformed'], table: [] };
  const exact = (r, num, den) => r.failed * den >= r.total * num; // failed/total >= num/den
  const bandExact = (r) => {
    if (r.failed === 0) return 'equivalent';
    if (!exact(r, 5, 100)) return 'out of range';
    if (!exact(r, 20, 100)) return '5-20%';
    if (!exact(r, 40, 100)) return '20-40%';
    if (r.failed * 100 <= r.total * 60) return '40-60%';
    return r.failed * 100 <= r.total * 90 ? '60-90%' : 'out of range';
  };
  const table = rows.map((r) => ({ name: r.name, failed: r.failed, total: r.total, fraction: r.failed / r.total, band: bandExact(r) }));
  const reasons = [];
  if (table.length < SPREAD.MIN_MUTANTS) reasons.push(`${table.length} mutants, at least ${SPREAD.MIN_MUTANTS} are needed`);
  for (const t of table) {
    if (t.band === 'equivalent') reasons.push(`${t.name} fails no case (an equivalent mutant: change it or drop it)`);
    else if (t.band === 'out of range') reasons.push(`${t.name} fails ${t.failed}/${t.total} (${(t.fraction * 100).toFixed(1)}%): outside 5% to 90%`);
  }
  for (const b of BANDS.filter((x) => x.required)) if (!table.some((t) => t.band === b.name)) reasons.push(`no mutant in the ${b.name} band`);
  return { ok: reasons.length === 0, reasons, table };
}

/** An admitTask result -> evaluateSpread of its killed mutants; a refused admission is a failed spread with that reason. */
export function spreadFromAdmission(admission) {
  if (admission === null || typeof admission !== 'object' || admission.ok !== true) return { ok: false, reasons: [`admission refused: ${admission?.reason ?? 'no result'}`], table: [] };
  return evaluateSpread(admission.mutantsKilled.map((m) => ({ name: m.name, failed: m.failed.length, total: admission.total })));
}

/** Run a task's mutants once through admitTask (repeats 1) and evaluate the spread. */
export function mutantSpread(taskDir, mutants, opts = {}) {
  return spreadFromAdmission(admitTask(taskDir, { mutants, repeats: 1, ...opts }));
}

/** The per-task table as text: one line per mutant, then the verdict. */
export function formatSpread(taskName, spread) {
  const lines = spread.table.map((t) => `    ${t.name.padEnd(28)} ${String(t.failed).padStart(3)}/${String(t.total).padEnd(3)} ${(t.fraction * 100).toFixed(1).padStart(5)}%  ${t.band}`);
  return [`  spread ${taskName}: ${spread.ok ? 'ok' : 'FAILED'}`, ...lines, ...spread.reasons.map((r) => `    ! ${r}`)].join('\n');
}
