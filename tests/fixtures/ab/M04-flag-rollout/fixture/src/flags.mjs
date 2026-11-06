import { fail, ok } from './result.mjs';

const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const view = (flag) => ({ ...flag });

export function defineFlag(store, name) {
  if (typeof name !== 'string' || !NAME.test(name)) return fail('invalid');
  if (store.flags.has(name)) return fail('invalid');
  const flag = { name, enabled: false };
  store.flags.set(name, flag);
  store.audit.push({ type: 'defineFlag', at: store.clock(), name });
  return ok(view(flag));
}

export function setEnabled(store, name, enabled) {
  const flag = store.flags.get(name);
  if (!flag) return fail('not_found');
  if (typeof enabled !== 'boolean') return fail('invalid');
  flag.enabled = enabled;
  store.audit.push({ type: 'setEnabled', at: store.clock(), name });
  return ok(view(flag));
}

export function isEnabled(store, name) {
  const flag = store.flags.get(name);
  return Boolean(flag?.enabled);
}
