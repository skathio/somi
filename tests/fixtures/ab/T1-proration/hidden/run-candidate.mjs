// SOMI-CANARY-T1-9f3a7c21b84e60d5
// Harness-owned runner: loads the candidate in this child process and prints one tagged result line. The nonce only guards
// against accidental output: candidate code in this same process can read argv, so the real defence is containment.
const [, , nonce, json] = process.argv;
const cases = JSON.parse(json);
const decode = (x) => {
  if (x !== null && typeof x === 'object' && '$num' in x) return Number(x.$num);
  if (x !== null && typeof x === 'object' && '$undef' in x) return undefined;
  return x;
};
let mod = null;
try { mod = await import(process.env.TASK_WORKSPACE + '/prorate.mjs'); } catch { mod = null; }
const num = (v) => (Object.is(v, -0) ? '-0' : Number.isSafeInteger(v) ? String(v) : 'unsafe:' + String(v));
const one = ([fn, args]) => {
  try {
    const v = mod[fn](...args.map(decode));
    if (fn === 'prorate') return { ok: true, kind: typeof v, str: typeof v === 'number' ? num(v) : String(v) };
    const obj = v !== null && typeof v === 'object';
    return { ok: true, kind: typeof v, str: obj ? JSON.stringify({ credit: num(v.credit), charge: num(v.charge) }) : String(v) };
  } catch (e) {
    return { ok: false, isRange: e instanceof RangeError, name: String(e?.name), code: e?.code === undefined ? null : String(e.code) };
  }
};
const out = {};
for (const [id, spec] of Object.entries(cases)) {
  const first = one(spec);
  out[id] = { ...first, same: JSON.stringify(first) === JSON.stringify(one(spec)) };
}
process.stdout.write('\nT1:' + nonce + ':' + JSON.stringify(out) + '\n');
