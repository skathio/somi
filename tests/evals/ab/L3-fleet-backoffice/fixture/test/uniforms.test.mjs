import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordUniforms, voidUniforms, uniformsTotal } from '../src/uniforms/service.mjs';
import { uniformsReport } from '../src/uniforms/report.mjs';

test('uniforms: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordUniforms(store, { sets: 3, rate: 10 });
  assert.equal(entry.amount, 64.5);
  assert.equal(uniformsTotal(store), 64.5);
});

test('uniforms: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordUniforms(store, { sets: 3, rate: 10 });
  voidUniforms(store, entry.id);
  assert.equal(uniformsTotal(store), 0);
  assert.deepEqual(uniformsReport(store), []);
});

test('uniforms: too many sets is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordUniforms(store, { sets: 121, rate: 10 }), RangeError);
});
