// SOMI-CANARY-N01-df51963559cd8805
import { totals } from './totals.mjs';

export function buildInvoice(lines) {
  const { net, tax } = totals(lines);
  return { net: net / 100, tax: tax / 100, gross: (net + tax) / 100 };
}
