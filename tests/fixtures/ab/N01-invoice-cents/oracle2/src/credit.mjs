// SOMI-CANARY-N01-df51963559cd8805
import { totals } from './totals.mjs';

export function buildCreditNote(lines) {
  const { net, tax } = totals(lines);
  return { net: 0 - net / 100, tax: 0 - tax / 100, gross: 0 - (net + tax) / 100 };
}
