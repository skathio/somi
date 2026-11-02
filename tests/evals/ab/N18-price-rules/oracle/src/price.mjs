// SOMI-CANARY-N18-6f814399f074279e
import { rules } from './rules.mjs';

export function priceCart(cart) {
  let subtotal = 0;
  for (const item of cart.items) subtotal += item.qty * item.unit;
  let discount = 0;
  const applied = [];
  for (const rule of rules) {
    const next = rule.apply(cart, subtotal, discount);
    if (next !== discount) applied.push(rule.name);
    discount = next;
  }
  if (discount > subtotal) discount = subtotal;
  let shipping = subtotal - discount >= 5000 ? 0 : 499;
  if (cart.pickup) shipping = 0;
  const tax = Math.round((subtotal - discount) * 0.08);
  return { subtotal, discount, shipping, tax, total: subtotal - discount + shipping + tax, applied };
}
