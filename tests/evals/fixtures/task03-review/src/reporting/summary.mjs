import { fmtAmt } from '../util/format.mjs';

export function monthlySummary(rows) {
  const gross = rows.reduce((a, r) => a + r.grossMinor, 0);
  const refunds = rows.reduce((a, r) => a + r.refundMinor, 0);
  return [
    `Gross     ${fmtAmt(gross)}`,
    `Refunds   ${fmtAmt(refunds)}`,
    `Net       ${fmtAmt(gross - refunds)}`,
  ].join('\n');
}
export function tenantLine(t) {
  return `${t.id.padEnd(16)} ${fmtAmt(t.mrrMinor)} MRR  ${fmtAmt(t.arrMinor)} ARR`;
}
export function deltaLine(prev, next) {
  const d = next - prev;
  return `${d >= 0 ? '+' : ''}${fmtAmt(d)}`;
}
