// SOMI-CANARY-M04-6b7d54c0c6537ded
import { fnv1a32 } from './hash.mjs';
import { fail, ok } from './result.mjs';

const VALID_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const snapshot = (f) => JSON.parse(JSON.stringify(f));
function change(store, name, type, apply) {
  const flag = store.flags.get(name);
  if (flag === undefined) return fail('not_found');
  const err = apply(flag);
  if (err) return fail(err);
  store.audit.push({ type, at: store.clock(), name });
  return ok(snapshot(flag));
}
const ids = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

export function defineFlag(store, name) {
  if (typeof name !== 'string' || !VALID_NAME.test(name) || store.flags.has(name)) return fail('invalid');
  store.flags.set(name, { name, enabled: false, percent: 100, allow: [], deny: [], prerequisites: [] });
  store.audit.push({ type: 'defineFlag', at: store.clock(), name });
  return ok(snapshot(store.flags.get(name)));
}
export const setEnabled = (store, name, enabled) => change(store, name, 'setEnabled', (f) => { if (enabled !== true && enabled !== false) return 'invalid'; f.enabled = enabled; return null; });
export const setRollout = (store, name, percent) => change(store, name, 'setRollout', (f) => { if (typeof percent !== 'number' || percent % 1 !== 0 || percent < 0 || percent > 100) return 'invalid'; f.percent = percent; return null; });
export const setTargets = (store, name, targets = {}) => change(store, name, 'setTargets', (f) => {
  const allow = targets.allow ?? [];
  const deny = targets.deny ?? [];
  if (!ids(allow) || !ids(deny)) return 'invalid';
  Object.assign(f, { allow: allow.slice(), deny: deny.slice() });
  return null;
});
export const setPrerequisites = (store, name, names) => change(store, name, 'setPrerequisites', (f) => {
  if (!Array.isArray(names) || names.some((n) => !store.flags.has(n))) return 'invalid';
  // Walk everything the new list depends on; meeting this flag again means a cycle.
  const stack = [...names];
  const visited = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (n === name) return 'invalid';
    if (visited.has(n)) continue;
    visited.add(n);
    stack.push(...store.flags.get(n).prerequisites);
  }
  f.prerequisites = names.slice();
  return null;
});

function evaluate(store, name, userId, depth) {
  const f = store.flags.get(name);
  if (!f || !f.enabled || depth > store.flags.size) return false;
  const own = f.allow.includes(userId) ? true : f.deny.includes(userId) ? false : fnv1a32(name + ':' + String(userId)) % 100 < f.percent;
  return own && f.prerequisites.every((p) => evaluate(store, p, userId, depth + 1));
}

export function isEnabled(store, name, userId) {
  try {
    if (!store.flags.has(name)) {
      if (typeof name === 'string' && store.unknown.indexOf(name) === -1) store.unknown.push(name);
      return false;
    }
    return evaluate(store, name, userId, 0);
  } catch {
    return false;
  }
}
