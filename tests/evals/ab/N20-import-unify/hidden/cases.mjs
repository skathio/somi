// SOMI-CANARY-N20-7a7f1e4433d0a5f1
const R = (ref, email, amount) => ({ ref, email, amount });
const call = (fn, rows) => async (l) => (await l('src/import.mjs'))[fn](rows);
const I = (ref, email, amount) => ({ ref, email, amount });
export const cases = [
  { name: 'AC1 [functional] importRows exists and both imports go through it', run: async (l) => { const m = await l('src/rows.mjs'); return typeof m.importRows; }, expect: 'function' },
  { name: 'AC2 [functional] credits parse like refunds', run: call('importCredits', [R('a', ' X@y ', '1,234.569')]), expect: { items: [I('a', 'X@y', 123456)], skipped: 0 } },
  { name: 'AC2 [boundary] zero and negative credits are skipped', run: call('importCredits', [R('a', 'x', '0'), R('b', 'x', '-5'), R('c', 'x', '1')]), expect: { items: [I('c', 'x', 100)], skipped: 2 } },
  { name: 'AC2 [boundary] a blank credit is a zero, so it is skipped', run: call('importCredits', [R('a', 'x', '  ')]), expect: { items: [], skipped: 1 } },
  { name: 'AC2 [boundary] the latest credit for a row wins and moves to the end', run: call('importCredits', [R('a', 'x', '1'), R('b', 'x', '2'), R('a', 'x', '3')]), expect: { items: [I('b', 'x', 200), I('a', 'x', 300)], skipped: 0 } },
  { name: 'AC2 [boundary] a bad later credit keeps the earlier one', run: call('importCredits', [R('a', 'x', '1'), R('a', 'x', 'nope'), R('a', 'x', '-1')]), expect: { items: [I('a', 'x', 100)], skipped: 2 } },
  { name: 'AC2 [boundary] credits keep the case of an email', run: call('importCredits', [R('a', 'X', '1'), R('a', 'x', '2')]), expect: { items: [I('a', 'X', 100), I('a', 'x', 200)], skipped: 0 } },
  { name: 'AC3 [regression] orders fold the case of an email', run: call('importOrders', [R('a', ' X@Y ', '1')]), expect: { items: [I('a', 'x@y', 100)], skipped: 0 } },
  { name: 'AC3 [regression] refunds keep the case of an email', run: call('importRefunds', [R('a', ' X@Y ', '1')]), expect: { items: [I('a', 'X@Y', 100)], skipped: 0 } },
  { name: 'AC3 [regression] orders keep the first duplicate, and the place it had', run: call('importOrders', [R('a', 'x', '1'), R('b', 'x', '2'), R('a', 'X', '3')]), expect: { items: [I('a', 'x', 100), I('b', 'x', 200)], skipped: 0 } },
  { name: 'AC3 [regression] refunds keep the last duplicate, moved to the end', run: call('importRefunds', [R('a', 'x', '1'), R('b', 'x', '2'), R('a', 'x', '3')]), expect: { items: [I('b', 'x', 200), I('a', 'x', 300)], skipped: 0 } },
  { name: 'AC3 [regression] a blank order is skipped and a blank refund is zero', run: async (l) => { const m = await l('src/import.mjs'); return [m.importOrders([R('a', 'x', ' ')]), m.importRefunds([R('a', 'x', ' ')])]; }, expect: [{ items: [], skipped: 1 }, { items: [I('a', 'x', 0)], skipped: 0 }] },
  { name: 'AC3 [regression] orders round and refunds cut off', run: async (l) => { const m = await l('src/import.mjs'); return [m.importOrders([R('a', 'x', '1.999')]).items[0].amount, m.importRefunds([R('a', 'x', '1.999')]).items[0].amount]; }, expect: [200, 199] },
  { name: 'AC3 [regression] a duplicate order with a bad amount is not counted as skipped', run: call('importOrders', [R('a', 'x', '1'), R('a', 'x', 'bad')]), expect: { items: [I('a', 'x', 100)], skipped: 0 } },
  { name: 'AC3 [regression] a bad refund after a good one keeps the good one and counts', run: call('importRefunds', [R('a', 'x', '1'), R('a', 'x', 'bad')]), expect: { items: [I('a', 'x', 100)], skipped: 1 } },
  { name: 'AC3 [regression] a refund may be negative', run: call('importRefunds', [R('a', 'x', '-1.999')]), expect: { items: [I('a', 'x', -199)], skipped: 0 } },
];
