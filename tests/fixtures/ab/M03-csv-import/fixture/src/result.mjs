export const ok = (value) => ({ ok: true, value });
export const fail = (code, extra = {}) => ({ ok: false, error: { code, ...extra } });
