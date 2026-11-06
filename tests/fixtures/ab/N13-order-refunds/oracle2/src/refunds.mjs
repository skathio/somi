// SOMI-CANARY-N13-e37e3c4ebef5d811
import { HttpError } from './errors.mjs';
import { post } from './ledger.mjs';
import { getOrder } from './orders.mjs';

function taxFor(order, amount) {
  const refundedAfter = order.refunds.reduce((s, r) => s + r.amount, 0) + amount;
  if (refundedAfter === order.total) return order.tax - order.refunds.reduce((s, r) => s + r.tax, 0);
  return Math.round((order.tax * amount) / order.total);
}

export function refundOrder(store, orderId, request, now) {
  const order = getOrder(store, orderId);
  const repeat = order.refunds.find((r) => r.requestId === request.requestId);
  if (repeat) return { ...repeat };
  if (!['paid', 'partially_refunded'].includes(order.status)) {
    if (order.status === 'refunded' && Number.isInteger(request.amount) && request.amount > 0) throw new HttpError(422, 'refund_too_large', 'nothing remains');
    if (order.status === 'pending') throw new HttpError(409, 'not_refundable', 'unpaid');
  }
  const { amount, requestId } = request;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) throw new HttpError(400, 'invalid_amount', 'bad amount');
  const remainingBefore = order.total - order.refunds.reduce((s, r) => s + r.amount, 0);
  if (amount > remainingBefore) throw new HttpError(422, 'refund_too_large', 'too much');
  const tax = taxFor(order, amount);
  post(store, 'r:' + requestId, [{ account: 'cash', amount: -amount }, { account: 'revenue', amount: amount - tax }, { account: 'tax_payable', amount: tax }]);
  const answer = { orderId, amount, tax, remaining: remainingBefore - amount, requestId };
  order.refunds.push(answer);
  order.status = answer.remaining === 0 ? 'refunded' : 'partially_refunded';
  store.outbox.push({ type: 'order.refunded', orderId, amount, remaining: answer.remaining });
  return { ...answer };
}
