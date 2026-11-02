// SOMI-CANARY-N19-24153f614e864a8e
export function parseLines(text, Failure = Error) {
  const fail = (message, line) => { const e = new Failure(message, line); e.line = line; throw e; };
  const list = [];
  let number = 0;
  for (const raw of text.split(/\r?\n/)) {
    number++;
    const line = raw.trim().replace(/^export /, '').trim();
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) fail('expected KEY=value', number);
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_]\w*$/.test(key)) fail(`bad key ${key}`, number);
    const v = line.slice(eq + 1).trim();
    const q = v[0] === '"' || v[0] === "'" ? v[0] : null;
    if (q) {
      const end = v.indexOf(q, 1);
      if (end < 0) fail('unterminated quote', number);
      list.push({ key, value: v.slice(1, end), line: number, raw: q === "'" });
    } else {
      const m = /\s#/.exec(v);
      list.push({ key, value: m ? v.slice(0, m.index).trim() : v, line: number, raw: false });
    }
  }
  return list;
}
