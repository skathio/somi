// SOMI-CANARY-N14-2151bb3314e52d28
import { createHash } from 'node:crypto';
import { cachedFlag } from './cache.mjs';

function inRollout(name, userId, percent) {
  const hex = createHash('sha256').update(name + ':' + userId).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 100 < percent;
}

export function isEnabled(store, name, userId) {
  const { enabled, percent, allow = [], deny = [] } = cachedFlag(store, name) ?? { enabled: false };
  if (deny.includes(userId)) return false;
  return allow.includes(userId) || (Boolean(enabled) && (percent === undefined || inRollout(name, userId, percent)));
}
