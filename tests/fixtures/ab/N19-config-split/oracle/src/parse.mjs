// SOMI-CANARY-N19-24153f614e864a8e
import { ConfigError } from './errors.mjs';

function readValue(raw, line) {
  const value = raw.trim();
  for (const q of ['"', "'"]) {
    if (!value.startsWith(q)) continue;
    const end = value.indexOf(q, 1);
    if (end < 0) throw new ConfigError('unterminated quote', line);
    return { text: value.slice(1, end), literal: q === "'" };
  }
  const cut = value.search(/\s#/);
  return { text: cut >= 0 ? value.slice(0, cut).trim() : value, literal: false };
}

export function parseLines(text) {
  const entries = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq < 1) throw new ConfigError('expected KEY=value', i + 1);
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new ConfigError(`bad key ${key}`, i + 1);
    const { text: value, literal } = readValue(line.slice(eq + 1), i + 1);
    entries.push({ key, value, line: i + 1, ...(literal ? { literal } : {}) });
  });
  return entries;
}
