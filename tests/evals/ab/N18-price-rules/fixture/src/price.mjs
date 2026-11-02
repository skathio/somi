export function priceCart(cart) {
  let subtotal = 0;
  for (const item of cart.items) subtotal += item.qty * item.unit;
  let discount = 0;
  const applied = [];
  if (cart.coupon === 'TEN' && subtotal >= 10) { discount += Math.floor(subtotal * 0.1); applied.push('ten'); }
  if (cart.coupon === 'FIVEOFF' && subtotal >= 1000) { discount += 500; applied.push('fiveOff'); }
  if (cart.items.length >= 5) { discount += 100; applied.push('bulk'); }
  if (cart.vip) {
    const best = Math.max(discount, Math.floor(subtotal * 0.15));
    if (best !== discount) applied.push('vip');
    discount = best;
  }
  if (discount > subtotal) discount = subtotal;
  let shipping = subtotal - discount >= 5000 ? 0 : 499;
  if (cart.pickup) shipping = 0;
  const tax = Math.round((subtotal - discount) * 0.08);
  return { subtotal, discount, shipping, tax, total: subtotal - discount + shipping + tax, applied };
}
