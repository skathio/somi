// SOMI-CANARY-L1-60349bdfbf51ffa8
export function addCoupon(store, { code, percent, expiresAt }) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return { ok: false, error: { code: 'bad_coupon' } };
  store.coupons.set(code, { code, percent, expiresAt });
  store.audit.push({ type: 'coupon.added', at: store.clock(), code });
  return { ok: true, value: store.coupons.get(code) };
}

export function discountFor(store, code, total) {
  const coupon = store.coupons.get(code);
  if (!coupon || store.clock() > coupon.expiresAt) return { ok: false, error: { code: 'bad_coupon' } };
  return { ok: true, value: Math.floor((total * coupon.percent) / 100) };
}
