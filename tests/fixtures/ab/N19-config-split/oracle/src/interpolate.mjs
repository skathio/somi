// SOMI-CANARY-N19-24153f614e864a8e
const fill = (value, known, env) => value.replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name) => {
  if (m === '$$') return '$';
  if (name in known) return known[name];
  return env[name] ?? '';
});

export function interpolate(entries, env = {}) {
  const out = Object.create(null);
  for (const { key, value, literal } of entries) out[key] = literal ? value : fill(value, out, env);
  return { ...out };
}
