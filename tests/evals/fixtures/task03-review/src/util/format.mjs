/** Format minor units as a currency string. */
export function fmtAmt(minorUnits, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency })
    .format(minorUnits / 100);
}
