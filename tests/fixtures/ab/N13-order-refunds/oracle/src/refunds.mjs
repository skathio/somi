// SOMI-CANARY-N13-e37e3c4ebef5d811
import { HttpError } from './errors.mjs';
import { post } from './ledger.mjs';
import { getOrder } from './orders.mjs';

const sum = (list, key) => list.reduce((s, r) => s + r[key], 0);

export function refundOrder(store, orderId, { amount, requestId }, now) {
  const order = getOrder(store, orderId);
  const earlier = order.refunds.find((r) => r.requestId === requestId);
  if (earlier) return earlier;
  if (order.status === 'pending') throw new HttpError(409, 'not_refundable', 'the order has not been paid');
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'invalid_amount', 'a positive number of cents');
  const remaining = order.total - sum(order.refunds, 'amount');
  if (amount > remaining) throw new HttpError(422, 'refund_too_large', 'more than what remains');
  const left = remaining - amount;
  const taxBefore = sum(order.refunds, 'tax');
  const tax = left === 0 ? order.tax - taxBefore : Math.round((amount * order.tax) / order.total);
  post(store, `refund:${orderId}:${requestId}`, [{ account: 'cash', amount: -amount }, { account: 'revenue', amount: amount - tax }, { account: 'tax_payable', amount: tax }]);
  const refund = { orderId, amount, tax, remaining: left, requestId };
  order.refunds.push(refund);
  order.status = left === 0 ? 'refunded' : 'partially_refunded';
  store.outbox.push({ type: 'order.refunded', orderId, amount, remaining: left });
  return refund;
}
