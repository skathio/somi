// SOMI-CANARY-N02-62dd143717a312a3
// A gateway that keeps its promise about keys, so "money moved" is what the tests count.
function world({ failFirst = 0, decline = false, delay = 0 } = {}) {
  const keys = new Map(); const data = new Map();
  let calls = 0; let moved = 0;
  const gateway = { charge: async ({ idempotencyKey }) => {
    calls++;
    const n = calls;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (decline) throw Object.assign(new Error('declined'), { retryable: false });
    if (!keys.has(idempotencyKey)) { moved++; keys.set(idempotencyKey, 'c' + moved); }
    if (n <= failFirst) throw Object.assign(new Error('timeout'), { retryable: true });
    return { id: keys.get(idempotencyKey) };
  } };
  const store = { get: async (k) => data.get(k), set: async (k, v) => { data.set(k, v); } };
  return { gateway, store, stats: () => ({ calls, moved }) };
}
const order = { id: 'o1', amount: 500 };
const charge = async (load) => (await load('src/payments.mjs')).chargeOrder;
export const cases = [
  { name: 'AC2 [functional] a timeout that went through is not charged again', run: async (load) => { const w = world({ failFirst: 2 }); const r = await (await charge(load))(order, w); return { id: r.chargeId, moved: w.stats().moved }; }, expect: { id: 'c1', moved: 1 } },
  { name: 'AC2 [functional] charging the same order later does not move money again', run: async (load) => { const f = await charge(load); const w = world(); await f(order, w); const again = await f(order, w); return { id: again.chargeId, moved: w.stats().moved, calls: w.stats().calls }; }, expect: { id: 'c1', moved: 1, calls: 1 } },
  { name: 'AC2 [functional] a restart keeps the memory of the charge', run: async (load) => { const w = world(); await (await load('src/payments.mjs')).chargeOrder(order, w); const fresh = await import(process.env.TASK_WORKSPACE + '/src/payments.mjs?restart'); const r = await fresh.chargeOrder(order, w); return { id: r.chargeId, calls: w.stats().calls }; }, expect: { id: 'c1', calls: 1 } },
  { name: 'AC2 [boundary] two simultaneous charges for one order move money once and agree', run: async (load) => { const f = await charge(load); const w = world({ delay: 20 }); const [a, b] = await Promise.all([f(order, w), f(order, w)]); return { same: a.chargeId === b.chargeId, moved: w.stats().moved }; }, expect: { same: true, moved: 1 } },
  { name: 'AC2 [boundary] a refused card is not retried', run: async (load) => { const f = await charge(load); const w = world({ decline: true }); let threw = false; try { await f(order, w); } catch { threw = true; } return { threw, calls: w.stats().calls }; }, expect: { threw: true, calls: 1 } },
  { name: 'AC2 [regression] a refused order can be charged again afterwards', run: async (load) => { const f = await charge(load); const bad = world({ decline: true }); await f(order, bad).catch(() => {}); const good = { ...world(), store: bad.store }; const r = await f(order, good); return { id: r.chargeId }; }, expect: { id: 'c1' } },
  { name: 'AC2 [boundary] the unknown outcome is still reported when retries run out', run: async (load) => { const f = await charge(load); const w = world({ failFirst: 99 }); let code = null; try { await f(order, { ...w, retries: 1 }); } catch (e) { code = e.message; } return { code, calls: w.stats().calls, moved: w.stats().moved }; }, expect: { code: 'timeout', calls: 2, moved: 1 } },
  { name: 'AC3 [regression] a plain charge returns the same shape', run: async (load) => (await charge(load))({ id: 'o9', amount: 7 }, world()), expect: { chargeId: 'c1', amount: 7 } },
  { name: 'AC2 [functional] two different orders are two charges', run: async (load) => { const f = await charge(load); const w = world(); const data = new Map(); w.store = { get: async (k) => data.get(k), set: async (k, v) => { data.set(k, v); } }; const a = await f({ id: 'a', amount: 1 }, w); const b = await f({ id: 'b', amount: 1 }, w); const again = await f({ id: 'a', amount: 1 }, w); return { differ: a.chargeId !== b.chargeId, again: again.chargeId === a.chargeId, moved: w.stats().moved }; }, expect: { differ: true, again: true, moved: 2 } },
];
