import { fmtAmt } from '../util/format.mjs';

// Date.UTC throughout: a local-constructor + getUTCDate() mix reports a day short east of UTC.
function daysInMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Credit owed when a plan changes mid-month, in minor units.
 * Charges for days actually used; credits the remainder.
 */
export function prorate(oldPlanMinor, newPlanMinor, changeDate) {
  const dim = daysInMonth(changeDate);
  const dayOfMonth = changeDate.getUTCDate();
  const remaining = dim - dayOfMonth + 1;
  const credit = Math.round((oldPlanMinor * remaining) / dim);
  const charge = Math.round((newPlanMinor * remaining) / dim);
  return { credit, charge, net: charge - credit, display: fmtAmt(charge - credit) };
}
