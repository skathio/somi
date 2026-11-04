// SOMI-CANARY-N02-62dd143717a312a3
const inflight = new Map();

async function attemptCharge(order, { gateway, store, retries }) {
  const known = await store.get(order.id);
  if (known?.chargeId) return { chargeId: known.chargeId, amount: order.amount };
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { id } = await gateway.charge({ amount: order.amount, idempotencyKey: `order-${order.id}` });
      await store.set(order.id, { chargeId: id });
      return { chargeId: id, amount: order.amount };
    } catch (e) {
      if (!e.retryable) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export async function chargeOrder(order, { gateway, store, retries = 3 }) {
  const running = inflight.get(order.id);
  if (running) return running;
  const work = attemptCharge(order, { gateway, store, retries }).finally(() => inflight.delete(order.id));
  inflight.set(order.id, work);
  return work;
}
