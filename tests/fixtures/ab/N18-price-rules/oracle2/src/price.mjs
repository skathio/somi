// SOMI-CANARY-N18-6f814399f074279e
import { rules } from './rules.mjs';

export function priceCart(cart) {
  const subtotal = cart.items.reduce((s, i) => s + i.qty * i.unit, 0);
  const applied = [];
  const raw = rules.reduce((discount, rule) => {
    const after = rule.apply(cart, subtotal, discount);
    if (after !== discount) applied.push(rule.name);
    return after;
  }, 0);
  const discount = Math.min(raw, subtotal);
  const net = subtotal - discount;
  const shipping = cart.pickup || net >= 5000 ? 0 : 499;
  const tax = Math.round(net * 0.08);
  return { subtotal, discount, shipping, tax, total: net + shipping + tax, applied };
}
