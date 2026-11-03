// SOMI-CANARY-L3-5d1e7ac94b02f863
export const ok = (value) => ({ ok: true, value });
export const fail = (code) => ({ ok: false, error: { code } });
export function note(store, type, id) { store.audit.push({ type, at: store.clock(), id }); }
