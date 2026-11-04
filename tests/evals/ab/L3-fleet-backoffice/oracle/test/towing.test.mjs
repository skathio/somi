// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addTowing } from '../src/towing/service.mjs';
test('towing prices in cents', () => { assert.equal(addTowing(createStore(1), 't', { km: 1, rate: 100 }).ok, true); });
