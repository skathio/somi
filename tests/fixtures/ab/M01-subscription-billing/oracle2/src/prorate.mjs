// SOMI-CANARY-M01-749043d973a32ba5
import { PERIOD_DAYS } from './store.mjs';

// Integer arithmetic only. The customer's side of a fraction of a cent wins: refunds and credits up, charges down.
export function prorated(priceCents, days, side) {
  const scaled = priceCents * days;
  const whole = (scaled - (scaled % PERIOD_DAYS)) / PERIOD_DAYS;
  return side === 'owed' && scaled % PERIOD_DAYS !== 0 ? whole + 1 : whole;
}
