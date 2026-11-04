// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addRentals } from '../src/rentals/service.mjs';
test('rentals prices in cents', () => { assert.equal(addRentals(createStore(1), 't', { days: 1, rate: 100 }).ok, true); });
