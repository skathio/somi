// SOMI-CANARY-N32-253539dea3f36411
export function delayFrom(header, nowMs, fallback) {
  if (header == null) return fallback;
  const s = String(header).trim();
  if (s !== '' && [...s].every((c) => c >= '0' && c <= '9')) return parseInt(s, 10) * 1000;
  const t = new Date(s).getTime();
  return t === t ? Math.max(t - nowMs, 0) : fallback;
}
