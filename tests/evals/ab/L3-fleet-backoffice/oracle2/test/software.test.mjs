// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerSoftware } from '../src/software/service.mjs';
test('software prices in cents', () => { assert.equal(registerSoftware(createStore(1), 't', { seats: 1, rate: 100 }).ok, true); });
