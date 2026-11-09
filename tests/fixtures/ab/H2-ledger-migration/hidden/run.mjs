// SOMI-CANARY-H2-9c3f5a1e7b2d4806
// Harness-owned runner: opens the candidate's ledger on the given file in this child process, performs the operations
// read from stdin (a JSON list of {call, args}), prints one JSON result line and exits.
// The nonce only guards against accidental output; candidate code in this process can read argv, so the real defence is containment.
import { readFileSync } from 'node:fs';

const [, , nonce, dbPath] = process.argv;
// A big integer cannot be written as JSON by default; it is written as text so the answer still arrives.
const say = (value) => process.stdout.write('\nH2:' + nonce + ':' + JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n');
const describe = (e) => ({ name: String(e?.name), code: e?.code, index: e?.index });

const ops = JSON.parse(readFileSync(0, 'utf8'));
let ledger;
try {
  const mod = await import(process.env.TASK_WORKSPACE + '/src/ledger.mjs');
  ledger = mod.openLedger(dbPath);
} catch (e) {
  say({ openError: describe(e) });
  process.exit(0);
}
const results = [];
for (const { call, args } of ops) {
  try {
    results.push({ ok: ledger[call](...args) ?? null });
  } catch (e) {
    results.push({ error: describe(e) });
  }
}
try {
  ledger.close();
} catch {
  // a ledger that cannot close is reported by the next open
}
say({ results });
process.exit(0);
