export const normCode = (code) => String(code).trim().toUpperCase();

export const usageCount = (store, code) => store.redemptions.filter((r) => r.code === code).length;

export function cancelOrder(store, orderId) {
  for (const r of store.redemptions) if (r.orderId === orderId) r.cancelled = true;
}
