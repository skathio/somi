// SOMI-CANARY-L1-60349bdfbf51ffa8
import { cartTotal } from './cart.mjs';
import { discountFor } from './coupons.mjs';
import { returnStock, takeStock } from './inventory.mjs';
import { chargeCard } from './payments.mjs';

export function placeOrder(store, cart, customerId, couponCode) {
  const subtotal = cartTotal(store, cart);
  let discount = 0;
  if (couponCode !== undefined) {
    const d = discountFor(store, couponCode, subtotal);
    if (!d.ok) return d;
    discount = d.value;
  }
  const taken = [];
  const savedHolds = store.reservations.map((r) => ({ ...r }));
  const undo = () => { for (const l of taken) returnStock(store, l.sku, l.qty); store.reservations = savedHolds; };
  for (const l of cart.lines) {
    if (!takeStock(store, l.sku, l.qty, customerId)) { undo(); return { ok: false, error: { code: 'out_of_stock' } }; }
    taken.push(l);
  }
  const charge = chargeCard(store, customerId, subtotal - discount);
  if (!charge.ok) { undo(); return charge; }
  const order = { id: store.nextId(), customerId, lines: cart.lines.map((l) => ({ ...l })), total: subtotal - discount, status: 'paid', paymentId: charge.value.id, at: store.clock() };
  store.orders.push(order);
  store.audit.push({ type: 'order.placed', at: store.clock(), orderId: order.id });
  return { ok: true, value: order };
}
