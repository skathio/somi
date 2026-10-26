// SOMI-CANARY-M05-8c41e07b92d5a3f6
// Shared hidden test file (micro-task standard): one named test per case, so green / total is the score. The case table is
// hidden/cases.json; every case is run by the shared runner in a child process, ONE child per family with a timeout. A case
// that throws fails only itself; a family whose child hangs or dies fails all of that family's cases and no other.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const table = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const decode = (x) => {
  if (x !== null && typeof x === 'object' && '$num' in x) return Number(x.$num);
  if (x !== null && typeof x === 'object' && '$undef' in x) return undefined;
  return x;
};
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const norm = (v) => (typeof v === 'number' ? 'number:' + (Object.is(v, -0) ? '-0' : String(v)) : v !== null && typeof v === 'object' ? 'json:' + JSON.stringify(sorted(v)) : typeof v + ':' + String(v));

const nonce = randomUUID();
const tag = '\nC:' + nonce + ':';
const results = new Map(); // family -> Map(id -> record) | null when the child hung or died
for (const f of table.families) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./run-family.mjs', import.meta.url)), nonce, f.name], { env: process.env, encoding: 'utf8', timeout: Math.min(table.timeoutMs ?? 10000, 30000), killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0 || r.signal) { results.set(f.name, null); continue; }
  const got = new Map();
  for (const part of ('\n' + (r.stdout ?? '')).split(tag).slice(1)) {
    try { const rec = JSON.parse(part.split('\n')[0]); if (!got.has(rec.id)) got.set(rec.id, rec); } catch { /* not a record */ }
  }
  results.set(f.name, got);
}

for (const f of table.families) {
  for (const c of f.cases) {
    test(`AC${c.ac} [${f.name}] ${c.id}`, () => {
      const fam = results.get(f.name);
      assert.ok(fam, 'the family did not finish');
      const r = fam.get(c.id);
      assert.ok(r, 'no result for this case');
      assert.equal(r.same, true, 'two calls with the same arguments differ');
      if ('throws' in c.want) assert.deepEqual([r.ok, r.name, r.code], [false, c.want.throws.name, c.want.throws.code]);
      else { assert.equal(r.ok, true, 'the call threw ' + r.name + ' ' + r.code); assert.equal(r.str, norm(decode(c.want.value))); }
    });
  }
}
