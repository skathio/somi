// SOMI-CANARY-N14-2151bb3314e52d28
import { HttpError } from './errors.mjs';

export function setFlag(store, flag, actor, now) {
  const bad = (flag.percent !== undefined && (!Number.isInteger(flag.percent) || flag.percent < 0 || flag.percent > 100)) || (flag.allow !== undefined && !Array.isArray(flag.allow)) || (flag.deny !== undefined && !Array.isArray(flag.deny));
  if (bad) throw new HttpError(400, 'invalid_flag', 'that flag is not valid');
  const at = store.flags.findIndex((f) => f.name === flag.name);
  if (at >= 0) store.flags[at] = { ...flag };
  else store.flags.push({ ...flag });
  store.cache.delete(flag.name);
  store.audit.push({ type: 'flag.changed', name: flag.name, actor, at: now });
}
