// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordUniforms } from '../src/uniforms/service.mjs';
test('uniforms prices in cents', () => { assert.equal(recordUniforms(createStore(1), 't', { sets: 1, rate: 100 }).ok, true); });
