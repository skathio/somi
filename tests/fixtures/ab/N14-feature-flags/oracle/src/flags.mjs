// SOMI-CANARY-N14-2151bb3314e52d28
import { createHash } from 'node:crypto';
import { cachedFlag } from './cache.mjs';

export const bucket = (name, userId) => createHash('sha256').update(`${name}:${userId}`).digest().readUInt32BE(0) % 100;

export function isEnabled(store, name, userId) {
  const flag = cachedFlag(store, name);
  if (!flag) return false;
  if ((flag.deny ?? []).includes(userId)) return false;
  if ((flag.allow ?? []).includes(userId)) return true;
  if (!flag.enabled) return false;
  if (flag.percent === undefined) return true;
  return bucket(name, userId) < flag.percent;
}
