// SOMI-CANARY-L1-60349bdfbf51ffa8
import { returnStock } from './inventory.mjs';
import { refundCard } from './payments.mjs';

const fail = (code) => ({ ok: false, error: { code } });

export function refundOrder(store, orderId, amount) {
  const order = store.orders.find((o) => o.id === orderId);
  if (!order) return fail('not_found');
  const earlier = store.refunds.reduce((s, r) => (r.orderId === orderId ? s + r.amount : s), 0);
  if (!Number.isSafeInteger(amount) || amount < 1) return fail('invalid_amount');
  if (earlier + amount > order.total) return fail('refund_too_large');
  refundCard(store, order.paymentId, amount);
  const value = { id: store.nextId(), orderId, amount, at: store.clock() };
  store.refunds.push(value);
  const full = earlier + amount === order.total;
  order.status = full ? 'refunded' : 'partially_refunded';
  if (full) order.lines.forEach((l) => returnStock(store, l.sku, l.qty));
  store.audit.push({ type: 'refund', at: store.clock(), id: value.id });
  return { ok: true, value };
}
