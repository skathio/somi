// SOMI-CANARY-M04-6b7d54c0c6537ded
const USERS = Array.from({ length: 20 }, (_, i) => `u${i + 1}`);
const world = async (load) => {
  const { createStore } = await load('src/store.mjs');
  const f = await load('src/flags.mjs');
  const store = createStore({ clock: () => '2031-05-01T00:00:00Z' });
  return { store, f };
};
const flag = async (load, name = 'beta', { enabled = true, percent } = {}) => {
  const w = await world(load);
  w.f.defineFlag(w.store, name);
  if (enabled) w.f.setEnabled(w.store, name, true);
  if (percent !== undefined) w.f.setRollout(w.store, name, percent);
  return w;
};
const onFor = (w, name, users = USERS) => users.filter((u) => w.f.isEnabled(w.store, name, u) === true);

export const cases = [
  { name: 'AC5 [regression] an enabled flag with no rollout is on for everyone', run: async (load) => onFor(await flag(load), 'beta').length, expect: 20 },
  { name: 'AC5 [regression] a disabled flag is off for everyone', run: async (load) => onFor(await flag(load, 'beta', { enabled: false }), 'beta').length, expect: 0 },
  { name: 'AC4 [regression] turning a flag on is recorded once', run: async (load) => (await flag(load)).store.audit, expect: [{ type: 'defineFlag', at: '2031-05-01T00:00:00Z', name: 'beta' }, { type: 'setEnabled', at: '2031-05-01T00:00:00Z', name: 'beta' }] },
  { name: 'AC2 [functional] a 30 percent rollout is on for exactly the users whose bucket is below 30', run: async (load) => onFor(await flag(load, 'beta', { percent: 30 }), 'beta'), expect: ['u2', 'u3', 'u6', 'u9', 'u16', 'u18'] },
  { name: 'AC2 [functional] the bucket depends on the flag name as well as the user', run: async (load) => onFor(await flag(load, 'gamma', { percent: 30 }), 'gamma'), expect: ['u3', 'u8', 'u12', 'u13', 'u14', 'u17', 'u19', 'u20'] },
  { name: 'AC2 [functional] raising the percent only adds users', run: async (load) => onFor(await flag(load, 'beta', { percent: 50 }), 'beta'), expect: ['u2', 'u3', 'u6', 'u7', 'u9', 'u11', 'u16', 'u18'] },
  { name: 'AC2 [functional] the same flag and user always give the same answer', run: async (load) => { const w = await flag(load, 'beta', { percent: 30 }); return [onFor(w, 'beta'), onFor(w, 'beta')].map((l) => l.join(',')); }, expect: ['u2,u3,u6,u9,u16,u18', 'u2,u3,u6,u9,u16,u18'] },
  { name: 'AC2 [boundary] a user whose bucket equals the percent is off', run: async (load) => onFor(await flag(load, 'beta', { percent: 47 }), 'beta'), expect: ['u2', 'u3', 'u6', 'u9', 'u11', 'u16', 'u18'] },
  { name: 'AC5 [boundary] zero percent is off for everyone and 100 percent on for everyone', run: async (load) => { const a = await flag(load, 'beta', { percent: 0 }); const b = await flag(load, 'beta', { percent: 100 }); return [onFor(a, 'beta').length, onFor(b, 'beta').length]; }, expect: [0, 20] },
  { name: 'AC5 [functional] a disabled flag stays off at any percent', run: async (load) => onFor(await flag(load, 'beta', { enabled: false, percent: 100 }), 'beta').length, expect: 0 },
  { name: 'AC4 [functional] a percent that is not a whole number from 0 to 100 has code invalid', run: async (load) => { const w = await flag(load); return [101, -1, 2.5, '50', null].map((p) => w.f.setRollout(w.store, 'beta', p).error?.code); }, expect: ['invalid', 'invalid', 'invalid', 'invalid', 'invalid'] },
  { name: 'AC4 [functional] a rollout for an undefined flag has code not_found', run: async (load) => { const w = await world(load); return w.f.setRollout(w.store, 'nope', 10); }, expect: { ok: false, error: { code: 'not_found' } } },
  { name: 'AC4 [functional] a rollout change is recorded, and a refused one is not', run: async (load) => { const w = await flag(load); w.f.setRollout(w.store, 'beta', 40); w.f.setRollout(w.store, 'beta', 400); return w.store.audit.slice(2); }, expect: [{ type: 'setRollout', at: '2031-05-01T00:00:00Z', name: 'beta' }] },
  { name: 'AC3 [functional] a flag never defined is off and is noted once', run: async (load) => { const w = await world(load); return [w.f.isEnabled(w.store, 'nope', 'u1'), w.f.isEnabled(w.store, 'nope', 'u2'), w.store.unknown]; }, expect: [false, false, ['nope']] },
  { name: 'AC3 [safety] checking a flag with odd input never throws', run: async (load) => { const w = await flag(load, 'beta', { percent: 30 }); return [w.f.isEnabled(w.store, 'beta', null), w.f.isEnabled(w.store, 'beta', { id: 'u1' }), w.f.isEnabled(w.store, 42, 'u1')].map((v) => typeof v); }, expect: ['boolean', 'boolean', 'boolean'] },
  { name: 'AC7 [functional] a user on the allow list is on whatever the percent', run: async (load) => { const w = await flag(load, 'beta', { percent: 0 }); w.f.setTargets(w.store, 'beta', { allow: ['u5'] }); return onFor(w, 'beta'); }, expect: ['u5'] },
  { name: 'AC7 [functional] a user on the deny list is off whatever the percent', run: async (load) => { const w = await flag(load, 'beta', { percent: 100 }); w.f.setTargets(w.store, 'beta', { deny: ['u5', 'u7'] }); return onFor(w, 'beta').length; }, expect: 18 },
  { name: 'AC10 [functional] a user on both lists is now on, because allow wins', run: async (load) => { const w = await flag(load, 'beta', { percent: 0 }); w.f.setTargets(w.store, 'beta', { allow: ['u5', 'u6'], deny: ['u5'] }); return onFor(w, 'beta'); }, expect: ['u5', 'u6'] },
  { name: 'AC7 [functional] the allow list does not turn on a disabled flag', run: async (load) => { const w = await flag(load, 'beta', { enabled: false }); w.f.setTargets(w.store, 'beta', { allow: ['u5'] }); return onFor(w, 'beta'); }, expect: [] },
  { name: 'AC4 [functional] targets that are not lists of user ids have code invalid, and a change is recorded', run: async (load) => { const w = await flag(load); return [w.f.setTargets(w.store, 'beta', { allow: 'u5' }).error?.code, w.f.setTargets(w.store, 'beta', { deny: [5] }).error?.code, w.f.setTargets(w.store, 'beta', { allow: ['u1'] }).ok, w.store.audit.at(-1).type, w.store.audit.length]; }, expect: ['invalid', 'invalid', true, 'setTargets', 3] },
  { name: 'AC8 [functional] a flag is on only where its prerequisite is also on', run: async (load) => { const w = await flag(load, 'beta', { percent: 30 }); w.f.defineFlag(w.store, 'checkout'); w.f.setEnabled(w.store, 'checkout', true); w.f.setPrerequisites(w.store, 'checkout', ['beta']); return onFor(w, 'checkout'); }, expect: ['u2', 'u3', 'u6', 'u9', 'u16', 'u18'] },
  { name: 'AC8 [functional] prerequisites apply through a chain', run: async (load) => { const w = await flag(load, 'beta', { percent: 30 }); for (const n of ['middle', 'top']) { w.f.defineFlag(w.store, n); w.f.setEnabled(w.store, n, true); } w.f.setPrerequisites(w.store, 'middle', ['beta']); w.f.setPrerequisites(w.store, 'top', ['middle']); w.f.setEnabled(w.store, 'beta', false); return onFor(w, 'top'); }, expect: [] },
  { name: 'AC8 [functional] a prerequisite on its allow list counts as on', run: async (load) => { const w = await flag(load, 'beta', { percent: 0 }); w.f.setTargets(w.store, 'beta', { allow: ['u4'] }); w.f.defineFlag(w.store, 'checkout'); w.f.setEnabled(w.store, 'checkout', true); w.f.setPrerequisites(w.store, 'checkout', ['beta']); return onFor(w, 'checkout'); }, expect: ['u4'] },
  { name: 'AC8 [safety] a cycle through prerequisites has code invalid and changes nothing', run: async (load) => { const w = await flag(load, 'a'); w.f.defineFlag(w.store, 'b'); w.f.setEnabled(w.store, 'b', true); w.f.setPrerequisites(w.store, 'a', ['b']); const r = w.f.setPrerequisites(w.store, 'b', ['a']); return [r.error?.code, onFor(w, 'b').length, onFor(w, 'a').length]; }, expect: ['invalid', 20, 20] },
  { name: 'AC8 [boundary] a flag cannot be its own prerequisite', run: async (load) => { const w = await flag(load); return w.f.setPrerequisites(w.store, 'beta', ['beta']); }, expect: { ok: false, error: { code: 'invalid' } } },
  { name: 'AC8 [functional] an undefined prerequisite has code invalid and is not recorded', run: async (load) => { const w = await flag(load); const r = w.f.setPrerequisites(w.store, 'beta', ['nope']); return [r.error?.code, w.store.audit.length]; }, expect: ['invalid', 2] },
  { name: 'AC4 [functional] a prerequisite change is recorded', run: async (load) => { const w = await flag(load); w.f.defineFlag(w.store, 'b'); w.f.setPrerequisites(w.store, 'beta', ['b']); return w.store.audit.at(-1); }, expect: { type: 'setPrerequisites', at: '2031-05-01T00:00:00Z', name: 'beta' } },
];
