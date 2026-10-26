// SOMI-CANARY-H6-c3a91e5d7b204f68
// Harness-owned runner: loads the candidate library in this child process, runs the given calls and prints one tagged result line.
// The nonce only guards against accidental output: candidate code in this process can read argv, so the real defence is containment.
import { readFileSync } from 'node:fs';
const [, , nonce] = process.argv;
const cases = JSON.parse(readFileSync(0, 'utf8'));
let mod = null;
try { mod = await import(process.env.TASK_WORKSPACE + '/src/index.mjs'); } catch { mod = null; }
const one = ([fn, ...args]) => {
  if (fn === '$exports') return { ok: true, value: Object.keys(mod ?? {}).sort(), mutated: false };
  const before = JSON.stringify(args);
  try {
    const value = mod[fn](...args);
    return { ok: true, value, mutated: JSON.stringify(args) !== before };
  } catch (e) {
    const isRuleError = typeof mod?.RuleError === 'function' && e instanceof mod.RuleError;
    return { ok: false, name: String(e?.name), code: e?.code === undefined ? null : String(e.code), isRuleError };
  }
};
const out = {};
for (const [id, spec] of Object.entries(cases)) {
  const first = one(spec);
  out[id] = { ...first, same: JSON.stringify(first) === JSON.stringify(one(spec)) };
}
process.stdout.write('\nH6:' + nonce + ':' + JSON.stringify(out) + '\n');
