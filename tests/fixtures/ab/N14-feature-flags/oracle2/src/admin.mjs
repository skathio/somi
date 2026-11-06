// SOMI-CANARY-N14-2151bb3314e52d28
import { HttpError } from './errors.mjs';

const validPercent = (p) => p === undefined || (Number.isInteger(p) && p >= 0 && p <= 100);
const validList = (l) => l === undefined || Array.isArray(l);

export function setFlag(store, flag, actor, now) {
  if (!validPercent(flag.percent) || !validList(flag.allow) || !validList(flag.deny)) throw new HttpError(400, 'invalid_flag', 'no');
  store.flags = store.flags.filter((f) => f.name !== flag.name).concat({ ...flag });
  store.cache.clear();
  store.audit.push({ type: 'flag.changed', name: flag.name, actor, at: now });
}
