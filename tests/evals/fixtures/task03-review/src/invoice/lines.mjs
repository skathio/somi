import { fmtAmt } from '../util/format.mjs';

export function renderLine(item) {
  return `${item.name.padEnd(28)} ${fmtAmt(item.minorUnits)}`;
}
export function renderSubtotal(items) {
  const total = items.reduce((a, i) => a + i.minorUnits, 0);
  return `${'Subtotal'.padEnd(28)} ${fmtAmt(total)}`;
}
export function renderTax(subtotalMinor, rate) {
  return `${'Tax'.padEnd(28)} ${fmtAmt(Math.round(subtotalMinor * rate))}`;
}
export function renderTotal(subtotalMinor, taxMinor) {
  return `${'Total'.padEnd(28)} ${fmtAmt(subtotalMinor + taxMinor)}`;
}
export function renderCredit(creditMinor) {
  return `${'Credit applied'.padEnd(28)} -${fmtAmt(creditMinor)}`;
}
