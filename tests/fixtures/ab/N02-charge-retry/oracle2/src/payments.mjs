// SOMI-CANARY-N02-62dd143717a312a3
class Ledger {
  active = new Map();
  run(id, fn) {
    if (!this.active.has(id)) this.active.set(id, (async () => { try { return await fn(); } finally { this.active.delete(id); } })());
    return this.active.get(id);
  }
}
const ledger = new Ledger();

export function chargeOrder(order, { gateway, store, retries = 3 }) {
  return ledger.run(order.id, async () => {
    const saved = await store.get(order.id);
    if (saved && saved.chargeId) return { chargeId: saved.chargeId, amount: order.amount };
    const idempotencyKey = 'charge:' + order.id;
    for (let left = retries; ; left--) {
      try {
        const { id } = await gateway.charge({ amount: order.amount, idempotencyKey });
        await store.set(order.id, { chargeId: id });
        return { chargeId: id, amount: order.amount };
      } catch (e) {
        if (e.retryable !== true || left <= 0) throw e;
      }
    }
  });
}
