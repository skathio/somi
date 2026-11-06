// SOMI-CANARY-N01-df51963559cd8805
import { ledgerTotals } from './money.mjs';

export function buildCreditNote(lines) {
  const t = ledgerTotals(lines);
  return { net: -t.net, tax: -t.tax, gross: -t.gross };
}
