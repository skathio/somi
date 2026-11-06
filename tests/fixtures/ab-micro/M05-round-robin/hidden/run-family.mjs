// SOMI-CANARY-M05-8c41e07b92d5a3f6
// Shared per-family runner child (micro-task standard). The parent test file starts ONE child per family; this file loads
// the candidate once, runs every case of the family and prints one tagged JSON line per case. A case that throws fails only
// itself; a case that never returns hangs the child, and the parent then fails the whole family and nothing else. Case data
// is read as data (JSON), never evaluated. The nonce only guards against accidental output: candidate code in this process
// can read argv, so the real defence is containment.
import { readFileSync } from 'node:fs';
const [, , nonce, family] = process.argv;
const table = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const decode = (x) => {
  if (x !== null && typeof x === 'object' && '$num' in x) return Number(x.$num);
  if (x !== null && typeof x === 'object' && '$undef' in x) return undefined;
  return x;
};
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
// One canonical string per value: the type is part of it, -0 is distinct from 0, objects have sorted keys.
const norm = (v) => (typeof v === 'number' ? 'number:' + (Object.is(v, -0) ? '-0' : String(v)) : v !== null && typeof v === 'object' ? 'json:' + JSON.stringify(sorted(v)) : typeof v + ':' + String(v));
let mod = null;
try { mod = await import(process.env.TASK_WORKSPACE + '/' + table.module); } catch { mod = null; }
const call = (args) => {
  try { return { ok: true, str: norm(mod[table.export](...args.map(decode))) }; } catch (e) { return { ok: false, name: String(e?.name), code: e?.code === undefined ? null : String(e.code) }; }
};
const fam = table.families.find((f) => f.name === family);
for (const c of fam ? fam.cases : []) {
  const first = call(c.args);
  process.stdout.write('\nC:' + nonce + ':' + JSON.stringify({ id: c.id, ...first, same: JSON.stringify(first) === JSON.stringify(call(c.args)) }) + '\n');
}
