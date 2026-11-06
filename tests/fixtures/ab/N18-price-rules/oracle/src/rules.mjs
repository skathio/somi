// SOMI-CANARY-N18-6f814399f074279e
const ten = { name: 'ten', apply: (cart, subtotal, discount) => (cart.coupon === 'TEN' ? discount + Math.floor(subtotal * 0.1) : discount) };
const fiveOff = { name: 'fiveOff', apply: (cart, subtotal, discount) => (cart.coupon === 'FIVEOFF' && subtotal >= 1000 ? discount + 500 : discount) };
const bulk = { name: 'bulk', apply: (cart, subtotal, discount) => (cart.items.length >= 5 ? discount + 100 : discount) };
const vip = { name: 'vip', apply: (cart, subtotal, discount) => (cart.vip ? Math.max(discount, Math.floor(subtotal * 0.15)) : discount) };
const loyalty = { name: 'loyalty', apply: (cart, subtotal, discount) => (cart.years >= 3 ? discount + Math.floor(subtotal * 0.02) : discount) };

export const rules = [ten, fiveOff, bulk, vip, loyalty];
