// SOMI-CANARY-L1-60349bdfbf51ffa8
import { cartTotal } from './cart.mjs';
import { couponOff } from './coupons.mjs';
import { returnStock, takeStock } from './inventory.mjs';
import { chargeCard } from './payments.mjs';

const fail = (code) => ({ ok: false, error: { code } });

export function placeOrder(store, cart, customerId, coupon) {
  const before = cartTotal(store, cart);
  const off = coupon === undefined ? 0 : couponOff(store, coupon, before);
  if (off === null) return fail('bad_coupon');
  const holds = JSON.stringify(store.reservations);
  const done = [];
  const rollback = () => { done.forEach((l) => returnStock(store, l.sku, l.qty)); store.reservations = JSON.parse(holds); };
  for (const line of cart.lines) {
    if (!takeStock(store, line.sku, line.qty, customerId)) { rollback(); return fail('out_of_stock'); }
    done.push(line);
  }
  const paid = chargeCard(store, customerId, before - off);
  if (!paid.ok) { rollback(); return paid; }
  const order = { id: store.nextId(), customerId, lines: structuredClone(cart.lines), total: before - off, status: 'paid', paymentId: paid.value.id, at: store.clock() };
  store.orders.push(order);
  store.audit.push({ type: 'order', at: store.clock(), id: order.id });
  return { ok: true, value: order };
}
