// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerLeases } from '../src/leases/service.mjs';
test('leases prices in cents', () => { assert.equal(registerLeases(createStore(1), 't', { months: 1, rate: 100 }).ok, true); });
