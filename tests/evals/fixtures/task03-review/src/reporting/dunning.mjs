import { fmtAmt } from '../util/format.mjs';

export function overdueNotice(tenant, amountMinor, days) {
  return `${tenant}: ${fmtAmt(amountMinor)} overdue by ${days} days`;
}
export function escalation(tenant, amountMinor) {
  return `${tenant}: escalating ${fmtAmt(amountMinor)} to collections`;
}
export function writeOff(tenant, amountMinor) {
  return `${tenant}: writing off ${fmtAmt(amountMinor)}`;
}
