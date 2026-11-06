// SOMI-CANARY-N18-6f814399f074279e
const P = (cart) => async (l) => (await l('src/price.mjs')).priceCart(cart);
const I = (n, unit = 100, qty = 1) => Array.from({ length: n }, () => ({ qty, unit }));
const pick = (cart, ...keys) => async (l) => { const r = (await l('src/price.mjs')).priceCart(cart); return keys.map((k) => r[k]); };
export const cases = [
  { name: 'AC1 [functional] the rules are exported in order', run: async (l) => (await l('src/rules.mjs')).rules.map((r) => r.name), expect: ['ten', 'fiveOff', 'bulk', 'vip', 'loyalty'] },
  { name: 'AC1 [functional] a rule takes the cart, subtotal and discount', run: async (l) => (await l('src/rules.mjs')).rules.find((r) => r.name === 'bulk').apply({ items: I(5) }, 500, 7), expect: 107 },
  { name: 'AC2 [functional] loyalty adds 2% rounded down', run: pick({ items: I(1, 1099), years: 3 }, 'discount', 'applied'), expect: [21, ['loyalty']] },
  { name: 'AC2 [regression] under three years gets nothing', run: pick({ items: I(1, 10000), years: 2 }, 'discount', 'applied'), expect: [0, []] },
  { name: 'AC2 [boundary] loyalty sits on top of the VIP best-of', run: pick({ items: I(1, 10000), vip: true, years: 5, coupon: 'TEN' }, 'discount', 'applied'), expect: [1700, ['ten', 'vip', 'loyalty']] },
  { name: 'AC2 [boundary] the cap still holds with loyalty', run: pick({ items: I(1, 400), years: 3, coupon: 'FIVEOFF' }, 'discount'), expect: [8] },
  { name: 'AC2 [regression] a tiny cart earns no loyalty entry', run: pick({ items: I(1, 10), years: 9 }, 'discount', 'applied'), expect: [0, []] },
  { name: 'AC3 [regression] coupons do not stack with each other but do with bulk', run: pick({ items: I(5, 1000), coupon: 'TEN' }, 'discount', 'applied'), expect: [600, ['ten', 'bulk']] },
  { name: 'AC3 [regression] the fixed coupon needs a thousand cents', run: pick({ items: I(1, 999), coupon: 'FIVEOFF' }, 'discount', 'applied'), expect: [0, []] },
  { name: 'AC3 [regression] bulk counts lines, not units', run: pick({ items: I(1, 100, 9) }, 'discount', 'applied'), expect: [0, []] },
  { name: 'AC3 [regression] VIP is the better of, not added', run: pick({ items: I(1, 10000), vip: true, coupon: 'TEN' }, 'discount', 'applied'), expect: [1500, ['ten', 'vip']] },
  { name: 'AC3 [regression] VIP is not listed when it does not improve', run: pick({ items: I(1, 2000), vip: true, coupon: 'FIVEOFF' }, 'discount', 'applied'), expect: [500, ['fiveOff']] },
  { name: 'AC3 [regression] a rule that changes nothing is not listed', run: pick({ items: I(1, 5), coupon: 'TEN' }, 'discount', 'applied'), expect: [0, []] },
  { name: 'AC3 [regression] the cap lands after the rules', run: pick({ items: I(5, 100), vip: true }, 'discount', 'applied', 'shipping', 'tax'), expect: [100, ['bulk'], 499, 32] },
  { name: 'AC3 [regression] free shipping looks at the net', run: pick({ items: I(1, 5100), coupon: 'FIVEOFF' }, 'shipping', 'total'), expect: [499, 5100 - 500 + 499 + 368] },
  { name: 'AC3 [regression] pickup ships free and tax skips shipping', run: pick({ items: I(1, 1000), pickup: true }, 'shipping', 'tax', 'total'), expect: [0, 80, 1080] },
  { name: 'AC3 [regression] the whole answer keeps its shape', run: async (l) => Object.keys((await l('src/price.mjs')).priceCart({ items: [] })), expect: ['subtotal', 'discount', 'shipping', 'tax', 'total', 'applied'] },
];
