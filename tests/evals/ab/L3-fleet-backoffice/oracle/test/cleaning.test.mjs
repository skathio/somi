// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addCleaning } from '../src/cleaning/service.mjs';
test('cleaning prices in cents', () => { assert.equal(addCleaning(createStore(1), 't', { cabins: 1, rate: 100 }).ok, true); });
