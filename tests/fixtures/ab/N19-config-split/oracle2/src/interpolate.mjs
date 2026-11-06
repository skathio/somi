// SOMI-CANARY-N19-24153f614e864a8e
export function interpolate(entries, env = {}) {
  const seen = new Map();
  for (const { key, value, raw } of entries) {
    seen.set(key, raw ? value : value.replace(/\$\$|\$\{(\w+)\}/g, (all, name) => {
      if (all === '$$') return '$';
      return seen.has(name) ? seen.get(name) : env[name] ?? '';
    }));
  }
  return Object.fromEntries(seen);
}
