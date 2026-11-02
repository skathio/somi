// SOMI-CANARY-L1-60349bdfbf51ffa8
import { returnStock } from './inventory.mjs';
import { refundCard } from './payments.mjs';

export function refundOrder(store, orderId, amount) {
  const order = store.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: { code: 'not_found' } };
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: { code: 'invalid_amount' } };
  const already = store.refunds.filter((r) => r.orderId === orderId).reduce((s, r) => s + r.amount, 0);
  if (already + amount > order.total) return { ok: false, error: { code: 'refund_too_large' } };
  refundCard(store, order.paymentId, amount);
  const refund = { id: store.nextId(), orderId, amount, at: store.clock() };
  store.refunds.push(refund);
  order.status = already + amount === order.total ? 'refunded' : 'partially_refunded';
  if (order.status === 'refunded') for (const l of order.lines) returnStock(store, l.sku, l.qty);
  store.audit.push({ type: 'order.refunded', at: store.clock(), orderId, refundId: refund.id });
  return { ok: true, value: refund };
}
