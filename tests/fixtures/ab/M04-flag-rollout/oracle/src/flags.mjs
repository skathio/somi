// SOMI-CANARY-M04-6b7d54c0c6537ded
import { fnv1a32 } from './hash.mjs';
import { fail, ok } from './result.mjs';

const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const view = (flag) => ({ ...flag, allow: [...flag.allow], deny: [...flag.deny], prerequisites: [...flag.prerequisites] });
const record = (store, type, name) => store.audit.push({ type, at: store.clock(), name });
const isUserList = (list) => Array.isArray(list) && list.every((u) => typeof u === 'string' && u !== '');

export function defineFlag(store, name) {
  if (typeof name !== 'string' || !NAME.test(name)) return fail('invalid');
  if (store.flags.has(name)) return fail('invalid');
  const flag = { name, enabled: false, percent: 100, allow: [], deny: [], prerequisites: [] };
  store.flags.set(name, flag);
  record(store, 'defineFlag', name);
  return ok(view(flag));
}

export function setEnabled(store, name, enabled) {
  const flag = store.flags.get(name);
  if (!flag) return fail('not_found');
  if (typeof enabled !== 'boolean') return fail('invalid');
  flag.enabled = enabled;
  record(store, 'setEnabled', name);
  return ok(view(flag));
}

export function setRollout(store, name, percent) {
  const flag = store.flags.get(name);
  if (!flag) return fail('not_found');
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return fail('invalid');
  flag.percent = percent;
  record(store, 'setRollout', name);
  return ok(view(flag));
}

export function setTargets(store, name, { allow = [], deny = [] } = {}) {
  const flag = store.flags.get(name);
  if (!flag) return fail('not_found');
  if (!isUserList(allow) || !isUserList(deny)) return fail('invalid');
  flag.allow = [...allow];
  flag.deny = [...deny];
  record(store, 'setTargets', name);
  return ok(view(flag));
}

// A prerequisite list is refused if any chain from it leads back to the flag itself.
function reaches(store, from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (store.flags.get(from)?.prerequisites ?? []).some((p) => reaches(store, p, target, seen));
}

export function setPrerequisites(store, name, names) {
  const flag = store.flags.get(name);
  if (!flag) return fail('not_found');
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string' && store.flags.has(n))) return fail('invalid');
  if (names.some((n) => reaches(store, n, name))) return fail('invalid');
  flag.prerequisites = [...names];
  record(store, 'setPrerequisites', name);
  return ok(view(flag));
}

const bucket = (name, userId) => fnv1a32(`${name}:${userId}`) % 100;

function on(store, flag, userId, path) {
  if (!flag.enabled) return false;
  if (path.has(flag.name)) return false;
  const inAllow = flag.allow.includes(userId);
  const inDeny = flag.deny.includes(userId);
  let own;
  if (inAllow) own = true;
  else if (inDeny) own = false;
  else own = bucket(flag.name, userId) < flag.percent;
  if (!own) return false;
  const next = new Set(path).add(flag.name);
  return flag.prerequisites.every((p) => { const pre = store.flags.get(p); return Boolean(pre) && on(store, pre, userId, next); });
}

export function isEnabled(store, name, userId) {
  try {
    const flag = store.flags.get(name);
    if (!flag) {
      if (typeof name === 'string' && !store.unknown.includes(name)) store.unknown.push(name);
      return false;
    }
    return on(store, flag, userId, new Set());
  } catch {
    return false;
  }
}
