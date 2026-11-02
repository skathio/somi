// SOMI-CANARY-N01-df51963559cd8805
const inv = (lines) => async (load) => (await load('src/invoice.mjs')).buildInvoice(lines);
const cred = (lines) => async (load) => { const t = (await load('src/credit.mjs')).buildCreditNote(lines); return { net: t.net + 0, tax: t.tax + 0, gross: t.gross + 0 }; };
const L = (qty, unit, rate) => ({ qty, unit, rate });
export const cases = [
  { name: 'AC2 [functional] tax is worked out per rate group, not per line', run: inv([L(1, 0.07, 0.1), L(1, 0.07, 0.1), L(1, 0.07, 0.1)]), expect: { net: 0.21, tax: 0.02, gross: 0.23 } },
  { name: 'AC2 [functional] groups at different rates are rounded on their own', run: inv([L(1, 0.25, 0.1), L(1, 0.25, 0.1), L(1, 0.15, 0.2)]), expect: { net: 0.65, tax: 0.08, gross: 0.73 } },
  { name: 'AC2 [boundary] a tie goes down to the even cent', run: inv([L(1, 1.05, 0.1)]), expect: { net: 1.05, tax: 0.1, gross: 1.15 } },
  { name: 'AC2 [boundary] a tie goes up to the even cent', run: inv([L(1, 1.5, 0.05), L(1, 1.5, 0.05), L(1, 1.5, 0.05)]), expect: { net: 4.5, tax: 0.22, gross: 4.72 } },
  { name: 'AC2 [boundary] a tie hidden by a binary fraction is still a tie', run: inv([L(1, 1.5, 0.07)]), expect: { net: 1.5, tax: 0.1, gross: 1.6 } },
  { name: 'AC3 [regression] a price that is not exact in binary keeps its cents', run: inv([L(3, 1.15, 0.2)]), expect: { net: 3.45, tax: 0.69, gross: 4.14 } },
  { name: 'AC2 [functional] the credit note follows the same rule', run: cred([L(1, 0.07, 0.1), L(1, 0.07, 0.1), L(1, 0.07, 0.1)]), expect: { net: -0.21, tax: -0.02, gross: -0.23 } },
  { name: 'AC2 [boundary] a tie on a credit note is the exact negative', run: cred([L(1, 1.05, 0.1)]), expect: { net: -1.05, tax: -0.1, gross: -1.15 } },
  { name: 'AC3 [regression] format keeps its output', run: async (load) => (await load('src/format.mjs')).formatTotals({ net: 1, tax: 0.2, gross: 1.2 }), expect: { net: '$1.00', tax: '$0.20', gross: '$1.20' } },
  { name: 'AC3 [regression] a plain invoice is unchanged', run: inv([L(1, 10, 0.2)]), expect: { net: 10, tax: 2, gross: 12 } },
];
