// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Harness-owned runner: loads the candidate's pricing code in this child process and prints one tagged JSON line.
//   node run-pricing.mjs <nonce> probe          the candidate's modules and the exports of src/pricing.mjs
//   node run-pricing.mjs <nonce> group <name>   one group of generated carts: in order, reversed, frozen, and whether quote changed a cart
// Each call is its own child so a hang or a crash on one kind of cart cannot take the others down. The nonce only guards
// against accidental output: candidate code in this same process can read argv, so the real defence is containment.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildExtra, buildGroups, record } from './carts.mjs';

const [, , nonce, mode, name] = process.argv;
const WS = process.env.TASK_WORKSPACE;
const load = async (rel) => { try { return await import(pathToFileURL(WS + '/' + rel).href); } catch { return null; } };
const deepFreeze = (v) => { if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); } return v; };

const out = { loaded: false };
const mod = await load('src/pricing.mjs');
if (mod !== null && typeof mod.quote === 'function') {
  out.loaded = true;
  if (mode === 'probe') {
    out.modules = {};
    for (const m of ['rounding', 'discounts', 'shipping', 'tax']) {
      const ns = await load('src/' + m + '.mjs');
      out.modules[m] = ns === null ? null : Object.values(ns).filter((v) => typeof v === 'function').length;
    }
    try {
      const e = new mod.PricingError('some_code', 'some message');
      out.api = {
        types: Object.fromEntries(Object.entries(mod).map(([k, v]) => [k, typeof v])),
        currencies: mod.SUPPORTED_CURRENCIES,
        coupons: mod.couponCodes(),
        error: [e instanceof Error, e.name, e.code, e.message],
      };
    } catch { out.api = null; }
  } else {
    const carts = [...buildGroups(), ...buildExtra()].find((g) => g.name === name)?.carts ?? [];
    out.results = {}; out.again = {}; out.frozen = {}; out.mutated = [];
    for (const { id, cart } of carts) {
      const own = structuredClone(cart);
      out.results[id] = record(mod, own);
      try { assert.deepStrictEqual(own, cart); } catch { out.mutated.push(id); }
    }
    for (const { id, cart } of [...carts].reverse()) out.again[id] = record(mod, structuredClone(cart));
    for (const { id, cart } of carts) out.frozen[id] = record(mod, deepFreeze(structuredClone(cart)));
  }
}
process.stdout.write('\nH5:' + nonce + ':' + JSON.stringify(out) + '\n');
