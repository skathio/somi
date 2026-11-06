// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerPermits } from '../src/permits/service.mjs';
test('permits prices in cents', () => { assert.equal(registerPermits(createStore(1), 't', { permits: 1, rate: 100 }).ok, true); });
