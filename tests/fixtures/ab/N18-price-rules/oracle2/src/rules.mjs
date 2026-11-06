// SOMI-CANARY-N18-6f814399f074279e
const add = (name, when, amount) => ({ name, apply: (cart, subtotal, discount) => (when(cart, subtotal) ? discount + amount(subtotal) : discount) });

export const rules = [
  add('ten', (c) => c.coupon === 'TEN', (s) => Math.floor(s / 10)),
  add('fiveOff', (c, s) => c.coupon === 'FIVEOFF' && s >= 1000, () => 500),
  add('bulk', (c) => c.items.length >= 5, () => 100),
  { name: 'vip', apply: (c, s, d) => (c.vip && Math.floor(s * 0.15) > d ? Math.floor(s * 0.15) : d) },
  add('loyalty', (c) => c.years >= 3, (s) => Math.floor(s * 0.02)),
];
