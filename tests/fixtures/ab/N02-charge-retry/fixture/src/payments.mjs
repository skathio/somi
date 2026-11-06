import { randomUUID } from 'node:crypto';

export async function chargeOrder(order, { gateway, retries = 3 }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { id } = await gateway.charge({ amount: order.amount, idempotencyKey: randomUUID() });
      return { chargeId: id, amount: order.amount };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
