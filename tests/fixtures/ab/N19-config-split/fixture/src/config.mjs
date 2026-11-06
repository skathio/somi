export class ConfigError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}

export function parseConfig(text, env = {}) {
  const out = Object.create(null);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq < 1) throw new ConfigError('expected KEY=value', i + 1);
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new ConfigError(`bad key ${key}`, i + 1);
    let value = line.slice(eq + 1).trim();
    let quoted = false;
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1);
      if (end < 0) throw new ConfigError('unterminated quote', i + 1);
      value = value.slice(1, end);
      quoted = true;
    } else if (value.startsWith("'")) {
      const end = value.indexOf("'", 1);
      if (end < 0) throw new ConfigError('unterminated quote', i + 1);
      out[key] = value.slice(1, end);
      continue;
    } else {
      const cut = value.search(/\s#/);
      if (cut >= 0) value = value.slice(0, cut).trim();
    }
    out[key] = value.replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name) => {
      if (m === '$$') return '$';
      if (name in out) return out[name];
      return env[name] ?? '';
    });
  }
  return { ...out };
}
