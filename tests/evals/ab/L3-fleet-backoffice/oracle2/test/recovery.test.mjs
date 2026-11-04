// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addRecovery } from '../src/recovery/service.mjs';
test('recovery prices in cents', () => { assert.equal(addRecovery(createStore(1), 't', { callouts: 1, rate: 100 }).ok, true); });
