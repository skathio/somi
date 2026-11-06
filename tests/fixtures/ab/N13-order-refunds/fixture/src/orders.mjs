import { HttpError } from './errors.mjs';
import { post } from './ledger.mjs';

export function getOrder(store, id) {
  const order = store.orders.find((o) => o.id === id);
  if (!order) throw new HttpError(404, 'not_found', 'no such order');
  return order;
}

export function createOrder(store, id, total, tax) {
  const order = { id, total, tax, status: 'pending', refunds: [] };
  store.orders.push(order);
  return order;
}

export function payOrder(store, id) {
  const order = getOrder(store, id);
  post(store, `sale:${id}`, [{ account: 'cash', amount: order.total }, { account: 'revenue', amount: -(order.total - order.tax) }, { account: 'tax_payable', amount: -order.tax }]);
  order.status = 'paid';
  return order;
}
