import { cachedFlag } from './cache.mjs';

export function isEnabled(store, name, userId) {
  const flag = cachedFlag(store, name);
  return Boolean(flag && flag.enabled);
}
