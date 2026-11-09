// SOMI-CANARY-N27-e6a280c99c5f7110
import { HttpError } from './errors.mjs';

export const normCode = (code) => String(code).trim().toUpperCase();

const live = (store, code) => store.redemptions.filter((r) => !r.cancelled && r.code === code);
export const usageCount = (store, code) => live(store, code).length;

export function cancelOrder(store, orderId) {
  for (const r of store.redemptions) if (r.orderId === orderId) r.cancelled = true;
}

const no = (code) => new HttpError(422, code, code);

export function redeem(store, rawCode, userId, orderId, now) {
  const code = normCode(rawCode);
  if (!Object.keys(store.coupons).includes(code)) throw no('unknown_coupon');
  const { percent, expiresAt, maxTotal, maxPerUser } = store.coupons[code];
  const used = live(store, code);
  if (used.some((r) => r.orderId === orderId)) return percent;
  if (expiresAt < now) throw no('coupon_expired');
  if (used.length >= maxTotal) throw no('coupon_used_up');
  if (used.filter((r) => r.userId === userId).length >= maxPerUser) throw no('coupon_limit_reached');
  store.redemptions.push({ code, userId, orderId, at: now, cancelled: false });
  return percent;
}
