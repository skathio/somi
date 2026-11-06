export const ok = (value) => ({ ok: true, value });
export const fail = (code) => ({ ok: false, error: { code } });
