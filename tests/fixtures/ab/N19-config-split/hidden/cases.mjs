// SOMI-CANARY-N19-24153f614e864a8e
const C = (text, env) => async (l) => (await l('src/config.mjs')).parseConfig(text, env);
const E = (text) => async (l) => { try { (await l('src/config.mjs')).parseConfig(text, {}); return null; } catch (err) { return [err.message, err.line]; } };
export const cases = [
  { name: 'AC1 [functional] parseLines reads entries with their line numbers', run: async (l) => (await l('src/parse.mjs')).parseLines('# c\nA=1\n\nB = two # note\n').map(({ key, value, line }) => ({ key, value, line })), expect: [{ key: 'A', value: '1', line: 2 }, { key: 'B', value: 'two', line: 4 }] },
  { name: 'AC1 [functional] interpolate finishes the entries', run: async (l) => { const { parseLines } = await l('src/parse.mjs'); const { interpolate } = await l('src/interpolate.mjs'); return interpolate(parseLines('A=1\nB=${A}${E}\n'), { E: 'x' }); }, expect: { A: '1', B: '1x' } },
  { name: 'AC2 [regression] a variable sees the value at that point in the file', run: C('A=1\nB=${A}\nA=2\n'), expect: { A: '2', B: '1' } },
  { name: 'AC2 [regression] a later key is not visible yet', run: C('B=${A}\nA=1\n'), expect: { B: '', A: '1' } },
  { name: 'AC2 [regression] a later key does not shadow the environment yet', run: C('B=${A}\nA=1\n', { A: 'env' }), expect: { B: 'env', A: '1' } },
  { name: 'AC2 [regression] earlier keys win over the environment', run: C('A=file\nB=${A}\n', { A: 'env' }), expect: { A: 'file', B: 'file' } },
  { name: 'AC2 [regression] a key can extend itself', run: C('P=a\nP=${P}:b\n'), expect: { P: 'a:b' } },
  { name: 'AC2 [regression] a doubled dollar is one dollar and does not expand', run: C('A=1\nB=$${A}\n'), expect: { A: '1', B: '${A}' } },
  { name: 'AC2 [regression] single quotes are literal', run: C("A=1\nB='${A} # $$'\n"), expect: { A: '1', B: '${A} # $$' } },
  { name: 'AC2 [regression] double quotes keep hashes and expand', run: C('A=1\nB="${A} # x"\n'), expect: { A: '1', B: '1 # x' } },
  { name: 'AC2 [regression] text after a closing quote is dropped', run: C('A="a" trailing\n'), expect: { A: 'a' } },
  { name: 'AC2 [regression] a hash with no space before it is part of the value', run: C('A=a#b\nB=c #d\n'), expect: { A: 'a#b', B: 'c' } },
  { name: 'AC2 [regression] export is ignored and windows line ends work', run: C('export A=1\r\nB=2\r\n'), expect: { A: '1', B: '2' } },
  { name: 'AC2 [regression] a key named like an object method is ordinary', run: C('constructor=1\nB=${constructor}\n', {}), expect: { constructor: '1', B: '1' } },
  { name: 'AC2 [regression] errors carry the message and the file line', run: E('# c\n\nnope\n'), expect: ['expected KEY=value', 3] },
  { name: 'AC2 [regression] a bad key names itself', run: E('A=1\n1A=2\n'), expect: ['bad key 1A', 2] },
  { name: 'AC2 [regression] an unterminated quote is an error in either style', run: async (l) => { const f = (await l('src/config.mjs')).parseConfig; const out = []; for (const t of ['A="x', "A='x"]) { try { f(t); } catch (e) { out.push([e.message, e.line]); } } return out; }, expect: [['unterminated quote', 1], ['unterminated quote', 1]] },
  { name: 'AC2 [regression] an error is a ConfigError', run: async (l) => { const m = await l('src/config.mjs'); try { m.parseConfig('x'); return null; } catch (e) { return e instanceof m.ConfigError; } }, expect: true },
];
