// SOMI-CANARY-N27-e6a280c99c5f7110
import { HttpError } from './errors.mjs';

export const normCode = (code) => String(code).trim().toUpperCase();

export const usageCount = (store, code) => store.redemptions.filter((r) => r.code === code && !r.cancelled).length;

export function cancelOrder(store, orderId) {
  for (const r of store.redemptions) if (r.orderId === orderId) r.cancelled = true;
}

export function redeem(store, code, userId, orderId, now) {
  const key = normCode(code);
  const coupon = Object.hasOwn(store.coupons, key) ? store.coupons[key] : null;
  if (!coupon) throw new HttpError(422, 'unknown_coupon', 'no such coupon');
  const earlier = store.redemptions.find((r) => r.orderId === orderId && r.code === key && !r.cancelled);
  if (earlier) return coupon.percent;
  if (now > coupon.expiresAt) throw new HttpError(422, 'coupon_expired', 'that coupon has ended');
  if (usageCount(store, key) >= coupon.maxTotal) throw new HttpError(422, 'coupon_used_up', 'that coupon is used up');
  const mine = store.redemptions.filter((r) => r.code === key && !r.cancelled && r.userId === userId).length;
  if (mine >= coupon.maxPerUser) throw new HttpError(422, 'coupon_limit_reached', 'you have used that coupon');
  store.redemptions.push({ code: key, userId, orderId, at: now, cancelled: false });
  return coupon.percent;
}
