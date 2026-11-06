// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addPallets } from '../src/pallets/service.mjs';
test('pallets prices in cents', () => { assert.equal(addPallets(createStore(1), 't', { pallets: 1, rate: 100 }).ok, true); });
