export const normalize = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
