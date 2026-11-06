// SOMI-CANARY-L1-60349bdfbf51ffa8
export function addCoupon(store, coupon) {
  store.coupons.set(coupon.code, { ...coupon });
  store.audit.push({ type: 'coupon', at: store.clock(), code: coupon.code });
  return { ok: true, value: { ...coupon } };
}
export function couponOff(store, code, total) {
  const c = store.coupons.get(code);
  return c && c.expiresAt >= store.clock() ? Math.floor((total * c.percent) / 100) : null;
}
