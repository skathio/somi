// SOMI-CANARY-N27-e6a280c99c5f7110
async function w(l, c = {}) { const m = await l('src/coupons.mjs'); const store = { coupons: { SAVE: { percent: 10, expiresAt: 100, maxTotal: 3, maxPerUser: 1, ...c } }, redemptions: [] }; return { ...m, store, r: (code, u, o, now = 50) => m.redeem(store, code, u, o, now) }; }
const code = (f) => { try { f(); return null; } catch (e) { return e.code; } };
export const cases = [
  { name: 'AC1 [functional] it records and returns the percent', run: async (l) => { const x = await w(l); return [x.r('SAVE', 'u', 'o'), x.store.redemptions]; }, expect: [10, [{ code: 'SAVE', userId: 'u', orderId: 'o', at: 50, cancelled: false }]] },
  { name: 'AC2 [boundary] a code is taken however it is typed, and stored in its form', run: async (l) => { const x = await w(l); x.r('  save ', 'u', 'o'); return x.store.redemptions[0].code; }, expect: 'SAVE' },
  { name: 'AC2 [functional] an unknown code is refused', run: async (l) => { const x = await w(l); return [code(() => x.r('NOPE', 'u', 'o')), code(() => x.r('constructor', 'u', 'o'))]; }, expect: ['unknown_coupon', 'unknown_coupon'] },
  { name: 'AC2 [boundary] it works up to and including the end', run: async (l) => { const x = await w(l); return [code(() => x.r('SAVE', 'u', 'o', 100)), code(() => x.r('SAVE', 'v', 'p', 101))]; }, expect: [null, 'coupon_expired'] },
  { name: 'AC2 [functional] the per-person limit holds', run: async (l) => { const x = await w(l); x.r('SAVE', 'u', 'o'); return code(() => x.r('SAVE', 'u', 'p')); }, expect: 'coupon_limit_reached' },
  { name: 'AC2 [functional] the total limit holds', run: async (l) => { const x = await w(l, { maxTotal: 1 }); x.r('SAVE', 'u', 'o'); return code(() => x.r('SAVE', 'v', 'p')); }, expect: 'coupon_used_up' },
  { name: 'AC2 [boundary] a cancelled redemption is given back to the person', run: async (l) => { const x = await w(l); x.r('SAVE', 'u', 'o'); x.cancelOrder(x.store, 'o'); return code(() => x.r('SAVE', 'u', 'p')); }, expect: null },
  { name: 'AC2 [boundary] a cancelled redemption is given back to the total', run: async (l) => { const x = await w(l, { maxTotal: 1 }); x.r('SAVE', 'u', 'o'); x.cancelOrder(x.store, 'o'); return code(() => x.r('SAVE', 'v', 'p')); }, expect: null },
  { name: 'AC3 [functional] usageCount leaves out cancelled ones', run: async (l) => { const x = await w(l); x.r('SAVE', 'u', 'o'); x.r('SAVE', 'v', 'p'); x.cancelOrder(x.store, 'o'); return x.usageCount(x.store, 'SAVE'); }, expect: 1 },
  { name: 'AC2 [boundary] a retry for the same order changes nothing and still works', run: async (l) => { const x = await w(l); return [x.r('SAVE', 'u', 'o'), x.r('save', 'u', 'o'), x.store.redemptions.length]; }, expect: [10, 10, 1] },
  { name: 'AC2 [boundary] a retry works even after the coupon ended or filled up', run: async (l) => { const x = await w(l, { maxTotal: 1 }); x.r('SAVE', 'u', 'o'); return [code(() => x.r('SAVE', 'u', 'o', 999)), x.store.redemptions.length]; }, expect: [null, 1] },
  { name: 'AC2 [boundary] an order cancelled and tried again redeems afresh', run: async (l) => { const x = await w(l); x.r('SAVE', 'u', 'o'); x.cancelOrder(x.store, 'o'); x.r('SAVE', 'u', 'o'); return x.store.redemptions.map((r) => r.cancelled); }, expect: [true, false] },
  { name: 'AC3 [regression] the code form is unchanged', run: async (l) => (await l('src/coupons.mjs')).normCode(' aB '), expect: 'AB' },
];
