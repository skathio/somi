// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Rounding of amounts. Everything that rounds goes through one of these two.

export const digitsOf = (currency) => (currency === 'JPY' ? 0 : 2);
const scaleOf = (digits) => (digits === 0 ? 1 : 100);

// scale up, Math.round (halves go up), scale down
export const scaled = (x, digits) => {
  const s = scaleOf(digits);
  return Math.round(x * s) / s;
};

// through the decimal string
export const viaString = (x, digits) => Number(x.toFixed(digits));

// the rounding function for a currency, bound to its digits
export const roundFor = (currency) => {
  const d = digitsOf(currency);
  return (x) => scaled(x, d);
};
