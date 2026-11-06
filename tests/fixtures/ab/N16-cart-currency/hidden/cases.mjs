// SOMI-CANARY-N16-4965ec5f0738067b
const RATES = { USD: 1, EUR: 1.25, JPY: 0.01, KWD: 3.25 };
const T = (lines, target, rates = RATES) => async (l) => { const r = (await l('src/cart.mjs')).cartTotal(lines, target, rates); return [r.total, r.currency, r.display]; };
const code = (lines, target, rates = RATES) => async (l) => { try { (await l('src/cart.mjs')).cartTotal(lines, target, rates); return null; } catch (e) { return [e.status, e.code]; } };
const L = (amount, currency) => ({ amount, currency });
const F = (a, c) => async (l) => (await l('src/format.mjs')).formatMoney(a, c);
export const cases = [
  { name: 'AC1 [functional] euros to dollars', run: T([L(1000, 'EUR')], 'USD'), expect: [1250, 'USD', '$12.50'] },
  { name: 'AC3 [functional] dollars to yen, which has no decimals', run: T([L(1234, 'USD')], 'JPY'), expect: [1234, 'JPY', '¥1234'] },
  { name: 'AC3 [functional] yen to dollars', run: T([L(1234, 'JPY')], 'USD'), expect: [1234, 'USD', '$12.34'] },
  { name: 'AC3 [functional] dollars to dinars, which have three decimals', run: T([L(325, 'USD')], 'KWD'), expect: [1000, 'KWD', 'KD 1.000'] },
  { name: 'AC3 [functional] dinars to euros', run: T([L(1000, 'KWD')], 'EUR'), expect: [260, 'EUR', '€2.60'] },
  { name: 'AC3 [boundary] each line is rounded on its own', run: T([L(1, 'EUR'), L(1, 'EUR'), L(1, 'EUR')], 'USD'), expect: [3, 'USD', '$0.03'] },
  { name: 'AC3 [boundary] a half goes away from zero', run: T([L(2, 'EUR')], 'USD'), expect: [3, 'USD', '$0.03'] },
  { name: 'AC3 [boundary] a negative half goes away from zero', run: T([L(1000, 'USD'), L(-2, 'EUR')], 'USD'), expect: [997, 'USD', '$9.97'] },
  { name: 'AC3 [boundary] a total under the unit shows its sign and leading zeros', run: T([L(-5, 'USD')], 'USD'), expect: [-5, 'USD', '-$0.05'] },
  { name: 'AC2 [boundary] a line in an unknown currency is refused', run: code([L(1, 'XXX')], 'USD', { ...RATES, XXX: 1 }), expect: [422, 'unknown_currency'] },
  { name: 'AC2 [boundary] a currency with no rate is refused', run: code([L(1, 'KWD')], 'USD', { USD: 1 }), expect: [422, 'unknown_currency'] },
  { name: 'AC2 [boundary] an unknown target is refused', run: code([], 'XXX', { ...RATES, XXX: 1 }), expect: [422, 'unknown_currency'] },
  { name: 'AC2 [safety] [unprompted] a name from the object prototype is not a currency', run: code([L(1, 'constructor')], 'USD'), expect: [422, 'unknown_currency'] },
  { name: 'AC3 [functional] an empty cart is zero', run: T([], 'JPY'), expect: [0, 'JPY', '¥0'] },
  { name: 'AC3 [functional] the formatter handles yen', run: F(1500, 'JPY'), expect: '¥1500' },
  { name: 'AC3 [functional] the formatter handles dinars', run: F(1500, 'KWD'), expect: 'KD 1.500' },
  { name: 'AC3 [regression] the formatter keeps dollars', run: F(-1234, 'USD'), expect: '-$12.34' },
];
